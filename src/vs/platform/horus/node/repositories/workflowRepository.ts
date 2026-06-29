import { generateUuid } from '../../../../base/common/uuid.js';
import { HORUS_SYSTEM_USER_ID, HorusAdvanceWorkflowToRoleData, HorusChangeWorkflowActorData, HorusCompleteWorkflowData, HorusPromptStatus, HorusReopenWorkflowData, HorusReorderBoardColumnData, HorusReviewVerdictData, HorusSetWorkflowPhaseData, HorusStartWorkflowData, HorusTaskSummary, HorusUpdateTaskPhasesData, HorusUpdateWorkflowTemplateData, HorusWorkflowActor, HorusWorkflowBoardQuery, HorusWorkflowDto, HorusWorkflowEventDto, HorusWorkflowEventType, HorusWorkflowNoteData, HorusWorkflowPhaseDto, HorusWorkflowPhaseInput, HorusWorkflowPhaseRole, HorusWorkflowStatus, HorusWorkflowTemplateDto } from '../../common/horusTypes.js';
import { HorusSQLiteConnection, HorusSQLiteRow } from '../horusSQLiteConnection.js';

interface WorkflowTemplateRow extends HorusSQLiteRow {
	readonly id: string;
	readonly owner_id: string;
	readonly name: string;
	readonly is_default: number;
	readonly created_at_utc: string;
	readonly updated_at_utc: string;
}

interface WorkflowPhaseRow extends HorusSQLiteRow {
	readonly id: string;
	readonly workflow_template_id?: string;
	readonly prompt_workflow_id?: string;
	readonly name: string;
	readonly default_actor: number;
	readonly order_index: number;
	readonly color: string;
	readonly role: number | null;
}

interface WorkflowRow extends HorusSQLiteRow {
	readonly id: string;
	readonly prompt_id: string;
	readonly status: number;
	readonly current_phase_id: string | null;
	readonly current_phase_name: string | null;
	readonly current_phase_color: string | null;
	readonly current_actor: number | null;
	readonly current_phase_iteration: number;
	readonly review_verdict_source_phase_name: string | null;
	readonly started_at_utc: string;
	readonly entered_current_phase_at_utc: string | null;
	readonly created_at_utc: string;
	readonly updated_at_utc: string;
	readonly row_version: number;
}

interface WorkflowEventRow extends HorusSQLiteRow {
	readonly id: string;
	readonly prompt_workflow_id: string;
	readonly type: number;
	readonly phase_id: string | null;
	readonly phase_name_snapshot: string | null;
	readonly actor: number | null;
	readonly note: string | null;
	readonly occurred_at_utc: string;
}

interface BoardPromptRow extends HorusSQLiteRow {
	readonly id: string;
	readonly working_directory_id: string;
	readonly working_directory_name: string | null;
	readonly task_number: string | null;
	readonly title: string;
	readonly content: string;
	readonly status: number;
	readonly row_version: number;
	readonly board_rank: number;
	readonly updated_at_utc: string;
}

interface LinkedDocumentBoardRow extends HorusSQLiteRow {
	readonly id: string;
	readonly prompt_id: string;
	readonly pull_request_reference: string | null;
}

interface PromptChildCountRow extends HorusSQLiteRow {
	readonly parent_prompt_id: string;
	readonly child_count: number;
}

interface CountRow extends HorusSQLiteRow {
	readonly count: number;
}

interface EventCountRow extends HorusSQLiteRow {
	readonly count: number;
}

interface WorkflowPhaseSeed {
	readonly name: string;
	readonly defaultActor: HorusWorkflowActor;
	readonly color: string;
	readonly role: HorusWorkflowPhaseRole;
}

const defaultTemplateName = 'Fluxo padrão';

const defaultPhases: readonly WorkflowPhaseSeed[] = [
	{ name: 'Engenharia de prompt', defaultActor: HorusWorkflowActor.Human, color: '#9333ea', role: HorusWorkflowPhaseRole.PromptEngineering },
	{ name: 'Planejamento', defaultActor: HorusWorkflowActor.ClaudeCode, color: '#2563eb', role: HorusWorkflowPhaseRole.Planning },
	{ name: 'Revisão do plano', defaultActor: HorusWorkflowActor.Codex, color: '#7c3aed', role: HorusWorkflowPhaseRole.PlanReview },
	{ name: 'Correção do plano', defaultActor: HorusWorkflowActor.ClaudeCode, color: '#d97706', role: HorusWorkflowPhaseRole.PlanCorrection },
	{ name: 'Implementação', defaultActor: HorusWorkflowActor.Codex, color: '#0d9488', role: HorusWorkflowPhaseRole.Implementation },
	{ name: 'Revisão de código', defaultActor: HorusWorkflowActor.ClaudeCode, color: '#0891b2', role: HorusWorkflowPhaseRole.CodeReview },
	{ name: 'Correção da revisão', defaultActor: HorusWorkflowActor.Codex, color: '#dc2626', role: HorusWorkflowPhaseRole.ReviewCorrection },
	{ name: 'Teste prático', defaultActor: HorusWorkflowActor.Human, color: '#db2777', role: HorusWorkflowPhaseRole.PracticalTest },
	{ name: 'Atualizar branch com main', defaultActor: HorusWorkflowActor.Codex, color: '#15803d', role: HorusWorkflowPhaseRole.Rebase },
	{ name: 'Commit/Merge', defaultActor: HorusWorkflowActor.Codex, color: '#16a34a', role: HorusWorkflowPhaseRole.Merge }
];

