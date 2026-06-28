import { createHash } from 'crypto';
import { readFile, stat } from 'fs/promises';
import { basename, isAbsolute, join, normalize } from '../../../base/common/path.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { Emitter } from '../../../base/common/event.js';
import { INativeEnvironmentService } from '../../environment/common/environment.js';
import { IFileService } from '../../files/common/files.js';
import { HorusCreateLinkedDocumentData, HorusCreatePromptData, HorusCreateWorkspaceData, HorusFileMentionValidationRequest, HorusFileMentionValidationResult, HorusLinkedDocument, HorusLinkedDocumentQuery, HorusLinkedDocumentStatus, HorusLinkedDocumentSyncResult, HorusLinkedDocumentType, HorusLinkedDocumentVersion, HorusLinkedDocumentVersionSource, HorusNativeWorkspaceFolder, HorusPrompt, HorusPromptKind, HorusPromptQuery, HorusPromptStatus, HorusPromptVersion, HorusResolvedPromptFileReferenceData, HorusStorageHealth, HorusTargetAgent, HorusUpdateLinkedDocumentStatusData, HorusUpdatePromptData, HorusWorkspace } from '../common/horusTypes.js';
import { HorusDataChangeEvent, IHorusStorageService } from '../common/horusStorage.js';
import { HorusBackupService } from './horusBackupService.js';
import { HorusFileValidationService } from './horusFileValidationService.js';
import { HorusMigrationRunner } from './horusMigrationRunner.js';
import { horusMigrations } from './migrations/v001_initial.js';
import { HorusLinkedDocumentRepository } from './repositories/linkedDocumentRepository.js';
import { HorusPromptRepository } from './repositories/promptRepository.js';
import { HorusWorkspaceRepository } from './repositories/workspaceRepository.js';
import { HorusSQLiteConnection } from './horusSQLiteConnection.js';
import { HorusWriteQueue } from './horusWriteQueue.js';

interface JournalModeRow {
	readonly journal_mode: string;
}

interface ForeignKeysRow {
	readonly foreign_keys: number;
}

interface UserVersionRow {
	readonly user_version: number;
}

export class HorusStorageService extends Disposable implements IHorusStorageService {

	declare readonly _serviceBrand: undefined;

	private readonly onDidChangeDataEmitter = this._register(new Emitter<HorusDataChangeEvent>());
	readonly onDidChangeData = this.onDidChangeDataEmitter.event;

	private readonly databasePath: string;
	private readonly writeQueue = new HorusWriteQueue();
	private readonly connection: HorusSQLiteConnection;
	private readonly backupService: HorusBackupService;
	private readonly migrationRunner: HorusMigrationRunner;
	private readonly fileValidationService: HorusFileValidationService;

	private workspaceRepository: HorusWorkspaceRepository | undefined;
	private promptRepository: HorusPromptRepository | undefined;
	private linkedDocumentRepository: HorusLinkedDocumentRepository | undefined;
	private ready: Promise<void> | undefined;

	constructor(
		@INativeEnvironmentService environmentService: INativeEnvironmentService,
		@IFileService fileService: IFileService
	) {
		super();

		this.databasePath = join(environmentService.userDataPath, 'horus.db');
		this.connection = new HorusSQLiteConnection(this.databasePath);
		this.backupService = new HorusBackupService(this.connection, this.writeQueue);
		this.migrationRunner = new HorusMigrationRunner(this.connection, this.backupService, horusMigrations);
		this.fileValidationService = new HorusFileValidationService(fileService);
	}

	override dispose(): void {
		this.connection.checkpointTruncate()
			.catch(() => undefined)
			.finally(() => this.connection.close().catch(() => undefined));
		super.dispose();
	}

	async getHealth(): Promise<HorusStorageHealth> {
		await this.ensureReady();

		const journalMode = await this.connection.get<JournalModeRow>('PRAGMA journal_mode;', [], 'write');
		const foreignKeys = await this.connection.get<ForeignKeysRow>('PRAGMA foreign_keys;', [], 'write');
		const userVersion = await this.connection.get<UserVersionRow>('PRAGMA user_version;', [], 'write');

		return {
			databasePath: this.databasePath,
			journalMode: journalMode?.journal_mode ?? 'unknown',
			foreignKeys: foreignKeys?.foreign_keys ?? 0,
			userVersion: userVersion?.user_version ?? 0
		};
	}

