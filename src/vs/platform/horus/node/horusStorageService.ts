import { join } from '../../../base/common/path.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { Emitter } from '../../../base/common/event.js';
import { INativeEnvironmentService } from '../../environment/common/environment.js';
import { IFileService } from '../../files/common/files.js';
import { HorusCreatePromptData, HorusCreateWorkspaceData, HorusFileMentionValidationRequest, HorusFileMentionValidationResult, HorusNativeWorkspaceFolder, HorusPrompt, HorusPromptKind, HorusPromptQuery, HorusPromptStatus, HorusResolvedPromptFileReferenceData, HorusStorageHealth, HorusTargetAgent, HorusUpdatePromptData, HorusWorkspace } from '../common/horusTypes.js';
import { HorusDataChangeEvent, IHorusStorageService } from '../common/horusStorage.js';
import { HorusBackupService } from './horusBackupService.js';
import { HorusFileValidationService } from './horusFileValidationService.js';
import { HorusMigrationRunner } from './horusMigrationRunner.js';
import { horusMigrations } from './migrations/v001_initial.js';
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
}