export class HorusWorkflowRepository {

	constructor(private readonly connection: HorusSQLiteConnection) { }

	async getWorkflowTemplate(): Promise<HorusWorkflowTemplateDto> {
		return this.connection.transaction(async () => {
			const { template, phases } = await this.resolveOrCreateTemplate();
			return this.toTemplateDto(template, phases);
		});
	}

	async updateWorkflowTemplate(data: HorusUpdateWorkflowTemplateData): Promise<HorusWorkflowTemplateDto> {
		this.validatePhaseInputs(data.phases);

		return this.connection.transaction(async () => {
			const { template, phases: existing } = await this.resolveOrCreateTemplate();
			const existingById = new Map(existing.map(phase => [phase.id, phase]));
			const keptIds = new Set(data.phases.map(phase => phase.id).filter((id): id is string => !!id));

			for (const phase of existing) {
				if (!keptIds.has(phase.id)) {
					await this.connection.run('DELETE FROM workflow_template_phases WHERE id = ?;', [phase.id]);
				}
			}

			for (const input of data.phases) {
				const name = input.name.trim();
				const role = this.resolveRoleByName(name);
				if (input.id && existingById.has(input.id)) {
					await this.connection.run(`
						UPDATE workflow_template_phases
						SET name = ?, default_actor = ?, order_index = ?, color = ?, role = ?
						WHERE id = ?;
					`, [name, input.defaultActor, input.orderIndex, input.color, role, input.id]);
				} else {
					await this.connection.run(`
						INSERT INTO workflow_template_phases (
							id, workflow_template_id, name, default_actor, order_index, color, role
						) VALUES (?, ?, ?, ?, ?, ?, ?);
					`, [generateUuid(), template.id, name, input.defaultActor, input.orderIndex, input.color, role]);
				}
			}

			const now = new Date().toISOString();
			await this.connection.run('UPDATE workflow_templates SET updated_at_utc = ? WHERE id = ?;', [now, template.id]);
			const updated = await this.getTemplateRow('write');
			if (!updated) {
				throw new Error('Workflow template was not found after update.');
			}

			const phases = await this.loadTemplatePhases(updated.id, 'write');
			return this.toTemplateDto(updated, phases);
		});
	}

	async listBoard(query: HorusWorkflowBoardQuery = {}): Promise<readonly HorusTaskSummary[]> {
		const where: string[] = ['p.owner_id = ?', 'p.parent_prompt_id IS NULL'];
		const params: unknown[] = [HORUS_SYSTEM_USER_ID];

		if (query.workingDirectoryId) {
			where.push('p.working_directory_id = ?');
			params.push(query.workingDirectoryId);
		}

		if (query.promptStatus !== undefined) {
			where.push('p.status = ?');
			params.push(query.promptStatus);
		} else {
			where.push('p.status <> ?');
			params.push(HorusPromptStatus.Archived);
		}

		const search = query.q?.trim().toLowerCase();
		if (search) {
			where.push('(LOWER(p.title) LIKE ? OR LOWER(p.content) LIKE ? OR LOWER(COALESCE(p.task_number, \'\')) LIKE ?)');
			const pattern = `%${search}%`;
			params.push(pattern, pattern, pattern);
		}

		const prompts = await this.connection.all<BoardPromptRow>(`
			SELECT p.id,
				p.working_directory_id,
				w.name AS working_directory_name,
				p.task_number,
				p.title,
				p.content,
				p.status,
				p.row_version,
				p.board_rank,
				p.updated_at_utc
			FROM prompts p
			LEFT JOIN workspaces w ON w.id = p.working_directory_id
			WHERE ${where.join(' AND ')}
			ORDER BY p.board_rank ASC, p.updated_at_utc DESC;
		`, params);

		if (!prompts.length) {
			return [];
		}

		const promptIds = prompts.map(prompt => prompt.id);
		const workflows = await this.loadWorkflowsForPrompts(promptIds);
		const workflowIds = workflows.map(workflow => workflow.id);
		const phasesByWorkflowId = workflowIds.length ? await this.loadPhasesForWorkflows(workflowIds) : new Map<string, HorusWorkflowPhaseDto[]>();
		const childrenByPromptId = await this.loadChildCounts(promptIds);
		const linkedByPromptId = await this.loadLinkedDocumentsForPrompts(promptIds);
		const workflowsByPromptId = new Map(workflows.map(workflow => [workflow.prompt_id, workflow]));

		const summaries: Array<{ readonly boardRank: number; readonly summary: HorusTaskSummary }> = [];
		for (const prompt of prompts) {
			const workflow = workflowsByPromptId.get(prompt.id);
			if (query.workflowStatus !== undefined && (!workflow || workflow.status !== query.workflowStatus)) {
				continue;
			}

			const phases = workflow ? phasesByWorkflowId.get(workflow.id) ?? [] : [];
			const linkedDocument = linkedByPromptId.get(prompt.id);
			const workflowUpdatedAt = workflow?.updated_at_utc;
			const updatedAtUtc = workflowUpdatedAt && workflowUpdatedAt > prompt.updated_at_utc ? workflowUpdatedAt : prompt.updated_at_utc;

			summaries.push({
				boardRank: prompt.board_rank,
				summary: {
					promptId: prompt.id,
					workingDirectoryId: prompt.working_directory_id,
					workingDirectoryName: prompt.working_directory_name ?? '',
					taskNumber: prompt.task_number,
					title: prompt.title,
					promptStatus: prompt.status,
					workflowStatus: workflow ? workflow.status : null,
					currentPhaseId: workflow?.current_phase_id ?? null,
					currentPhaseName: workflow?.current_phase_name ?? null,
					currentPhaseColor: workflow?.current_phase_color ?? null,
					currentActor: workflow?.current_actor ?? null,
					enteredCurrentPhaseAtUtc: workflow?.entered_current_phase_at_utc ?? null,
					currentPhaseIteration: workflow?.current_phase_iteration ?? 1,
					reviewVerdictSourcePhaseName: workflow?.review_verdict_source_phase_name ?? null,
					updatedAtUtc,
					hasChildPrompts: (childrenByPromptId.get(prompt.id) ?? 0) > 0,
					hasLinkedPlan: !!linkedDocument,
					linkedDocumentId: linkedDocument?.id ?? null,
					pullRequestReference: linkedDocument?.pull_request_reference ?? null,
					promptRowVersion: prompt.row_version,
					phases,
					workflowRowVersion: workflow?.row_version ?? null
				}
			});
		}

		return summaries
			.sort((a, b) => a.boardRank - b.boardRank || b.summary.updatedAtUtc.localeCompare(a.summary.updatedAtUtc))
			.map(item => item.summary);
	}

