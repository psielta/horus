import { generateUuid } from '../../../../base/common/uuid.js';
import { IHorusPromptRepository } from '../../common/horusRepository.js';
import { HORUS_SYSTEM_USER_ID, HorusCreatePromptData, HorusPrompt, HorusPromptKind, HorusPromptQuery, HorusPromptStatus, HorusTargetAgent } from '../../common/horusTypes.js';
import { HorusSQLiteConnection, HorusSQLiteRow } from '../horusSQLiteConnection.js';

interface PromptRow extends HorusSQLiteRow {
	readonly id: string;
	readonly owner_id: string;
	readonly working_directory_id: string;
	readonly parent_prompt_id: string | null;
	readonly future_task_id: string | null;
	readonly task_number: string | null;
	readonly title: string;
	readonly content: string;
	readonly target_agent: number;
	readonly kind: number;
	readonly status: number;
	readonly current_version: number;
	readonly board_rank: number;
	readonly row_version: number;
	readonly created_at_utc: string;
	readonly updated_at_utc: string;
}

export class HorusPromptRepository implements IHorusPromptRepository {

	constructor(private readonly connection: HorusSQLiteConnection) { }

	async list(query: HorusPromptQuery = {}): Promise<readonly HorusPrompt[]> {
		const where: string[] = [];
		const params: unknown[] = [];

		if (query.workingDirectoryId) {
			where.push('working_directory_id = ?');
			params.push(query.workingDirectoryId);
		}

		if (query.rootOnly) {
			where.push('parent_prompt_id IS NULL');
		}

		if (!query.includeArchived) {
			where.push('status <> ?');
			params.push(HorusPromptStatus.Archived);
		}

		const rows = await this.connection.all<PromptRow>(`
			SELECT *
			FROM prompts
			${where.length ? `WHERE ${where.join(' AND ')}` : ''}
			ORDER BY board_rank ASC, updated_at_utc DESC;
		`, params);

		return rows.map(row => this.toPrompt(row));
	}

	async get(id: string): Promise<HorusPrompt | undefined> {
		const row = await this.connection.get<PromptRow>('SELECT * FROM prompts WHERE id = ?;', [id]);
		return row ? this.toPrompt(row) : undefined;
	}

	async create(data: HorusCreatePromptData): Promise<HorusPrompt> {
		const id = generateUuid();
		const versionId = generateUuid();
		const now = new Date().toISOString();
		const title = data.title.trim();
		const targetAgent = data.targetAgent ?? HorusTargetAgent.ClaudeCode;
		const kind = data.kind ?? HorusPromptKind.General;
		const status = data.status ?? HorusPromptStatus.Draft;

		await this.connection.transaction(async () => {
			await this.connection.run(`
				INSERT INTO prompts (
					id, owner_id, working_directory_id, parent_prompt_id, future_task_id, task_number,
					title, content, target_agent, kind, status, current_version, board_rank,
					row_version, created_at_utc, updated_at_utc
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 1, ?, ?);
			`, [
				id,
				HORUS_SYSTEM_USER_ID,
				data.workingDirectoryId,
				data.parentPromptId ?? null,
				data.futureTaskId ?? null,
				data.taskNumber ?? null,
				title,
				data.content,
				targetAgent,
				kind,
				status,
				now,
				now
			]);

			await this.connection.run(`
				INSERT INTO prompt_versions (
					id, prompt_id, version_number, title, content, target_agent, kind, status,
					change_note, created_at_utc
				) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?);
			`, [
				versionId,
				id,
				title,
				data.content,
				targetAgent,
				kind,
				status,
				data.changeNote ?? 'Initial version',
				now
			]);
		});

		const prompt = await this.get(id);
		if (!prompt) {
			throw new Error(`Failed to load created Horus prompt: ${id}`);
		}

		return prompt;
	}

	private toPrompt(row: PromptRow): HorusPrompt {
		return {
			id: row.id,
			ownerId: row.owner_id,
			workingDirectoryId: row.working_directory_id,
			parentPromptId: row.parent_prompt_id,
			futureTaskId: row.future_task_id,
			taskNumber: row.task_number,
			title: row.title,
			content: row.content,
			targetAgent: row.target_agent,
			kind: row.kind,
			status: row.status,
			currentVersion: row.current_version,
			boardRank: row.board_rank,
			rowVersion: row.row_version,
			createdAtUtc: row.created_at_utc,
			updatedAtUtc: row.updated_at_utc
		};
	}
}
