import { basename } from '../../../../base/common/path.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IHorusWorkspaceRepository } from '../../common/horusRepository.js';
import { HORUS_SYSTEM_USER_ID, HorusCreateWorkspaceData, HorusWorkspace } from '../../common/horusTypes.js';
import { HorusSQLiteConnection, HorusSQLiteRow } from '../horusSQLiteConnection.js';

interface WorkspaceRow extends HorusSQLiteRow {
	readonly id: string;
	readonly owner_id: string;
	readonly name: string;
	readonly absolute_path: string;
	readonly respect_gitignore: number;
	readonly enable_ai_context: number;
	readonly task_number_pattern: string | null;
	readonly created_at_utc: string;
	readonly updated_at_utc: string;
	readonly prompt_count?: number;
}

export class HorusWorkspaceRepository implements IHorusWorkspaceRepository {

	constructor(private readonly connection: HorusSQLiteConnection) { }

	async list(): Promise<readonly HorusWorkspace[]> {
		const rows = await this.connection.all<WorkspaceRow>(`
			SELECT w.*, COUNT(p.id) AS prompt_count
			FROM workspaces w
			LEFT JOIN prompts p ON p.working_directory_id = w.id
			GROUP BY w.id
			ORDER BY w.updated_at_utc DESC, w.name COLLATE NOCASE ASC;
		`);

		return rows.map(row => this.toWorkspace(row));
	}

	async get(id: string): Promise<HorusWorkspace | undefined> {
		const row = await this.connection.get<WorkspaceRow>(`
			SELECT w.*, COUNT(p.id) AS prompt_count
			FROM workspaces w
			LEFT JOIN prompts p ON p.working_directory_id = w.id
			WHERE w.id = ?
			GROUP BY w.id;
		`, [id]);

		return row ? this.toWorkspace(row) : undefined;
	}

	async getByAbsolutePath(absolutePath: string): Promise<HorusWorkspace | undefined> {
		const row = await this.connection.get<WorkspaceRow>(`
			SELECT w.*, COUNT(p.id) AS prompt_count
			FROM workspaces w
			LEFT JOIN prompts p ON p.working_directory_id = w.id
			WHERE w.absolute_path = ?
			GROUP BY w.id;
		`, [absolutePath]);

		return row ? this.toWorkspace(row) : undefined;
	}

	async create(data: HorusCreateWorkspaceData): Promise<HorusWorkspace> {
		const id = generateUuid();
		const now = new Date().toISOString();
		const name = data.name.trim() || basename(data.absolutePath);

		await this.connection.run(`
			INSERT INTO workspaces (
				id, owner_id, name, absolute_path, respect_gitignore, enable_ai_context,
				task_number_pattern, created_at_utc, updated_at_utc
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
		`, [
			id,
			HORUS_SYSTEM_USER_ID,
			name,
			data.absolutePath,
			data.respectGitignore === false ? 0 : 1,
			data.enableAiContext ? 1 : 0,
			data.taskNumberPattern ?? null,
			now,
			now
		]);

		const workspace = await this.get(id);
		if (!workspace) {
			throw new Error(`Failed to load created Horus workspace: ${id}`);
		}

		return workspace;
	}

	async getOrCreate(data: HorusCreateWorkspaceData): Promise<HorusWorkspace> {
		const existing = await this.getByAbsolutePath(data.absolutePath);
		if (existing) {
			return existing;
		}

		return this.create(data);
	}

	private toWorkspace(row: WorkspaceRow): HorusWorkspace {
		return {
			id: row.id,
			ownerId: row.owner_id,
			name: row.name,
			absolutePath: row.absolute_path,
			respectGitignore: !!row.respect_gitignore,
			enableAiContext: !!row.enable_ai_context,
			taskNumberPattern: row.task_number_pattern,
			createdAtUtc: row.created_at_utc,
			updatedAtUtc: row.updated_at_utc,
			promptCount: row.prompt_count ?? 0
		};
	}
}