	async getWorkflow(promptId: string): Promise<HorusWorkflowDto | undefined> {
		return this.loadWorkflowDtoByPrompt(promptId);
	}

	async startWorkflow(data: HorusStartWorkflowData): Promise<HorusWorkflowDto> {
		await this.connection.transaction(async () => {
			await this.ensurePromptExists(data.promptId);
			const existing = await this.getWorkflowRowByPrompt(data.promptId, 'write');
			if (existing) {
				throw new Error('A workflow was already started for this prompt.');
			}

			const { phases: templatePhases } = await this.resolveOrCreateTemplate();
			if (!templatePhases.length) {
				throw new Error('The workflow template has no phases.');
			}

			const now = new Date().toISOString();
			const workflowId = generateUuid();
			const snapshot = templatePhases
				.slice()
				.sort((a, b) => a.order_index - b.order_index)
				.map((phase, orderIndex) => ({
					id: generateUuid(),
					name: phase.name,
					defaultActor: phase.default_actor,
					orderIndex,
					color: phase.color,
					role: phase.role
				}));
			const initialIndex = Math.max(0, Math.min(data.initialPhaseOrderIndex ?? 0, snapshot.length - 1));
			const initialPhase = snapshot[initialIndex];

			await this.connection.run(`
				INSERT INTO prompt_workflows (
					id, prompt_id, status, current_phase_id, current_phase_name, current_phase_color,
					current_actor, current_phase_iteration, review_verdict_source_phase_name,
					started_at_utc, entered_current_phase_at_utc, created_at_utc, updated_at_utc, row_version
				) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, ?, ?, 1);
			`, [
				workflowId,
				data.promptId,
				HorusWorkflowStatus.Active,
				initialPhase.id,
				initialPhase.name,
				initialPhase.color,
				initialPhase.defaultActor,
				now,
				now,
				now,
				now
			]);

			for (const phase of snapshot) {
				await this.connection.run(`
					INSERT INTO prompt_workflow_phases (
						id, prompt_workflow_id, name, default_actor, order_index, color, role
					) VALUES (?, ?, ?, ?, ?, ?, ?);
				`, [phase.id, workflowId, phase.name, phase.defaultActor, phase.orderIndex, phase.color, phase.role]);
			}

			await this.appendEvent(workflowId, HorusWorkflowEventType.WorkflowStarted, initialPhase, initialPhase.defaultActor, null, now);
			await this.resetBoardRank(data.promptId);
		});

		return this.requireWorkflowDto(data.promptId);
	}

	async advanceWorkflow(data: { readonly promptId: string; readonly rowVersion: number; readonly note?: string | null }): Promise<HorusWorkflowDto> {
		await this.connection.transaction(async () => {
			const workflow = await this.requireWorkflowForMutation(data.promptId, data.rowVersion);
			this.ensureActive(workflow);
			const phases = await this.loadWorkflowPhaseRows(workflow.id, 'write');
			const current = phases.find(phase => phase.id === workflow.current_phase_id);
			const currentOrder = current?.order_index ?? -1;
			const next = phases.filter(phase => phase.order_index > currentOrder).sort((a, b) => a.order_index - b.order_index)[0];
			const now = new Date().toISOString();

			if (!next) {
				await this.connection.run(`
					UPDATE prompt_workflows
					SET status = ?, updated_at_utc = ?, row_version = row_version + 1
					WHERE id = ?;
				`, [HorusWorkflowStatus.Done, now, workflow.id]);
				await this.appendEvent(workflow.id, HorusWorkflowEventType.Completed, current, workflow.current_actor, this.normalizeNote(data.note), now);
			} else {
				await this.enterPhase(workflow.id, next, next.default_actor, now, 1);
				await this.appendEvent(workflow.id, HorusWorkflowEventType.PhaseChanged, next, next.default_actor, this.normalizeNote(data.note), now);
			}

			await this.resetBoardRank(data.promptId);
		});

		return this.requireWorkflowDto(data.promptId);
	}

