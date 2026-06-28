import { generateUuid } from '../../../../base/common/uuid.js';
import { HorusLinkedDocumentPersistResult, HorusPersistLinkedDocumentData, HorusPersistLinkedDocumentSyncData, IHorusLinkedDocumentRepository } from '../../common/horusRepository.js';
import { HorusLinkedDocument, HorusLinkedDocumentQuery, HorusLinkedDocumentStatus, HorusLinkedDocumentVersion, HorusPromptStatus } from '../../common/horusTypes.js';
import { HorusSQLiteConnection, HorusSQLiteRow } from '../horusSQLiteConnection.js';

interface LinkedDocumentRow extends HorusSQLiteRow {
	readonly id: string;
	readonly prompt_id: string;
	readonly working_directory_id: string | null;
	readonly absolute_path: string;
	readonly absolute_path_key: string;
	readonly document_type: number;
	readonly display_name: string | null;
	readonly status: number;
	readonly pull_request_reference: string | null;
	readonly current_version: number;
	readonly last_content_hash: string | null;
	readonly last_error: string | null;
	readonly last_synced_at_utc: string | null;
	readonly size_bytes: number | null;
	readonly created_at_utc: string;
	readonly updated_at_utc: string;
}

interface LinkedDocumentVersionRow extends HorusSQLiteRow {
	readonly id: string;
	readonly linked_document_id: string;
	readonly version_number: number;
	readonly content: string;
	readonly content_hash: string;
	readonly size_bytes: number;
	readonly source: number;
	readonly created_at_utc: string;
}

export class HorusLinkedDocumentRepository implements IHorusLinkedDocumentRepository {

	constructor(private readonly connection: HorusSQLiteConnection) { }

	async list(query: HorusLinkedDocumentQuery = {}): Promise<readonly HorusLinkedDocument[]> {
		const where: string[] = [];
		const params: unknown[] = [];
		const joins = query.activePromptsOnly ? 'INNER JOIN prompts p ON p.id = d.prompt_id' : '';

		if (query.promptId) {
			where.push('d.prompt_id = ?');
			params.push(query.promptId);
		}

		if (query.workingDirectoryId) {
			where.push('d.working_directory_id = ?');
			params.push(query.workingDirectoryId);
		}

		if (query.status !== undefined) {
			where.push('d.status = ?');
			params.push(query.status);
		}

		if (query.activePromptsOnly) {
			where.push('p.status <> ?');
			params.push(HorusPromptStatus.Archived);
		}

		const rows = await this.connection.all<LinkedDocumentRow>(`
			SELECT d.*
			FROM linked_documents d
			${joins}
			${where.length ? `WHERE ${where.join(' AND ')}` : ''}
			ORDER BY d.updated_at_utc DESC, d.display_name COLLATE NOCASE ASC;
		`, params);

		return rows.map(row => this.toLinkedDocument(row));
	}

	async get(id: string): Promise<HorusLinkedDocument | undefined> {
		const row = await this.connection.get<LinkedDocumentRow>('SELECT * FROM linked_documents WHERE id = ?;', [id]);
		return row ? this.toLinkedDocument(row) : undefined;
	}

	async getByPrompt(promptId: string): Promise<HorusLinkedDocument | undefined> {
		const row = await this.connection.get<LinkedDocumentRow>('SELECT * FROM linked_documents WHERE prompt_id = ?;', [promptId]);
		return row ? this.toLinkedDocument(row) : undefined;
	}

	async listVersions(linkedDocumentId: string): Promise<readonly HorusLinkedDocumentVersion[]> {
		const rows = await this.connection.all<LinkedDocumentVersionRow>(`
			SELECT *
			FROM linked_document_versions
			WHERE linked_document_id = ?
			ORDER BY version_number DESC;
		`, [linkedDocumentId]);

		return rows.map(row => this.toLinkedDocumentVersion(row));
	}

	async getVersion(linkedDocumentId: string, versionNumber: number): Promise<HorusLinkedDocumentVersion | undefined> {
		const row = await this.connection.get<LinkedDocumentVersionRow>(`
			SELECT *
			FROM linked_document_versions
			WHERE linked_document_id = ? AND version_number = ?;
		`, [linkedDocumentId, versionNumber]);

		return row ? this.toLinkedDocumentVersion(row) : undefined;
	}