	async listWorkspaces(): Promise<readonly HorusWorkspace[]> {
		await this.ensureReady();
		return this.getWorkspaceRepository().list();
	}

	async createWorkspace(data: HorusCreateWorkspaceData): Promise<HorusWorkspace> {
		await this.ensureReady();
		const workspace = await this.writeQueue.enqueue(() => this.getWorkspaceRepository().create(data));
		this.onDidChangeDataEmitter.fire({ kind: 'workspace', id: workspace.id });
		return workspace;
	}

	async resolveNativeWorkspaces(folders: readonly HorusNativeWorkspaceFolder[]): Promise<readonly HorusWorkspace[]> {
		await this.ensureReady();

		const workspaces: HorusWorkspace[] = [];
		let created = false;

		for (const folder of folders) {
			const workspace = await this.writeQueue.enqueue(async () => {
				const existing = await this.getWorkspaceRepository().getByAbsolutePath(folder.absolutePath);
				if (existing) {
					return existing;
				}

				created = true;
				return this.getWorkspaceRepository().create({
					name: folder.name,
					absolutePath: folder.absolutePath
				});
			});
			workspaces.push(workspace);
		}

		if (created) {
			this.onDidChangeDataEmitter.fire({ kind: 'workspace' });
		}

		return workspaces;
	}

	async listPrompts(query?: HorusPromptQuery): Promise<readonly HorusPrompt[]> {
		await this.ensureReady();
		return this.getPromptRepository().list(query);
	}

	async getPrompt(id: string): Promise<HorusPrompt | undefined> {
		await this.ensureReady();
		return this.getPromptRepository().get(id);
	}

	async listPromptVersions(promptId: string): Promise<readonly HorusPromptVersion[]> {
		await this.ensureReady();
		return this.getPromptRepository().listVersions(promptId);
	}

	async getPromptVersion(promptId: string, versionNumber: number): Promise<HorusPromptVersion | undefined> {
		await this.ensureReady();
		return this.getPromptRepository().getVersion(promptId, versionNumber);
	}

	async createPrompt(data: HorusCreatePromptData): Promise<HorusPrompt> {
		await this.ensureReady();
		this.validatePromptFields(data.title, data.content);
		const prompt = await this.writeQueue.enqueue(() => this.getPromptRepository().create(data));
		this.onDidChangeDataEmitter.fire({ kind: 'prompt', id: prompt.id });
		return prompt;
	}

	async updatePrompt(data: HorusUpdatePromptData): Promise<HorusPrompt> {
		await this.ensureReady();
		this.validatePromptFields(data.title, data.content);
		this.validatePromptEnums(data);

		const prompt = await this.getPromptRepository().get(data.id);
		if (!prompt) {
			throw new Error('Prompt was not found.');
		}

		const workspace = await this.getWorkspaceRepository().get(prompt.workingDirectoryId);
		if (!workspace) {
			throw new Error('Prompt workspace was not found.');
		}

		const fileReferences = await this.resolvePromptFileReferences(workspace, data.mentions ?? []);
		const updated = await this.writeQueue.enqueue(() => this.getPromptRepository().update(data, fileReferences));
		this.onDidChangeDataEmitter.fire({ kind: 'prompt', id: updated.id });
		return updated;
	}

	async listLinkedDocuments(query?: HorusLinkedDocumentQuery): Promise<readonly HorusLinkedDocument[]> {
		await this.ensureReady();
		return this.getLinkedDocumentRepository().list(query);
	}

	async getLinkedDocumentForPrompt(promptId: string): Promise<HorusLinkedDocument | undefined> {
		await this.ensureReady();
		return this.getLinkedDocumentRepository().getByPrompt(promptId);
	}

	async listLinkedDocumentVersions(linkedDocumentId: string): Promise<readonly HorusLinkedDocumentVersion[]> {
		await this.ensureReady();
		return this.getLinkedDocumentRepository().listVersions(linkedDocumentId);
	}

	async getLinkedDocumentVersion(linkedDocumentId: string, versionNumber: number): Promise<HorusLinkedDocumentVersion | undefined> {
		await this.ensureReady();
		return this.getLinkedDocumentRepository().getVersion(linkedDocumentId, versionNumber);
	}