	async setWorkflowPhase(data: HorusSetWorkflowPhaseData): Promise<HorusWorkflowDto> {
		await this.connection.transaction(async () => {
			const workflow = await this.requireWorkflowForMutation(data.promptId, data.rowVersion);
			this.ensureActive(workflow);
			const phases = await this.loadWorkflowPhaseRows(workflow.id, 'write');
			const target = phases.find(phase => phase.id === data.phaseId);
			if (!target) {
				throw new Error('Phase was not found.');
			}

			const now = new Date().toISOString();
			const actor = data.actor ?? target.default_actor;
			await this.enterPhase(workflow.id, target, actor, now, 1);
			await this.appendEvent(workflow.id, HorusWorkflowEventType.PhaseChanged, target, actor, this.normalizeNote(data.note), now);
			await this.resetBoardRank(data.promptId);
		});

		return this.requireWorkflowDto(data.promptId);
	}

	async changeActor(data: HorusChangeWorkflowActorData): Promise<HorusWorkflowDto> {
		await this.connection.transaction(async () => {
			const workflow = await this.requireWorkflowForMutation(data.promptId, data.rowVersion);
			this.ensureActive(workflow);
			const phases = await this.loadWorkflowPhaseRows(workflow.id, 'write');
			const current = phases.find(phase => phase.id === workflow.current_phase_id);
			const now = new Date().toISOString();

			await this.connection.run(`
				UPDATE prompt_workflows
				SET current_actor = ?, updated_at_utc = ?, row_version = row_version + 1
				WHERE id = ?;
			`, [data.actor, now, workflow.id]);
			await this.appendEvent(workflow.id, HorusWorkflowEventType.ActorChanged, current, data.actor, this.normalizeNote(data.note), now);
		});

		return this.requireWorkflowDto(data.promptId);
	}

	async addNote(data: HorusWorkflowNoteData): Promise<HorusWorkflowDto> {
		const note = data.note.trim();
		if (!note) {
			throw new Error('Workflow note is required.');
		}

		await this.connection.transaction(async () => {
			const workflow = await this.getWorkflowRowByPrompt(data.promptId, 'write');
			if (!workflow) {
				throw new Error('Workflow was not found.');
			}
			const phases = await this.loadWorkflowPhaseRows(workflow.id, 'write');
			const current = phases.find(phase => phase.id === workflow.current_phase_id);
			await this.appendEvent(workflow.id, HorusWorkflowEventType.Note, current, workflow.current_actor, note, new Date().toISOString());
		});

		return this.requireWorkflowDto(data.promptId);
	}

	async addReviewVerdict(data: HorusReviewVerdictData): Promise<HorusWorkflowDto> {
		const verdict = data.verdict.trim();
		if (!verdict) {
			throw new Error('Review verdict is required.');
		}

		await this.connection.transaction(async () => {
			const workflow = await this.requireWorkflowForMutation(data.promptId, data.rowVersion);
			this.ensureActive(workflow);
			const phases = await this.loadWorkflowPhaseRows(workflow.id, 'write');
			const current = phases.find(phase => phase.id === workflow.current_phase_id);
			if (!current) {
				throw new Error('The current workflow phase was not found.');
			}

			const currentRole = current.role ?? this.resolveRoleByName(current.name);
			const targetRole = currentRole === HorusWorkflowPhaseRole.PlanReview
				? HorusWorkflowPhaseRole.PlanCorrection
				: currentRole === HorusWorkflowPhaseRole.CodeReview
					? HorusWorkflowPhaseRole.ReviewCorrection
					: undefined;
			if (!targetRole) {
				throw new Error('Review verdicts can only be added during plan or code review phases.');
			}

			const target = phases.find(phase => (phase.role ?? this.resolveRoleByName(phase.name)) === targetRole);
			if (!target) {
				throw new Error('No matching correction phase exists for this workflow.');
			}

			if (target.role === null) {
				await this.connection.run('UPDATE prompt_workflow_phases SET role = ? WHERE id = ?;', [targetRole, target.id]);
			}

			const now = new Date().toISOString();
			const reviewerActor = workflow.current_actor;
			await this.appendEvent(workflow.id, HorusWorkflowEventType.Note, current, reviewerActor, verdict, now);
			await this.enterPhase(workflow.id, target, target.default_actor, now, 1);
			await this.appendEvent(workflow.id, HorusWorkflowEventType.PhaseChanged, target, target.default_actor, `Trabalhando no veredito de "${current.name}".`, now);
			await this.connection.run('UPDATE prompt_workflows SET review_verdict_source_phase_name = ? WHERE id = ?;', [current.name, workflow.id]);
			await this.resetBoardRank(data.promptId);
		});

		return this.requireWorkflowDto(data.promptId);
	}