	async link(data: HorusPersistLinkedDocumentData): Promise<HorusLinkedDocumentPersistResult> {
		const existing = await this.getByPrompt(data.promptId);
		const id = existing?.id ?? generateUuid();
		const now = new Date().toISOString();

		await this.connection.transaction(async () => {
			if (existing) {
				await this.connection.run(`
					UPDATE linked_documents
					SET working_directory_id = ?,
						absolute_path = ?,
						absolute_path_key = ?,
						document_type = ?,
						display_name = ?,
						status = ?,
						pull_request_reference = ?,
						current_version = 1,
						last_content_hash = ?,
						last_error = NULL,
						last_synced_at_utc = ?,
						size_bytes = ?,
						updated_at_utc = ?
					WHERE id = ?;
				`, [
					data.workingDirectoryId,
					data.absolutePath,
					data.absolutePathKey,
					data.documentType,
					data.displayName,
					HorusLinkedDocumentStatus.Watching,
					data.pullRequestReference,
					data.contentHash,
					now,
					data.sizeBytes,
					now,
					id
				]);
				await this.connection.run('DELETE FROM linked_document_versions WHERE linked_document_id = ?;', [id]);
			} else {
				await this.connection.run(`
					INSERT INTO linked_documents (
						id, prompt_id, working_directory_id, absolute_path, absolute_path_key,
						document_type, display_name, status, pull_request_reference, current_version,
						last_content_hash, last_error, last_synced_at_utc, size_bytes,
						created_at_utc, updated_at_utc
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?, ?, ?);
				`, [
					id,
					data.promptId,
					data.workingDirectoryId,
					data.absolutePath,
					data.absolutePathKey,
					data.documentType,
					data.displayName,
					HorusLinkedDocumentStatus.Watching,
					data.pullRequestReference,
					data.contentHash,
					now,
					data.sizeBytes,
					now,
					now
				]);
			}

			await this.connection.run(`
				INSERT INTO linked_document_versions (
					id, linked_document_id, version_number, content, content_hash, size_bytes, source, created_at_utc
				) VALUES (?, ?, 1, ?, ?, ?, 1, ?);
			`, [
				generateUuid(),
				id,
				data.content,
				data.contentHash,
				data.sizeBytes,
				now
			]);
		});

		const document = await this.get(id);
		if (!document) {
			throw new Error(`Failed to load linked document: ${id}`);
		}

		return { document, versionCreated: true };
	}

	async syncContent(id: string, data: HorusPersistLinkedDocumentSyncData): Promise<HorusLinkedDocumentPersistResult> {
		const existing = await this.get(id);
		if (!existing) {
			throw new Error('Linked document was not found.');
		}

		const now = new Date().toISOString();
		if (existing.lastContentHash === data.contentHash) {
			await this.connection.run(`
				UPDATE linked_documents
				SET status = ?,
					last_error = NULL,
					last_synced_at_utc = ?,
					size_bytes = ?,
					updated_at_utc = ?
				WHERE id = ?;
			`, [
				HorusLinkedDocumentStatus.Watching,
				now,
				data.sizeBytes,
				now,
				id
			]);

			const document = await this.get(id);
			if (!document) {
				throw new Error(`Failed to load linked document: ${id}`);
			}

			return { document, versionCreated: false };
		}

		const nextVersion = existing.currentVersion + 1;
		await this.connection.transaction(async () => {
			await this.connection.run(`
				UPDATE linked_documents
				SET status = ?,
					current_version = ?,
					last_content_hash = ?,
					last_error = NULL,
					last_synced_at_utc = ?,
					size_bytes = ?,
					updated_at_utc = ?
				WHERE id = ?;
			`, [
				HorusLinkedDocumentStatus.Watching,
				nextVersion,
				data.contentHash,
				now,
				data.sizeBytes,
				now,
				id
			]);

			await this.connection.run(`
				INSERT INTO linked_document_versions (
					id, linked_document_id, version_number, content, content_hash, size_bytes, source, created_at_utc
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
			`, [
				generateUuid(),
				id,
				nextVersion,
				data.content,
				data.contentHash,
				data.sizeBytes,
				data.source,
				now
			]);
		});

		const document = await this.get(id);
		if (!document) {
			throw new Error(`Failed to load linked document: ${id}`);
		}

		return { document, versionCreated: true };
	}

	async updateStatus(id: string, status: HorusLinkedDocumentStatus, lastError: string | null = null): Promise<HorusLinkedDocument> {
		const now = new Date().toISOString();
		await this.connection.run(`
			UPDATE linked_documents
			SET status = ?,
				last_error = ?,
				updated_at_utc = ?
			WHERE id = ?;
		`, [status, lastError, now, id]);

		const document = await this.get(id);
		if (!document) {
			throw new Error(`Failed to load linked document: ${id}`);
		}

		return document;
	}

	private toLinkedDocument(row: LinkedDocumentRow): HorusLinkedDocument {
		return {
			id: row.id,
			promptId: row.prompt_id,
			workingDirectoryId: row.working_directory_id,
			absolutePath: row.absolute_path,
			absolutePathKey: row.absolute_path_key,
			documentType: row.document_type,
			displayName: row.display_name,
			status: row.status,
			pullRequestReference: row.pull_request_reference,
			currentVersion: row.current_version,
			lastContentHash: row.last_content_hash,
			lastError: row.last_error,
			lastSyncedAtUtc: row.last_synced_at_utc,
			sizeBytes: row.size_bytes,
			createdAtUtc: row.created_at_utc,
			updatedAtUtc: row.updated_at_utc
		};
	}

	private toLinkedDocumentVersion(row: LinkedDocumentVersionRow): HorusLinkedDocumentVersion {
		return {
			id: row.id,
			linkedDocumentId: row.linked_document_id,
			versionNumber: row.version_number,
			content: row.content,
			contentHash: row.content_hash,
			sizeBytes: row.size_bytes,
			source: row.source,
			createdAtUtc: row.created_at_utc
		};
	}
}
