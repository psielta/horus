import { generateUuid } from '../../../../base/common/uuid.js';
import { HorusCreatePromptTerminalSessionData, HorusPromptTerminalSession, HorusPromptTerminalSessionStatus, HorusUpdatePromptTerminalSessionData } from '../../common/horusTypes.js';
import { HorusSQLiteConnection, HorusSQLiteRow } from '../horusSQLiteConnection.js';

interface PromptTerminalSessionRow extends HorusSQLiteRow {
	readonly id: string;
	readonly prompt_id: string;
	readonly working_directory_id: string;
	readonly terminal_instance_id: number | null;
	readonly terminal_name: string;
	readonly agent_name: string;
	readonly launch_command: string;
	readonly submit_prompt: number;
	readonly status: number;
	readonly started_at_utc: string;
	readonly ended_at_utc: string | null;
	readonly last_activated_at_utc: string | null;
	readonly created_at_utc: string;
	readonly updated_at_utc: string;
}

export class HorusPromptTerminalSessionRepository {

	constructor(private readonly connection: HorusSQLiteConnection) { }

	async listByPrompt(promptId: string): Promise<readonly HorusPromptTerminalSession[]> {
		const rows = await this.connection.all<PromptTerminalSessionRow>(`
			SELECT *
			FROM prompt_terminal_sessions
			WHERE prompt_id = ?
			ORDER BY started_at_utc DESC, id DESC;
		`, [promptId]);

		return rows.map(row => this.toSession(row));
	}

	async get(id: string, target: 'read' | 'write' = 'read'): Promise<HorusPromptTerminalSession | undefined> {
		const row = await this.connection.get<PromptTerminalSessionRow>('SELECT * FROM prompt_terminal_sessions WHERE id = ?;', [id], target);
		return row ? this.toSession(row) : undefined;
	}

	async create(data: HorusCreatePromptTerminalSessionData): Promise<HorusPromptTerminalSession> {
		const id = generateUuid();
		const now = new Date().toISOString();
		const terminalName = data.terminalName.trim() || 'Horus Terminal';
		const agentName = data.agentName.trim() || 'Agent';

		await this.connection.run(`
			INSERT INTO prompt_terminal_sessions (
				id, prompt_id, working_directory_id, terminal_instance_id, terminal_name, agent_name,
				launch_command, submit_prompt, status, started_at_utc, ended_at_utc,
				last_activated_at_utc, created_at_utc, updated_at_utc
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?);
		`, [
			id,
			data.promptId,
			data.workingDirectoryId,
			data.terminalInstanceId ?? null,
			terminalName,
			agentName,
			data.launchCommand,
			data.submitPrompt ? 1 : 0,
			HorusPromptTerminalSessionStatus.Active,
			now,
			now,
			now,
			now
		]);

		const session = await this.get(id, 'write');
		if (!session) {
			throw new Error(`Failed to load created Horus terminal session: ${id}`);
		}

		return session;
	}

	async update(data: HorusUpdatePromptTerminalSessionData): Promise<HorusPromptTerminalSession> {
		const existing = await this.get(data.id, 'write');
		if (!existing) {
			throw new Error('Terminal session was not found.');
		}

		const assignments: string[] = [];
		const params: unknown[] = [];

		if (data.terminalInstanceId !== undefined) {
			assignments.push('terminal_instance_id = ?');
			params.push(data.terminalInstanceId);
		}
		if (data.terminalName !== undefined) {
			assignments.push('terminal_name = ?');
			params.push(data.terminalName.trim() || existing.terminalName);
		}
		if (data.status !== undefined) {
			assignments.push('status = ?');
			params.push(data.status);
		}
		if (data.endedAtUtc !== undefined) {
			assignments.push('ended_at_utc = ?');
			params.push(data.endedAtUtc);
		}
		if (data.lastActivatedAtUtc !== undefined) {
			assignments.push('last_activated_at_utc = ?');
			params.push(data.lastActivatedAtUtc);
		}

		if (!assignments.length) {
			return existing;
		}

		assignments.push('updated_at_utc = ?');
		params.push(new Date().toISOString(), data.id);

		await this.connection.run(`
			UPDATE prompt_terminal_sessions
			SET ${assignments.join(', ')}
			WHERE id = ?;
		`, params);

		const updated = await this.get(data.id, 'write');
		if (!updated) {
			throw new Error(`Failed to load updated Horus terminal session: ${data.id}`);
		}

		return updated;
	}

	private toSession(row: PromptTerminalSessionRow): HorusPromptTerminalSession {
		return {
			id: row.id,
			promptId: row.prompt_id,
			workingDirectoryId: row.working_directory_id,
			terminalInstanceId: row.terminal_instance_id,
			terminalName: row.terminal_name,
			agentName: row.agent_name,
			launchCommand: row.launch_command,
			submitPrompt: row.submit_prompt === 1,
			status: row.status,
			startedAtUtc: row.started_at_utc,
			endedAtUtc: row.ended_at_utc,
			lastActivatedAtUtc: row.last_activated_at_utc,
			createdAtUtc: row.created_at_utc,
			updatedAtUtc: row.updated_at_utc
		};
	}
}