	async completeWorkflow(data: HorusCompleteWorkflowData): Promise<HorusWorkflowDto> {
		await this.connection.transaction(async () => {
			const workflow = await this.requireWorkflowForMutation(data.promptId, data.rowVersion);
			this.ensureActive(workflow);
			const phases = await this.loadWorkflowPhaseRows(workflow.id, 'write');
			const current = phases.find(phase => phase.id === workflow.current_phase_id);
			const now = new Date().toISOString();

			await this.connection.run(`
				UPDATE prompt_workflows
				SET status = ?, updated_at_utc = ?, row_version = row_version + 1
				WHERE id = ?;
			`, [HorusWorkflowStatus.Done, now, workflow.id]);
			await this.appendEvent(workflow.id, HorusWorkflowEventType.Completed, current, workflow.current_actor, this.normalizeNote(data.note), now);
			await this.resetBoardRank(data.promptId);
		});

		return this.requireWorkflowDto(data.promptId);
	}

	async reopenWorkflow(data: HorusReopenWorkflowData): Promise<HorusWorkflowDto> {
		await this.connection.transaction(async () => {
			const workflow = await this.requireWorkflowForMutation(data.promptId, data.rowVersion, false);
			if (workflow.status !== HorusWorkflowStatus.Done) {
				throw new Error('Only finished workflows can be reopened.');
			}

			const phases = await this.loadWorkflowPhaseRows(workflow.id, 'write');
			const target = data.phaseId ? phases.find(phase => phase.id === data.phaseId) : phases.find(phase => phase.id === workflow.current_phase_id);
			if (data.phaseId && !target) {
				throw new Error('Phase was not found.');
			}

			const now = new Date().toISOString();
			if (target) {
				await this.connection.run(`
					UPDATE prompt_workflows
					SET status = ?,
						current_phase_id = ?,
						current_phase_name = ?,
						current_phase_color = ?,
						current_actor = ?,
						current_phase_iteration = 1,
						review_verdict_source_phase_name = NULL,
						entered_current_phase_at_utc = ?,
						updated_at_utc = ?,
						row_version = row_version + 1
					WHERE id = ?;
				`, [HorusWorkflowStatus.Active, target.id, target.name, target.color, target.default_actor, now, now, workflow.id]);
			} else {
				await this.connection.run(`
					UPDATE prompt_workflows
					SET status = ?, updated_at_utc = ?, row_version = row_version + 1
					WHERE id = ?;
				`, [HorusWorkflowStatus.Active, now, workflow.id]);
			}

			await this.appendEvent(workflow.id, HorusWorkflowEventType.Reopened, target, target?.default_actor ?? workflow.current_actor, null, now);
			await this.resetBoardRank(data.promptId);
		});

		return this.requireWorkflowDto(data.promptId);
	}

	async updateTaskPhases(data: HorusUpdateTaskPhasesData): Promise<HorusWorkflowDto> {
		this.validatePhaseInputs(data.phases);

		await this.connection.transaction(async () => {
			const workflow = await this.requireWorkflowForMutation(data.promptId, data.rowVersion, false);
			const existing = await this.loadWorkflowPhaseRows(workflow.id, 'write');
			const events = await this.loadWorkflowEventRows(workflow.id, 'write');
			const idsWithEvents = new Set(events.map(event => event.phase_id).filter((id): id is string => !!id));
			const existingById = new Map(existing.map(phase => [phase.id, phase]));
			const keptIds = new Set(data.phases.map(phase => phase.id).filter((id): id is string => !!id));

			for (const phase of existing) {
				if (keptIds.has(phase.id)) {
					continue;
				}
				if (phase.id === workflow.current_phase_id) {
					throw new Error('The current workflow phase cannot be deleted.');
				}
				if (idsWithEvents.has(phase.id)) {
					throw new Error('Workflow phases with history cannot be deleted.');
				}
				await this.connection.run('DELETE FROM prompt_workflow_phases WHERE id = ?;', [phase.id]);
			}

			for (const input of data.phases) {
				const name = input.name.trim();
				const role = this.resolveRoleByName(name);
				if (input.id && existingById.has(input.id)) {
					const previous = existingById.get(input.id)!;
					await this.connection.run(`
						UPDATE prompt_workflow_phases
						SET name = ?, default_actor = ?, order_index = ?, color = ?, role = ?
						WHERE id = ?;
					`, [name, input.defaultActor, input.orderIndex, input.color, role ?? previous.role, input.id]);
				} else {
					await this.connection.run(`
						INSERT INTO prompt_workflow_phases (
							id, prompt_workflow_id, name, default_actor, order_index, color, role
						) VALUES (?, ?, ?, ?, ?, ?, ?);
					`, [generateUuid(), workflow.id, name, input.defaultActor, input.orderIndex, input.color, role]);
				}
			}

			const now = new Date().toISOString();
			const updatedCurrent = workflow.current_phase_id ? await this.getWorkflowPhaseRow(workflow.current_phase_id, 'write') : undefined;
			await this.connection.run(`
				UPDATE prompt_workflows
				SET current_phase_name = ?,
					current_phase_color = ?,
					updated_at_utc = ?,
					row_version = row_version + 1
				WHERE id = ?;
			`, [updatedCurrent?.name ?? workflow.current_phase_name, updatedCurrent?.color ?? workflow.current_phase_color, now, workflow.id]);
			await this.appendEvent(workflow.id, HorusWorkflowEventType.PhasesEdited, updatedCurrent, workflow.current_actor, null, now);
		});

		return this.requireWorkflowDto(data.promptId);
	}