	async linkPlanToPrompt(data: HorusCreateLinkedDocumentData): Promise<HorusLinkedDocumentSyncResult> {
		await this.ensureReady();
		this.validateLinkedDocumentPath(data.absolutePath);

		const prompt = await this.getPromptRepository().get(data.promptId);
		if (!prompt) {
			throw new Error('Prompt was not found.');
		}
		if (prompt.status === HorusPromptStatus.Archived) {
			throw new Error('Archived prompts cannot monitor linked plans.');
		}

		const snapshot = await this.readLinkedDocumentFile(data.absolutePath);
		const normalizedPath = normalize(data.absolutePath);
		const result = await this.writeQueue.enqueue(() => this.getLinkedDocumentRepository().link({
			promptId: data.promptId,
			workingDirectoryId: prompt.workingDirectoryId,
			absolutePath: normalizedPath,
			absolutePathKey: this.toAbsolutePathKey(normalizedPath),
			documentType: data.documentType ?? HorusLinkedDocumentType.ClaudeCodePlan,
			displayName: data.displayName?.trim() || basename(normalizedPath),
			pullRequestReference: data.pullRequestReference ?? null,
			content: snapshot.content,
			contentHash: snapshot.contentHash,
			sizeBytes: snapshot.sizeBytes
		}));

		this.onDidChangeDataEmitter.fire({ kind: 'linkedDocument', id: result.document.id });
		return result;
	}

	async syncLinkedDocument(linkedDocumentId: string, source: HorusLinkedDocumentVersionSource = HorusLinkedDocumentVersionSource.ManualRefresh): Promise<HorusLinkedDocumentSyncResult> {
		await this.ensureReady();
		const document = await this.getLinkedDocumentRepository().get(linkedDocumentId);
		if (!document) {
			throw new Error('Linked document was not found.');
		}
		if (document.status === HorusLinkedDocumentStatus.Paused) {
			return { document, versionCreated: false };
		}

		const prompt = await this.getPromptRepository().get(document.promptId);
		if (!prompt || prompt.status === HorusPromptStatus.Archived) {
			const updated = await this.writeQueue.enqueue(() => this.getLinkedDocumentRepository().updateStatus(document.id, HorusLinkedDocumentStatus.Paused, 'Monitoring stopped because the prompt is archived or missing.'));
			this.onDidChangeDataEmitter.fire({ kind: 'linkedDocument', id: updated.id });
			return { document: updated, versionCreated: false };
		}

		try {
			const snapshot = await this.readLinkedDocumentFile(document.absolutePath);
			const result = await this.writeQueue.enqueue(() => this.getLinkedDocumentRepository().syncContent(document.id, {
				content: snapshot.content,
				contentHash: snapshot.contentHash,
				sizeBytes: snapshot.sizeBytes,
				source
			}));
			this.onDidChangeDataEmitter.fire({ kind: 'linkedDocument', id: result.document.id });
			return result;
		} catch (error) {
			const updated = await this.writeQueue.enqueue(() => this.getLinkedDocumentRepository().updateStatus(document.id, HorusLinkedDocumentStatus.Error, String(error)));
			this.onDidChangeDataEmitter.fire({ kind: 'linkedDocument', id: updated.id });
			return { document: updated, versionCreated: false };
		}
	}

	async updateLinkedDocumentStatus(data: HorusUpdateLinkedDocumentStatusData): Promise<HorusLinkedDocument> {
		await this.ensureReady();
		if (!this.isLinkedDocumentStatus(data.status)) {
			throw new Error('Linked document status contains an invalid enum value.');
		}

		const document = await this.writeQueue.enqueue(() => this.getLinkedDocumentRepository().updateStatus(data.id, data.status, null));
		this.onDidChangeDataEmitter.fire({ kind: 'linkedDocument', id: document.id });
		return document;
	}

	validateFileMentions(request: HorusFileMentionValidationRequest): Promise<readonly HorusFileMentionValidationResult[]> {
		return this.fileValidationService.validateMentions(request);
	}

	private validatePromptFields(title: string, content: string): void {
		if (!title.trim()) {
			throw new Error('Prompt title is required.');
		}

		if (title.trim().length > 220) {
			throw new Error('Prompt title must be 220 characters or less.');
		}

		if (content.length > 200_000) {
			throw new Error('Prompt content must be 200000 characters or less.');
		}
	}

	private validatePromptEnums(data: HorusUpdatePromptData): void {
		if (!this.isTargetAgent(data.targetAgent) || !this.isPromptKind(data.kind) || !this.isPromptStatus(data.status)) {
			throw new Error('Prompt metadata contains an invalid enum value.');
		}
	}

