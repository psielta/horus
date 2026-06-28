import { HorusMigration } from '../../common/horusMigration.js';
import { HORUS_SYSTEM_USER_ID } from '../../common/horusTypes.js';

export const v001Initial: HorusMigration = {
	version: 1,
	description: 'Initial Horus schema ported from Thoth EF configurations',
	statements: [
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			display_name TEXT NOT NULL,
			is_system INTEGER NOT NULL DEFAULT 0,
			created_at_utc TEXT NOT NULL
		);`,

		`CREATE TABLE IF NOT EXISTS workspaces (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			name TEXT NOT NULL,
			absolute_path TEXT NOT NULL,
			respect_gitignore INTEGER NOT NULL DEFAULT 1,
			enable_ai_context INTEGER NOT NULL DEFAULT 0,
			task_number_pattern TEXT,
			created_at_utc TEXT NOT NULL,
			updated_at_utc TEXT NOT NULL,
			FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT
		);`,

		`CREATE TABLE IF NOT EXISTS future_tasks (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			working_directory_id TEXT NOT NULL,
			title TEXT NOT NULL,
			description TEXT NOT NULL,
			status INTEGER NOT NULL,
			type INTEGER NOT NULL,
			issue_github_id TEXT,
			row_version INTEGER NOT NULL DEFAULT 1,
			created_at_utc TEXT NOT NULL,
			updated_at_utc TEXT NOT NULL,
			FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT,
			FOREIGN KEY (working_directory_id) REFERENCES workspaces(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS future_task_labels (
			id TEXT PRIMARY KEY,
			future_task_id TEXT NOT NULL,
			label TEXT NOT NULL,
			FOREIGN KEY (future_task_id) REFERENCES future_tasks(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS prompts (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			working_directory_id TEXT NOT NULL,
			parent_prompt_id TEXT,
			future_task_id TEXT,
			task_number TEXT,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			target_agent INTEGER NOT NULL,
			kind INTEGER NOT NULL,
			status INTEGER NOT NULL,
			current_version INTEGER NOT NULL DEFAULT 1,
			board_rank REAL NOT NULL DEFAULT 0,
			row_version INTEGER NOT NULL DEFAULT 1,
			created_at_utc TEXT NOT NULL,
			updated_at_utc TEXT NOT NULL,
			FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT,
			FOREIGN KEY (working_directory_id) REFERENCES workspaces(id) ON DELETE CASCADE,
			FOREIGN KEY (parent_prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
			FOREIGN KEY (future_task_id) REFERENCES future_tasks(id) ON DELETE SET NULL
		);`,

		`CREATE TABLE IF NOT EXISTS prompt_versions (
			id TEXT PRIMARY KEY,
			prompt_id TEXT NOT NULL,
			version_number INTEGER NOT NULL,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			target_agent INTEGER NOT NULL,
			kind INTEGER NOT NULL,
			status INTEGER NOT NULL,
			change_note TEXT,
			created_at_utc TEXT NOT NULL,
			FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS prompt_file_references (
			id TEXT PRIMARY KEY,
			prompt_id TEXT NOT NULL,
			relative_path TEXT NOT NULL,
			raw_mention TEXT NOT NULL,
			file_exists INTEGER NOT NULL DEFAULT 0,
			resolved_at_utc TEXT,
			FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS linked_documents (
			id TEXT PRIMARY KEY,
			prompt_id TEXT NOT NULL,
			working_directory_id TEXT,
			absolute_path TEXT NOT NULL,
			absolute_path_key TEXT NOT NULL,
			document_type INTEGER NOT NULL,
			display_name TEXT,
			status INTEGER NOT NULL,
			pull_request_reference TEXT,
			current_version INTEGER NOT NULL,
			last_content_hash TEXT,
			last_error TEXT,
			last_synced_at_utc TEXT,
			size_bytes INTEGER,
			created_at_utc TEXT NOT NULL,
			updated_at_utc TEXT NOT NULL,
			FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
			FOREIGN KEY (working_directory_id) REFERENCES workspaces(id) ON DELETE RESTRICT
		);`,

		`CREATE TABLE IF NOT EXISTS linked_document_versions (
			id TEXT PRIMARY KEY,
			linked_document_id TEXT NOT NULL,
			version_number INTEGER NOT NULL,
			content TEXT NOT NULL,
			content_hash TEXT NOT NULL,
			size_bytes INTEGER NOT NULL,
			source INTEGER NOT NULL,
			created_at_utc TEXT NOT NULL,
			FOREIGN KEY (linked_document_id) REFERENCES linked_documents(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS workflow_templates (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			name TEXT NOT NULL,
			is_default INTEGER NOT NULL,
			created_at_utc TEXT NOT NULL,
			updated_at_utc TEXT NOT NULL,
			FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT
		);`,

		`CREATE TABLE IF NOT EXISTS workflow_template_phases (
			id TEXT PRIMARY KEY,
			workflow_template_id TEXT NOT NULL,
			name TEXT NOT NULL,
			default_actor INTEGER NOT NULL,
			order_index INTEGER NOT NULL,
			color TEXT NOT NULL,
			role INTEGER,
			FOREIGN KEY (workflow_template_id) REFERENCES workflow_templates(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS prompt_workflows (
			id TEXT PRIMARY KEY,
			prompt_id TEXT NOT NULL,
			status INTEGER NOT NULL,
			current_phase_id TEXT,
			current_phase_name TEXT,
			current_phase_color TEXT,
			current_actor INTEGER,
			current_phase_iteration INTEGER NOT NULL DEFAULT 1,
			review_verdict_source_phase_name TEXT,
			started_at_utc TEXT NOT NULL,
			entered_current_phase_at_utc TEXT,
			created_at_utc TEXT NOT NULL,
			updated_at_utc TEXT NOT NULL,
			row_version INTEGER NOT NULL DEFAULT 1,
			FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS prompt_workflow_phases (
			id TEXT PRIMARY KEY,
			prompt_workflow_id TEXT NOT NULL,
			name TEXT NOT NULL,
			default_actor INTEGER NOT NULL,
			order_index INTEGER NOT NULL,
			color TEXT NOT NULL,
			role INTEGER,
			FOREIGN KEY (prompt_workflow_id) REFERENCES prompt_workflows(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS prompt_workflow_events (
			id TEXT PRIMARY KEY,
			prompt_workflow_id TEXT NOT NULL,
			type INTEGER NOT NULL,
			phase_id TEXT,
			phase_name_snapshot TEXT,
			actor INTEGER,
			note TEXT,
			occurred_at_utc TEXT NOT NULL,
			FOREIGN KEY (prompt_workflow_id) REFERENCES prompt_workflows(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS ai_chat_sessions (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			working_directory_id TEXT,
			prompt_id TEXT,
			title TEXT NOT NULL,
			model TEXT NOT NULL,
			temperature REAL NOT NULL,
			thinking_enabled INTEGER NOT NULL,
			thinking_budget INTEGER,
			thinking_level TEXT,
			gemini_cache_name TEXT,
			cache_system_instruction_hash TEXT,
			cache_expires_at TEXT,
			cached_through_sequence INTEGER NOT NULL DEFAULT 0,
			created_at_utc TEXT NOT NULL,
			updated_at_utc TEXT NOT NULL,
			FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT,
			FOREIGN KEY (working_directory_id) REFERENCES workspaces(id) ON DELETE SET NULL,
			FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE SET NULL
		);`,

		`CREATE TABLE IF NOT EXISTS ai_chat_messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			role TEXT NOT NULL,
			content TEXT NOT NULL,
			sequence INTEGER NOT NULL,
			prompt_tokens INTEGER,
			candidate_tokens INTEGER,
			cached_tokens INTEGER,
			created_at_utc TEXT NOT NULL,
			FOREIGN KEY (session_id) REFERENCES ai_chat_sessions(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS ai_user_settings (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			model TEXT NOT NULL,
			temperature REAL NOT NULL,
			thinking_enabled INTEGER NOT NULL,
			thinking_budget INTEGER,
			thinking_level TEXT,
			created_at_utc TEXT NOT NULL,
			updated_at_utc TEXT NOT NULL,
			FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT
		);`,

		`CREATE TABLE IF NOT EXISTS app_user_settings (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			show_agent_terminal_offer_after_child_prompt INTEGER NOT NULL DEFAULT 1,
			created_at_utc TEXT NOT NULL,
			updated_at_utc TEXT NOT NULL,
			FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT
		);`,

		`CREATE TABLE IF NOT EXISTS notebooks (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			title TEXT NOT NULL,
			description TEXT,
			working_directory_id TEXT,
			is_archived INTEGER NOT NULL DEFAULT 0,
			created_at_utc TEXT NOT NULL,
			updated_at_utc TEXT NOT NULL,
			FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT,
			FOREIGN KEY (working_directory_id) REFERENCES workspaces(id) ON DELETE SET NULL
		);`,

		`CREATE TABLE IF NOT EXISTS notes (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			notebook_id TEXT NOT NULL,
			title TEXT NOT NULL,
			content_markdown TEXT NOT NULL,
			is_pinned INTEGER NOT NULL DEFAULT 0,
			is_archived INTEGER NOT NULL DEFAULT 0,
			created_at_utc TEXT NOT NULL,
			updated_at_utc TEXT NOT NULL,
			FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT,
			FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS diagrams (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			working_directory_id TEXT NOT NULL,
			title TEXT NOT NULL,
			description TEXT,
			type INTEGER NOT NULL,
			content TEXT NOT NULL,
			metadata_json TEXT,
			is_archived INTEGER NOT NULL DEFAULT 0,
			created_at_utc TEXT NOT NULL,
			updated_at_utc TEXT NOT NULL,
			FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT,
			FOREIGN KEY (working_directory_id) REFERENCES workspaces(id) ON DELETE CASCADE
		);`,

		`CREATE TABLE IF NOT EXISTS daily_task_sequences (
			id TEXT PRIMARY KEY,
			working_directory_id TEXT NOT NULL,
			sequence_date TEXT NOT NULL,
			current_value INTEGER NOT NULL,
			created_at_utc TEXT NOT NULL,
			updated_at_utc TEXT NOT NULL,
			FOREIGN KEY (working_directory_id) REFERENCES workspaces(id) ON DELETE CASCADE
		);`,

		`CREATE UNIQUE INDEX IF NOT EXISTS ux_workspaces_absolute_path ON workspaces(absolute_path);`,
		`CREATE INDEX IF NOT EXISTS ix_future_tasks_workspace_status ON future_tasks(working_directory_id, status);`,
		`CREATE INDEX IF NOT EXISTS ix_future_tasks_workspace_updated ON future_tasks(working_directory_id, updated_at_utc);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_future_task_labels_task_label ON future_task_labels(future_task_id, label);`,
		`CREATE INDEX IF NOT EXISTS ix_prompts_workspace_status ON prompts(working_directory_id, status);`,
		`CREATE INDEX IF NOT EXISTS ix_prompts_workspace_updated ON prompts(working_directory_id, updated_at_utc);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_prompts_workspace_task_number ON prompts(working_directory_id, task_number) WHERE task_number IS NOT NULL;`,
		`CREATE INDEX IF NOT EXISTS ix_prompts_parent_updated ON prompts(parent_prompt_id, updated_at_utc);`,
		`CREATE INDEX IF NOT EXISTS ix_prompts_future_task ON prompts(future_task_id);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_prompt_versions_prompt_version ON prompt_versions(prompt_id, version_number);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_prompt_file_references_prompt_path ON prompt_file_references(prompt_id, relative_path);`,
		`CREATE INDEX IF NOT EXISTS ix_linked_documents_status ON linked_documents(status);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_linked_documents_prompt ON linked_documents(prompt_id);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_linked_document_versions_document_version ON linked_document_versions(linked_document_id, version_number);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_workflow_templates_owner ON workflow_templates(owner_id);`,
		`CREATE INDEX IF NOT EXISTS ix_workflow_template_phases_template_order ON workflow_template_phases(workflow_template_id, order_index);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_prompt_workflows_prompt ON prompt_workflows(prompt_id);`,
		`CREATE INDEX IF NOT EXISTS ix_prompt_workflow_phases_workflow_order ON prompt_workflow_phases(prompt_workflow_id, order_index);`,
		`CREATE INDEX IF NOT EXISTS ix_prompt_workflow_events_workflow_occurred ON prompt_workflow_events(prompt_workflow_id, occurred_at_utc);`,
		`CREATE INDEX IF NOT EXISTS ix_ai_chat_sessions_workspace_updated ON ai_chat_sessions(working_directory_id, updated_at_utc);`,
		`CREATE INDEX IF NOT EXISTS ix_ai_chat_sessions_prompt_updated ON ai_chat_sessions(prompt_id, updated_at_utc);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_chat_messages_session_sequence ON ai_chat_messages(session_id, sequence);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_user_settings_owner ON ai_user_settings(owner_id);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_app_user_settings_owner ON app_user_settings(owner_id);`,
		`CREATE INDEX IF NOT EXISTS ix_notebooks_workspace_updated ON notebooks(working_directory_id, updated_at_utc);`,
		`CREATE INDEX IF NOT EXISTS ix_notes_notebook_updated ON notes(notebook_id, updated_at_utc);`,
		`CREATE INDEX IF NOT EXISTS ix_diagrams_workspace_updated ON diagrams(working_directory_id, updated_at_utc);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ux_daily_task_sequences_workspace_date ON daily_task_sequences(working_directory_id, sequence_date);`,

		`INSERT OR IGNORE INTO users (id, display_name, is_system, created_at_utc)
			VALUES ('${HORUS_SYSTEM_USER_ID}', 'Horus', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));`
	]
};

export const horusMigrations: readonly HorusMigration[] = [v001Initial];