	async reorderBoardColumn(data: HorusReorderBoardColumnData): Promise<void> {
		const orderedIds = [...data.orderedPromptIds];
		if (new Set(orderedIds).size !== orderedIds.length) {
			throw new Error('Board reorder contains duplicate prompts.');
		}

		if (!orderedIds.length) {
			return;
		}

		await this.connection.transaction(async () => {
			const count = await this.connection.get<CountRow>(`
				SELECT COUNT(*) AS count
				FROM prompts
				WHERE owner_id = ? AND id IN (${this.placeholders(orderedIds)});
			`, [HORUS_SYSTEM_USER_ID, ...orderedIds], 'write');
			if ((count?.count ?? 0) !== orderedIds.length) {
				throw new Error('One or more prompts were not found.');
			}

			for (let index = 0; index < orderedIds.length; index++) {
				await this.connection.run('UPDATE prompts SET board_rank = ? WHERE id = ?;', [index + 1, orderedIds[index]]);
			}
		});
	}

	async advanceWorkflowToRole(data: HorusAdvanceWorkflowToRoleData): Promise<HorusWorkflowDto | undefined> {
		let changed = false;
		await this.connection.transaction(async () => {
			const workflow = await this.getWorkflowRowByPrompt(data.promptId, 'write');
			if (!workflow || workflow.status !== HorusWorkflowStatus.Active) {
				return;
			}

			const phases = await this.loadWorkflowPhaseRows(workflow.id, 'write');
			const target = phases.find(phase => (phase.role ?? this.resolveRoleByName(phase.name)) === data.targetRole);
			if (!target) {
				return;
			}

			if (target.role === null) {
				await this.connection.run('UPDATE prompt_workflow_phases SET role = ? WHERE id = ?;', [data.targetRole, target.id]);
			}

			const priorEntries = await this.connection.get<EventCountRow>(`
				SELECT COUNT(*) AS count
				FROM prompt_workflow_events
				WHERE prompt_workflow_id = ?
					AND phase_id = ?
					AND type = ?
					AND note IS NOT NULL
					AND (note LIKE 'Gerado via %' OR note LIKE 'Re-review #%');
			`, [workflow.id, target.id, HorusWorkflowEventType.PhaseChanged], 'write');
			const iteration = (priorEntries?.count ?? 0) + 1;
			const note = this.buildAutoAdvanceNote(data.sourceName, data.isReReview === true, iteration);
			const now = new Date().toISOString();

			await this.enterPhase(workflow.id, target, target.default_actor, now, iteration);
			await this.appendEvent(workflow.id, HorusWorkflowEventType.PhaseChanged, target, target.default_actor, note, now);
			await this.resetBoardRank(data.promptId);
			changed = true;
		});

		return changed ? this.requireWorkflowDto(data.promptId) : undefined;
	}

	private async resolveOrCreateTemplate(): Promise<{ readonly template: WorkflowTemplateRow; readonly phases: readonly WorkflowPhaseRow[] }> {
		const existing = await this.getTemplateRow('write');
		if (existing) {
			const phases = await this.loadTemplatePhases(existing.id, 'write');
			for (const phase of phases) {
				if (phase.role === null) {
					await this.connection.run('UPDATE workflow_template_phases SET role = ? WHERE id = ?;', [this.resolveRoleByName(phase.name), phase.id]);
				}
			}
			return { template: existing, phases: await this.loadTemplatePhases(existing.id, 'write') };
		}

		const now = new Date().toISOString();
		const templateId = generateUuid();
		await this.connection.run(`
			INSERT INTO workflow_templates (id, owner_id, name, is_default, created_at_utc, updated_at_utc)
			VALUES (?, ?, ?, 1, ?, ?);
		`, [templateId, HORUS_SYSTEM_USER_ID, defaultTemplateName, now, now]);

		for (let index = 0; index < defaultPhases.length; index++) {
			const phase = defaultPhases[index];
			await this.connection.run(`
				INSERT INTO workflow_template_phases (
					id, workflow_template_id, name, default_actor, order_index, color, role
				) VALUES (?, ?, ?, ?, ?, ?, ?);
			`, [generateUuid(), templateId, phase.name, phase.defaultActor, index, phase.color, phase.role]);
		}

		const template = await this.getTemplateRow('write');
		if (!template) {
			throw new Error('Workflow template was not created.');
		}

		return { template, phases: await this.loadTemplatePhases(template.id, 'write') };
	}

	private getTemplateRow(target: 'read' | 'write'): Promise<WorkflowTemplateRow | undefined> {
		return this.connection.get<WorkflowTemplateRow>('SELECT * FROM workflow_templates WHERE owner_id = ?;', [HORUS_SYSTEM_USER_ID], target);
	}

	private loadTemplatePhases(templateId: string, target: 'read' | 'write'): Promise<WorkflowPhaseRow[]> {
		return this.connection.all<WorkflowPhaseRow>(`
			SELECT *
			FROM workflow_template_phases
			WHERE workflow_template_id = ?
			ORDER BY order_index ASC;
		`, [templateId], target);
	}

