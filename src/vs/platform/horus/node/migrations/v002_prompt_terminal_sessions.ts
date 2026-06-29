import { HorusMigration } from '../../common/horusMigration.js';

export const v002PromptTerminalSessions: HorusMigration = {
	version: 2,
	description: 'Persist native terminal sessions linked to prompts',
	statements: [
		`CREATE TABLE IF NOT EXISTS prompt_terminal_sessions (
			id TEXT PRIMARY KEY,
			prompt_id TEXT NOT NULL,
			working_directory_id TEXT NOT NULL,
			terminal_instance_id INTEGER,
			terminal_name TEXT NOT NULL,
			agent_name TEXT NOT NULL,
			launch_command TEXT NOT NULL,
			submit_prompt INTEGER NOT NULL DEFAULT 0,
			status INTEGER NOT NULL DEFAULT 1,
			started_at_utc TEXT NOT NULL,
			ended_at_utc TEXT,
			last_activated_at_utc TEXT,
			created_at_utc TEXT NOT NULL,
			updated_at_utc TEXT NOT NULL,
			FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
			FOREIGN KEY (working_directory_id) REFERENCES workspaces(id) ON DELETE CASCADE
		);`,

		`CREATE INDEX IF NOT EXISTS ix_prompt_terminal_sessions_prompt_started
			ON prompt_terminal_sessions(prompt_id, started_at_utc DESC);`,

		`CREATE INDEX IF NOT EXISTS ix_prompt_terminal_sessions_workspace_status
			ON prompt_terminal_sessions(working_directory_id, status);`,

		`CREATE INDEX IF NOT EXISTS ix_prompt_terminal_sessions_instance
			ON prompt_terminal_sessions(terminal_instance_id);`
	]
};