	private isTargetAgent(value: HorusTargetAgent): boolean {
		return value === HorusTargetAgent.ClaudeCode || value === HorusTargetAgent.Codex || value === HorusTargetAgent.Grok;
	}

	private isPromptKind(value: HorusPromptKind): boolean {
		return value === HorusPromptKind.General || value === HorusPromptKind.Plan || value === HorusPromptKind.Review || value === HorusPromptKind.Implementation;
	}

	private isPromptStatus(value: HorusPromptStatus): boolean {
		return value === HorusPromptStatus.Draft || value === HorusPromptStatus.Active || value === HorusPromptStatus.Archived;
	}

	private isLinkedDocumentStatus(value: HorusLinkedDocumentStatus): boolean {
		return value === HorusLinkedDocumentStatus.Draft
			|| value === HorusLinkedDocumentStatus.Watching
			|| value === HorusLinkedDocumentStatus.Paused
			|| value === HorusLinkedDocumentStatus.Error;
	}

	private validateLinkedDocumentPath(absolutePath: string): void {
		if (!absolutePath.trim()) {
			throw new Error('Linked plan path is required.');
		}

		if (!isAbsolute(absolutePath)) {
			throw new Error('Linked plan path must be absolute.');
		}

		const lower = absolutePath.toLowerCase();
		if (!lower.endsWith('.md') && !lower.endsWith('.markdown')) {
			throw new Error('Linked plans must be Markdown files.');
		}
	}

	private async readLinkedDocumentFile(absolutePath: string): Promise<{ readonly content: string; readonly contentHash: string; readonly sizeBytes: number }> {
		const [contentBuffer, fileStat] = await Promise.all([
			readFile(absolutePath),
			stat(absolutePath)
		]);
		if (!fileStat.isFile()) {
			throw new Error('Linked plan path does not point to a file.');
		}

		const content = contentBuffer.toString('utf8');
		return {
			content,
			contentHash: createHash('sha256').update(contentBuffer).digest('hex'),
			sizeBytes: fileStat.size
		};
	}

	private toAbsolutePathKey(absolutePath: string): string {
		return normalize(absolutePath).replace(/\\/g, '/').toLowerCase();
	}

	private async resolvePromptFileReferences(workspace: HorusWorkspace, mentions: readonly string[]): Promise<readonly HorusResolvedPromptFileReferenceData[]> {
		const seen = new Set<string>();
		const uniqueMentions: string[] = [];
		for (const mention of mentions) {
			const normalized = mention.trim().replace(/^@+/, '').replace(/\\/g, '/');
			if (!normalized || seen.has(normalized.toLowerCase())) {
				continue;
			}

			seen.add(normalized.toLowerCase());
			uniqueMentions.push(normalized);
		}

		const validations = await this.fileValidationService.validateMentions({
			workspacePath: workspace.absolutePath,
			mentions: uniqueMentions,
			respectGitignore: workspace.respectGitignore
		});
		const resolvedAtUtc = new Date().toISOString();

		return validations.map(validation => ({
			relativePath: validation.relativePath.replace(/\\/g, '/'),
			rawMention: validation.rawMention,
			exists: validation.exists,
			resolvedAtUtc
		}));
	}

	private ensureReady(): Promise<void> {
		if (!this.ready) {
			this.ready = (async () => {
				await this.connection.open();
				await this.migrationRunner.migrate();
				this.workspaceRepository = new HorusWorkspaceRepository(this.connection);
				this.promptRepository = new HorusPromptRepository(this.connection);
				this.linkedDocumentRepository = new HorusLinkedDocumentRepository(this.connection);
				this.onDidChangeDataEmitter.fire({ kind: 'storage' });
			})();
		}

		return this.ready;
	}

	private getWorkspaceRepository(): HorusWorkspaceRepository {
		if (!this.workspaceRepository) {
			throw new Error('Horus workspace repository is not initialized');
		}

		return this.workspaceRepository;
	}

	private getPromptRepository(): HorusPromptRepository {
		if (!this.promptRepository) {
			throw new Error('Horus prompt repository is not initialized');
		}

		return this.promptRepository;
	}

	private getLinkedDocumentRepository(): HorusLinkedDocumentRepository {
		if (!this.linkedDocumentRepository) {
			throw new Error('Horus linked document repository is not initialized');
		}

		return this.linkedDocumentRepository;
	}
}