	private loadWorkflowPhaseRows(workflowId: string, target: 'read' | 'write' = 'read'): Promise<WorkflowPhaseRow[]> {
		return this.connection.all<WorkflowPhaseRow>(`
			SELECT *
			FROM prompt_workflow_phases
			WHERE prompt_workflow_id = ?
			ORDER BY order_index ASC;
		`, [workflowId], target);
	}

	private loadWorkflowEventRows(workflowId: string, target: 'read' | 'write' = 'read'): Promise<WorkflowEventRow[]> {
		return this.connection.all<WorkflowEventRow>(`
			SELECT *
			FROM prompt_workflow_events
			WHERE prompt_workflow_id = ?
			ORDER BY occurred_at_utc ASC;
		`, [workflowId], target);
	}

	private getWorkflowRowByPrompt(promptId: string, target: 'read' | 'write' = 'read'): Promise<WorkflowRow | undefined> {
		return this.connection.get<WorkflowRow>('SELECT * FROM prompt_workflows WHERE prompt_id = ?;', [promptId], target);
	}

	private getWorkflowPhaseRow(phaseId: string, target: 'read' | 'write'): Promise<WorkflowPhaseRow | undefined> {
		return this.connection.get<WorkflowPhaseRow>('SELECT * FROM prompt_workflow_phases WHERE id = ?;', [phaseId], target);
	}

	private async loadWorkflowDtoByPrompt(promptId: string): Promise<HorusWorkflowDto | undefined> {
		const workflow = await this.getWorkflowRowByPrompt(promptId);
		if (!workflow) {
			return undefined;
		}

		const [phases, events] = await Promise.all([
			this.loadWorkflowPhaseRows(workflow.id),
			this.loadWorkflowEventRows(workflow.id)
		]);
		return this.toWorkflowDto(workflow, phases, events);
	}

	private async requireWorkflowDto(promptId: string): Promise<HorusWorkflowDto> {
		const workflow = await this.loadWorkflowDtoByPrompt(promptId);
		if (!workflow) {
			throw new Error('Workflow was not found after mutation.');
		}

		return workflow;
	}

	private async requireWorkflowForMutation(promptId: string, rowVersion: number, requireActive = true): Promise<WorkflowRow> {
		await this.ensurePromptExists(promptId);
		const workflow = await this.getWorkflowRowByPrompt(promptId, 'write');
		if (!workflow) {
			throw new Error('Workflow was not found.');
		}
		if (workflow.row_version !== rowVersion) {
			throw new Error('The workflow was changed by another operation. Reload it before saving.');
		}
		if (requireActive) {
			this.ensureActive(workflow);
		}

		return workflow;
	}

	private ensureActive(workflow: WorkflowRow): void {
		if (workflow.status !== HorusWorkflowStatus.Active) {
			throw new Error('The workflow is finished. Reopen it before changing phases.');
		}
	}

	private async ensurePromptExists(promptId: string): Promise<void> {
		const prompt = await this.connection.get('SELECT id FROM prompts WHERE id = ? AND owner_id = ?;', [promptId, HORUS_SYSTEM_USER_ID], 'write');
		if (!prompt) {
			throw new Error('Prompt was not found.');
		}
	}

	private async enterPhase(workflowId: string, phase: WorkflowPhaseRow | Pick<HorusWorkflowPhaseDto, 'id' | 'name' | 'color' | 'defaultActor'>, actor: HorusWorkflowActor, now: string, iteration: number): Promise<void> {
		const defaultActor = 'defaultActor' in phase ? phase.defaultActor : phase.default_actor;
		await this.connection.run(`
			UPDATE prompt_workflows
			SET current_phase_id = ?,
				current_phase_name = ?,
				current_phase_color = ?,
				current_actor = ?,
				current_phase_iteration = ?,
				review_verdict_source_phase_name = NULL,
				entered_current_phase_at_utc = ?,
				updated_at_utc = ?,
				row_version = row_version + 1
			WHERE id = ?;
		`, [phase.id, phase.name, phase.color, actor ?? defaultActor, iteration, now, now, workflowId]);
	}

	private async appendEvent(workflowId: string, type: HorusWorkflowEventType, phase: WorkflowPhaseRow | Pick<HorusWorkflowPhaseDto, 'id' | 'name'> | undefined, actor: HorusWorkflowActor | number | null, note: string | null, now: string): Promise<void> {
		await this.connection.run(`
			INSERT INTO prompt_workflow_events (
				id, prompt_workflow_id, type, phase_id, phase_name_snapshot, actor, note, occurred_at_utc
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
		`, [generateUuid(), workflowId, type, phase?.id ?? null, phase?.name ?? null, actor, note, now]);
	}

	private resetBoardRank(promptId: string): Promise<void> {
		return this.connection.run('UPDATE prompts SET board_rank = 0 WHERE id = ?;', [promptId]);
	}

	private async loadWorkflowsForPrompts(promptIds: readonly string[]): Promise<WorkflowRow[]> {
		return this.connection.all<WorkflowRow>(`
			SELECT *
			FROM prompt_workflows
			WHERE prompt_id IN (${this.placeholders(promptIds)});
		`, promptIds);
	}

	private async loadPhasesForWorkflows(workflowIds: readonly string[]): Promise<Map<string, HorusWorkflowPhaseDto[]>> {
		const rows = await this.connection.all<WorkflowPhaseRow>(`
			SELECT *
			FROM prompt_workflow_phases
			WHERE prompt_workflow_id IN (${this.placeholders(workflowIds)})
			ORDER BY order_index ASC;
		`, workflowIds);
		const grouped = new Map<string, HorusWorkflowPhaseDto[]>();
		for (const row of rows) {
			const workflowId = row.prompt_workflow_id!;
			const list = grouped.get(workflowId) ?? [];
			list.push(this.toPhaseDto(row));
			grouped.set(workflowId, list);
		}

		return grouped;
	}

	private async loadChildCounts(promptIds: readonly string[]): Promise<Map<string, number>> {
		const rows = await this.connection.all<PromptChildCountRow>(`
			SELECT parent_prompt_id, COUNT(*) AS child_count
			FROM prompts
			WHERE parent_prompt_id IN (${this.placeholders(promptIds)})
			GROUP BY parent_prompt_id;
		`, promptIds);
		return new Map(rows.map(row => [row.parent_prompt_id, row.child_count]));
	}

	private async loadLinkedDocumentsForPrompts(promptIds: readonly string[]): Promise<Map<string, LinkedDocumentBoardRow>> {
		const rows = await this.connection.all<LinkedDocumentBoardRow>(`
			SELECT id, prompt_id, pull_request_reference
			FROM linked_documents
			WHERE prompt_id IN (${this.placeholders(promptIds)})
			ORDER BY created_at_utc ASC, id ASC;
		`, promptIds);
		const byPrompt = new Map<string, LinkedDocumentBoardRow>();
		for (const row of rows) {
			if (!byPrompt.has(row.prompt_id)) {
				byPrompt.set(row.prompt_id, row);
			}
		}

		return byPrompt;
	}

	private validatePhaseInputs(phases: readonly HorusWorkflowPhaseInput[]): void {
		if (!phases.length) {
			throw new Error('A workflow must have at least one phase.');
		}

		for (const phase of phases) {
			if (!phase.name.trim()) {
				throw new Error('Workflow phase name is required.');
			}
			if (!phase.color.trim()) {
				throw new Error('Workflow phase color is required.');
			}
		}
	}

	private normalizeNote(note: string | null | undefined): string | null {
		const normalized = note?.trim();
		return normalized ? normalized : null;
	}

	private buildAutoAdvanceNote(sourceName: string, isReReview: boolean, iteration: number): string {
		const note = `Gerado via "${sourceName.trim() || 'Prompt filho'}"`;
		return isReReview || iteration > 1 ? `Re-review #${iteration} - ${note}` : note;
	}

	private placeholders(values: readonly unknown[]): string {
		if (!values.length) {
			throw new Error('Cannot build SQLite placeholders for an empty list.');
		}

		return values.map(() => '?').join(', ');
	}

	private resolveRoleByName(phaseName: string): HorusWorkflowPhaseRole | null {
		const normalized = this.normalizePhaseName(phaseName);
		for (const phase of defaultPhases) {
			if (this.normalizePhaseName(phase.name) === normalized) {
				return phase.role;
			}
		}

		return normalized === 'correcao de pontos da revisao' ? HorusWorkflowPhaseRole.ReviewCorrection : null;
	}

	private normalizePhaseName(phaseName: string): string {
		return phaseName
			.trim()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase();
	}

	private toTemplateDto(row: WorkflowTemplateRow, phases: readonly WorkflowPhaseRow[]): HorusWorkflowTemplateDto {
		return {
			id: row.id,
			name: row.name,
			phases: phases.map(phase => this.toPhaseDto(phase))
		};
	}

	private toWorkflowDto(row: WorkflowRow, phases: readonly WorkflowPhaseRow[], events: readonly WorkflowEventRow[]): HorusWorkflowDto {
		return {
			id: row.id,
			promptId: row.prompt_id,
			status: row.status,
			currentPhaseId: row.current_phase_id,
			currentPhaseName: row.current_phase_name,
			currentPhaseColor: row.current_phase_color,
			currentActor: row.current_actor,
			startedAtUtc: row.started_at_utc,
			enteredCurrentPhaseAtUtc: row.entered_current_phase_at_utc,
			currentPhaseIteration: row.current_phase_iteration,
			reviewVerdictSourcePhaseName: row.review_verdict_source_phase_name,
			updatedAtUtc: row.updated_at_utc,
			rowVersion: row.row_version,
			phases: phases.map(phase => this.toPhaseDto(phase)),
			events: events.map(event => this.toEventDto(event))
		};
	}

	private toPhaseDto(row: WorkflowPhaseRow): HorusWorkflowPhaseDto {
		return {
			id: row.id,
			name: row.name,
			defaultActor: row.default_actor,
			orderIndex: row.order_index,
			color: row.color,
			role: row.role ?? this.resolveRoleByName(row.name)
		};
	}

	private toEventDto(row: WorkflowEventRow): HorusWorkflowEventDto {
		return {
			id: row.id,
			type: row.type,
			phaseId: row.phase_id,
			phaseNameSnapshot: row.phase_name_snapshot,
			actor: row.actor,
			note: row.note,
			occurredAtUtc: row.occurred_at_utc
		};
	}
}
