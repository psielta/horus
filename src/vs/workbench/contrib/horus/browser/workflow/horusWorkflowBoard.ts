import { generateUuid } from '../../../../../base/common/uuid.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IHorusStorageService } from '../../../../../platform/horus/common/horusStorage.js';
import { HorusPrompt, HorusPromptStatus, HorusPromptTerminalSession, HorusPromptTerminalSessionStatus, HorusTaskSummary, HorusWorkflowActor, HorusWorkflowBoardQuery, HorusWorkflowDto, HorusWorkflowEventType, HorusWorkflowPhaseDto, HorusWorkflowPhaseInput, HorusWorkflowPhaseRole, HorusWorkflowStatus, HorusWorkflowTemplateDto, HorusWorkspace } from '../../../../../platform/horus/common/horusTypes.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ACTIVE_GROUP } from '../../../../services/editor/common/editorService.js';
import { IWebview } from '../../../webview/browser/webview.js';
import { IWebviewWorkbenchService } from '../../../webviewPanel/browser/webviewWorkbenchService.js';
import { WebviewInput } from '../../../webviewPanel/browser/webviewEditorInput.js';
import { WebviewView } from '../../../webviewView/browser/webviewViewService.js';
import { HorusCommandId } from '../../common/horus.js';
import { defaultTerminalLaunchForPrompt, HorusTerminalAgentLaunch, HorusTerminalLauncher } from '../horusTerminalLauncher.js';
import { resolveCurrentHorusWorkspace } from '../horusNativeWorkspaces.js';

const workflowBoardViewType = 'horus.workflowBoard';

type BoardColumnKind = 'no-workflow' | 'phase' | 'done';
type BoardViewMode = 'kanban' | 'vertical';

interface HorusWorkflowBoardControllerOptions {
	readonly initialViewMode: BoardViewMode;
	readonly allowViewModeToggle: boolean;
	readonly showOpenFullBoard: boolean;
}

interface BoardColumn {
	readonly id: string;
	readonly title: string;
	readonly kind: BoardColumnKind;
	readonly tasks: readonly HorusTaskSummary[];
	readonly phaseName?: string;
	readonly phaseOrderIndex?: number;
	readonly droppable: boolean;
}

type WebviewMessage =
	| { readonly command: 'filter'; readonly q?: string; readonly promptStatus?: string; readonly workflowStatus?: string }
	| { readonly command: 'clearFilters' }
	| { readonly command: 'setViewMode'; readonly viewMode: BoardViewMode }
	| { readonly command: 'refresh' }
	| { readonly command: 'openBoardPanel' }
	| { readonly command: 'selectPrompt'; readonly promptId: string }
	| { readonly command: 'openPrompt'; readonly promptId: string }
	| { readonly command: 'openPlan'; readonly promptId: string }
	| { readonly command: 'linkPlan'; readonly promptId: string }
	| { readonly command: 'createChild'; readonly promptId: string }
	| { readonly command: 'startWorkflow'; readonly promptId: string; readonly initialPhaseOrderIndex?: string }
	| { readonly command: 'advanceWorkflow'; readonly promptId: string; readonly rowVersion: string }
	| { readonly command: 'completeWorkflow'; readonly promptId: string; readonly rowVersion: string }
	| { readonly command: 'reopenWorkflow'; readonly promptId: string; readonly rowVersion: string; readonly phaseId?: string }
	| { readonly command: 'setWorkflowPhase'; readonly promptId: string; readonly rowVersion: string; readonly phaseId?: string }
	| { readonly command: 'changeWorkflowActor'; readonly promptId: string; readonly rowVersion: string; readonly actor?: string }
	| { readonly command: 'addWorkflowNote'; readonly promptId: string; readonly value?: string }
	| { readonly command: 'addReviewVerdict'; readonly promptId: string; readonly rowVersion: string; readonly value?: string }
	| { readonly command: 'saveTaskPhases'; readonly promptId: string; readonly rowVersion: string; readonly value?: string }
	| { readonly command: 'launchTerminal'; readonly promptId: string; readonly agent?: string; readonly submitPrompt?: string }
	| { readonly command: 'focusTerminal'; readonly terminalSessionId?: string; readonly terminalInstanceId?: string }
	| { readonly command: 'killTerminal'; readonly terminalSessionId?: string; readonly terminalInstanceId?: string }
	| { readonly command: 'dropTask'; readonly promptId: string; readonly targetColumnId: string; readonly targetPromptId?: string };

let activeBoard: HorusWorkflowBoardPanel | undefined;

export async function openHorusWorkflowBoard(instantiationService: IInstantiationService): Promise<void> {
	if (activeBoard) {
		activeBoard.reveal();
		await activeBoard.refresh();
		return;
	}

	activeBoard = instantiationService.createInstance(HorusWorkflowBoardPanel, () => activeBoard = undefined);
	await activeBoard.open();
}

class HorusWorkflowBoardPanel extends Disposable {

	private input: WebviewInput | undefined;
	private controller: HorusWorkflowBoardController | undefined;

	constructor(
		private readonly onDisposed: () => void,
		@IWebviewWorkbenchService private readonly webviewWorkbenchService: IWebviewWorkbenchService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
	}

	async open(): Promise<void> {
		if (!this.input) {
			this.input = this.webviewWorkbenchService.openWebview({
				providedViewType: workflowBoardViewType,
				origin: undefined,
				title: localize('horusWorkflowBoardTitle', "Horus Workflow"),
				options: {
					enableFindWidget: true,
					retainContextWhenHidden: true
				},
				contentOptions: {
					allowScripts: true,
					allowForms: true
				},
				extension: undefined
			}, workflowBoardViewType, localize('horusWorkflowBoardTitle', "Horus Workflow"), ThemeIcon.fromId('horus-view-icon'), { group: ACTIVE_GROUP });

			this._register(this.input.webview.onDidDispose(() => this.dispose()));
			this.controller = this._register(this.instantiationService.createInstance(HorusWorkflowBoardController, this.input.webview, {
				initialViewMode: 'kanban',
				allowViewModeToggle: true,
				showOpenFullBoard: false
			} satisfies HorusWorkflowBoardControllerOptions));
		}

		await this.refresh();
	}

	reveal(): void {
		if (this.input) {
			this.webviewWorkbenchService.revealWebview(this.input, ACTIVE_GROUP, false);
		}
	}

	async refresh(): Promise<void> {
		await this.controller?.refresh();
	}

	override dispose(): void {
		if (activeBoard === this) {
			activeBoard = undefined;
		}
		this.onDisposed();
		super.dispose();
	}
}

export class HorusWorkflowBoardViewResolver extends Disposable {

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
	}

	async resolve(webviewView: WebviewView): Promise<void> {
		webviewView.title = localize('horusWorkflowBoardViewTitle', "Workflow");
		webviewView.webview.options = {
			...webviewView.webview.options,
			retainContextWhenHidden: true
		};
		webviewView.webview.contentOptions = {
			...webviewView.webview.contentOptions,
			allowScripts: true,
			allowForms: true
		};

		const store = this._register(new DisposableStore());
		const controller = this.instantiationService.createInstance(HorusWorkflowBoardController, webviewView.webview, {
			initialViewMode: 'vertical',
			allowViewModeToggle: false,
			showOpenFullBoard: true
		} satisfies HorusWorkflowBoardControllerOptions);
		store.add(controller);
		store.add(webviewView.onDispose(() => store.dispose()));

		await controller.refresh();
	}
}

class HorusWorkflowBoardController extends Disposable {

	private board: readonly HorusTaskSummary[] = [];
	private template: HorusWorkflowTemplateDto | undefined;
	private currentWorkspace: HorusWorkspace | undefined;
	private columns: readonly BoardColumn[] = [];
	private selectedPromptId: string | undefined;
	private filters: HorusWorkflowBoardQuery = {};
	private viewMode: BoardViewMode;
	private renderSequence = 0;

	constructor(
		private readonly webview: IWebview,
		private readonly options: HorusWorkflowBoardControllerOptions,
		@IHorusStorageService private readonly horusStorageService: IHorusStorageService,
		@ICommandService private readonly commandService: ICommandService,
		@INotificationService private readonly notificationService: INotificationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) {
		super();
		this.viewMode = options.initialViewMode;
		this._register(this.horusStorageService.onDidChangeData(event => {
			if (event.kind === 'prompt' || event.kind === 'linkedDocument' || event.kind === 'workflow' || event.kind === 'terminalSession' || event.kind === 'workspace' || event.kind === 'storage') {
				this.refresh().catch(error => this.notificationService.error(error));
			}
		}));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.refresh().catch(error => this.notificationService.error(error))));
		this._register(this.webview.onMessage(event => this.onMessage(event.message as WebviewMessage)));
	}

	async refresh(): Promise<void> {
		const sequence = ++this.renderSequence;
		const currentWorkspace = await resolveCurrentHorusWorkspace(this.workspaceContextService, this.horusStorageService);
		const [board, template] = await Promise.all([
			currentWorkspace ? this.horusStorageService.listWorkflowBoard({ ...this.filters, workingDirectoryId: currentWorkspace.id }) : Promise.resolve([]),
			this.horusStorageService.getWorkflowTemplate()
		]);

		if (sequence !== this.renderSequence) {
			return;
		}

		this.board = board;
		this.template = template;
		this.currentWorkspace = currentWorkspace;
		this.columns = this.buildColumns(board, template.phases);
		if (this.selectedPromptId && !board.some(task => task.promptId === this.selectedPromptId)) {
			this.selectedPromptId = undefined;
		}

		let selectedWorkflow: HorusWorkflowDto | undefined;
		let selectedPrompt: HorusPrompt | undefined;
		let selectedTerminalSessions: readonly HorusPromptTerminalSession[] = [];
		if (this.selectedPromptId) {
			[selectedWorkflow, selectedPrompt, selectedTerminalSessions] = await Promise.all([
				this.horusStorageService.getWorkflow(this.selectedPromptId),
				this.horusStorageService.getPrompt(this.selectedPromptId),
				this.horusStorageService.listPromptTerminalSessions(this.selectedPromptId)
			]);
		}
		this.webview.setHtml(this.renderHtml(selectedWorkflow, selectedPrompt, selectedTerminalSessions));
	}

	private async onMessage(message: WebviewMessage): Promise<void> {
		try {
			switch (message.command) {
				case 'filter':
					this.filters = this.toFilters(message);
					await this.refresh();
					break;
				case 'clearFilters':
					this.filters = {};
					await this.refresh();
					break;
				case 'setViewMode':
					if (this.options.allowViewModeToggle) {
						this.viewMode = message.viewMode === 'vertical' ? 'vertical' : 'kanban';
					}
					await this.refresh();
					break;
				case 'refresh':
					await this.refresh();
					break;
				case 'openBoardPanel':
					await this.commandService.executeCommand(HorusCommandId.OpenWorkflowBoard);
					break;
				case 'selectPrompt':
					this.selectedPromptId = message.promptId;
					await this.refresh();
					break;
				case 'openPrompt':
					await this.commandService.executeCommand(HorusCommandId.OpenPrompt, message.promptId);
					break;
				case 'openPlan':
					await this.commandService.executeCommand(HorusCommandId.OpenLinkedPlanFile, message.promptId);
					break;
				case 'linkPlan':
					await this.commandService.executeCommand(HorusCommandId.LinkPlanToPrompt, message.promptId);
					break;
				case 'createChild':
					await this.commandService.executeCommand(HorusCommandId.CreateChildPrompt, message.promptId);
					break;
				case 'startWorkflow':
					await this.horusStorageService.startWorkflow({
						promptId: message.promptId,
						initialPhaseOrderIndex: this.parseOptionalNumber(message.initialPhaseOrderIndex) ?? 0
					});
					break;
				case 'advanceWorkflow':
					await this.horusStorageService.advanceWorkflow({ promptId: message.promptId, rowVersion: this.parseRowVersion(message.rowVersion) });
					break;
				case 'completeWorkflow':
					await this.horusStorageService.completeWorkflow({ promptId: message.promptId, rowVersion: this.parseRowVersion(message.rowVersion) });
					break;
				case 'reopenWorkflow':
					await this.horusStorageService.reopenWorkflow({ promptId: message.promptId, rowVersion: this.parseRowVersion(message.rowVersion), phaseId: message.phaseId || null });
					break;
				case 'setWorkflowPhase':
					if (message.phaseId) {
						await this.horusStorageService.setWorkflowPhase({ promptId: message.promptId, rowVersion: this.parseRowVersion(message.rowVersion), phaseId: message.phaseId });
					}
					break;
				case 'changeWorkflowActor': {
					const actor = this.parseActor(message.actor);
					if (actor) {
						await this.horusStorageService.changeWorkflowActor({ promptId: message.promptId, rowVersion: this.parseRowVersion(message.rowVersion), actor });
					}
					break;
				}
				case 'addWorkflowNote':
					if (message.value?.trim()) {
						await this.horusStorageService.addWorkflowNote({ promptId: message.promptId, note: message.value });
					}
					break;
				case 'addReviewVerdict':
					if (message.value?.trim()) {
						await this.horusStorageService.addReviewVerdict({ promptId: message.promptId, rowVersion: this.parseRowVersion(message.rowVersion), verdict: message.value });
					}
					break;
				case 'saveTaskPhases':
					await this.saveTaskPhases(message.promptId, this.parseRowVersion(message.rowVersion), message.value);
					break;
				case 'launchTerminal':
					await this.launchTerminal(message.promptId, message.agent, message.submitPrompt === 'true');
					break;
				case 'focusTerminal':
					await this.focusTerminal(message.terminalSessionId, message.terminalInstanceId);
					break;
				case 'killTerminal':
					await this.killTerminal(message.terminalSessionId, message.terminalInstanceId);
					break;
				case 'dropTask':
					await this.dropTask(message.promptId, message.targetColumnId, message.targetPromptId);
					break;
			}

			await this.refresh();
		} catch (error) {
			this.notificationService.error(error);
		}
	}

	private toFilters(message: Extract<WebviewMessage, { readonly command: 'filter' }>): HorusWorkflowBoardQuery {
		const promptStatus = this.parseOptionalNumber(message.promptStatus);
		const workflowStatus = this.parseOptionalNumber(message.workflowStatus);
		return {
			q: message.q?.trim() || undefined,
			promptStatus: promptStatus as HorusPromptStatus | undefined,
			workflowStatus: workflowStatus as HorusWorkflowStatus | undefined
		};
	}

	private async saveTaskPhases(promptId: string, rowVersion: number, value: string | undefined): Promise<void> {
		if (!value?.trim()) {
			throw new Error('Phase JSON is required.');
		}

		const parsed = JSON.parse(value) as HorusWorkflowPhaseInput[];
		await this.horusStorageService.updateTaskPhases({ promptId, rowVersion, phases: parsed });
	}

	private async launchTerminal(promptId: string, agentValue: string | undefined, submitPrompt: boolean): Promise<void> {
		const prompt = await this.horusStorageService.getPrompt(promptId);
		if (!prompt) {
			throw new Error('Prompt was not found.');
		}

		const workspace = await this.getPromptWorkspace(prompt);
		const agent = this.parseTerminalAgent(agentValue) ?? defaultTerminalLaunchForPrompt(prompt);
		await this.instantiationService.createInstance(HorusTerminalLauncher).launchPrompt(prompt, workspace, agent, submitPrompt);
	}

	private async focusTerminal(terminalSessionId: string | undefined, terminalInstanceIdValue: string | undefined): Promise<void> {
		const terminalInstanceId = this.parseRequiredNumber(terminalInstanceIdValue, 'terminal instance id');
		const focused = await this.instantiationService.createInstance(HorusTerminalLauncher).focusTerminalInstance(terminalInstanceId);
		const now = new Date().toISOString();

		if (terminalSessionId) {
			await this.horusStorageService.updatePromptTerminalSession({
				id: terminalSessionId,
				status: focused ? HorusPromptTerminalSessionStatus.Active : HorusPromptTerminalSessionStatus.Closed,
				lastActivatedAtUtc: focused ? now : undefined,
				endedAtUtc: focused ? undefined : now
			});
		}

		if (!focused) {
			throw new Error('This terminal is no longer available. Run the prompt again to create a new linked terminal.');
		}
	}

	private async killTerminal(terminalSessionId: string | undefined, terminalInstanceIdValue: string | undefined): Promise<void> {
		const terminalInstanceId = this.parseRequiredNumber(terminalInstanceIdValue, 'terminal instance id');
		const killed = await this.instantiationService.createInstance(HorusTerminalLauncher).killTerminalInstance(terminalInstanceId);
		const now = new Date().toISOString();

		if (terminalSessionId) {
			await this.horusStorageService.updatePromptTerminalSession({
				id: terminalSessionId,
				status: HorusPromptTerminalSessionStatus.Closed,
				endedAtUtc: now
			});
		}

		if (!killed) {
			throw new Error('This terminal was not found. The linked session was marked as closed.');
		}
	}

	private async getPromptWorkspace(prompt: HorusPrompt): Promise<HorusWorkspace> {
		const workspace = (await this.horusStorageService.listWorkspaces()).find(candidate => candidate.id === prompt.workingDirectoryId);
		if (!workspace) {
			throw new Error('Prompt workspace was not found.');
		}

		return workspace;
	}

	private async dropTask(promptId: string, targetColumnId: string, targetPromptId: string | undefined): Promise<void> {
		const sourceColumn = this.columns.find(column => column.tasks.some(task => task.promptId === promptId));
		const targetColumn = this.columns.find(column => column.id === targetColumnId);
		if (!sourceColumn || !targetColumn || !targetColumn.droppable) {
			return;
		}

		const task = sourceColumn.tasks.find(candidate => candidate.promptId === promptId);
		if (!task) {
			return;
		}

		if (sourceColumn.id === targetColumn.id) {
			const orderedIds = targetColumn.tasks.map(candidate => candidate.promptId).filter(id => id !== promptId);
			const insertAt = targetPromptId ? orderedIds.indexOf(targetPromptId) : -1;
			if (insertAt >= 0) {
				orderedIds.splice(insertAt, 0, promptId);
			} else {
				orderedIds.push(promptId);
			}
			await this.horusStorageService.reorderBoardColumn({ orderedPromptIds: orderedIds });
			return;
		}

		await this.moveTaskToColumn(task, targetColumn);
	}

	private async moveTaskToColumn(task: HorusTaskSummary, column: BoardColumn): Promise<void> {
		if (column.kind === 'no-workflow') {
			throw new Error('Tasks cannot be moved back to No workflow.');
		}

		if (task.workflowStatus === null) {
			if (column.kind === 'done') {
				throw new Error('Start the workflow before completing this task.');
			}
			if (column.phaseOrderIndex === undefined) {
				throw new Error('This phase is not in the current workflow template.');
			}
			await this.horusStorageService.startWorkflow({ promptId: task.promptId, initialPhaseOrderIndex: column.phaseOrderIndex });
			return;
		}

		const workflow = await this.horusStorageService.getWorkflow(task.promptId);
		if (!workflow) {
			throw new Error('Reload the board before moving this task.');
		}

		if (column.kind === 'done') {
			if (workflow.status === HorusWorkflowStatus.Done) {
				return;
			}
			await this.horusStorageService.completeWorkflow({ promptId: task.promptId, rowVersion: workflow.rowVersion });
			return;
		}

		let target = this.findWorkflowPhase(workflow, column);
		if (!target) {
			target = await this.addPhaseToTask(workflow, column);
		}

		if (workflow.status === HorusWorkflowStatus.Done) {
			await this.horusStorageService.reopenWorkflow({ promptId: task.promptId, rowVersion: workflow.rowVersion, phaseId: target.id });
			return;
		}

		if (workflow.currentPhaseId !== target.id) {
			await this.horusStorageService.setWorkflowPhase({ promptId: task.promptId, rowVersion: workflow.rowVersion, phaseId: target.id });
		}
	}

	private findWorkflowPhase(workflow: HorusWorkflowDto, column: BoardColumn): HorusWorkflowPhaseDto | undefined {
		if (column.phaseName) {
			const byName = workflow.phases.find(phase => phase.name === column.phaseName);
			if (byName) {
				return byName;
			}
		}

		if (column.phaseOrderIndex !== undefined) {
			return workflow.phases.find(phase => phase.orderIndex === column.phaseOrderIndex);
		}

		return undefined;
	}

	private async addPhaseToTask(workflow: HorusWorkflowDto, column: BoardColumn): Promise<HorusWorkflowPhaseDto> {
		const templatePhase = this.template?.phases.find(phase => phase.name === column.phaseName || phase.orderIndex === column.phaseOrderIndex);
		const nextPhase: HorusWorkflowPhaseInput = {
			id: null,
			name: column.phaseName ?? templatePhase?.name ?? 'Nova fase',
			defaultActor: templatePhase?.defaultActor ?? HorusWorkflowActor.Codex,
			orderIndex: column.phaseOrderIndex ?? Math.max(-1, ...workflow.phases.map(phase => phase.orderIndex)) + 1,
			color: templatePhase?.color ?? '#2563eb'
		};
		const existing = workflow.phases.map(phase => ({
			id: phase.id,
			name: phase.name,
			defaultActor: phase.defaultActor,
			orderIndex: phase.orderIndex,
			color: phase.color
		}));
		const updated = await this.horusStorageService.updateTaskPhases({
			promptId: workflow.promptId,
			rowVersion: workflow.rowVersion,
			phases: [...existing, nextPhase].sort((a, b) => a.orderIndex - b.orderIndex)
		});
		const created = updated.phases.find(phase => phase.name === nextPhase.name && phase.orderIndex === nextPhase.orderIndex);
		if (!created) {
			throw new Error('Created workflow phase was not found.');
		}

		return created;
	}

	private buildColumns(tasks: readonly HorusTaskSummary[], templatePhases: readonly HorusWorkflowPhaseDto[]): readonly BoardColumn[] {
		const noWorkflow = tasks.filter(task => task.workflowStatus === null);
		const active = tasks.filter(task => task.workflowStatus === HorusWorkflowStatus.Active);
		const done = tasks.filter(task => task.workflowStatus === HorusWorkflowStatus.Done);
		const activeByPhase = new Map<string, HorusTaskSummary[]>();
		for (const task of active) {
			const key = task.currentPhaseName ?? 'Outras fases';
			const list = activeByPhase.get(key) ?? [];
			list.push(task);
			activeByPhase.set(key, list);
		}

		const columns: BoardColumn[] = [];
		if (noWorkflow.length) {
			columns.push({ id: 'no-workflow', title: localize('horusNoWorkflowColumn', "No workflow"), kind: 'no-workflow', tasks: noWorkflow, droppable: false });
		}

		const orderedTemplatePhases = [...templatePhases].sort((a, b) => a.orderIndex - b.orderIndex);
		for (const phase of orderedTemplatePhases) {
			columns.push({
				id: `phase:${phase.orderIndex}:${phase.name}`,
				title: phase.name,
				kind: 'phase',
				tasks: activeByPhase.get(phase.name) ?? [],
				phaseName: phase.name,
				phaseOrderIndex: phase.orderIndex,
				droppable: true
			});
		}

		const templateNames = new Set(orderedTemplatePhases.map(phase => phase.name));
		for (const [name, list] of activeByPhase) {
			if (!templateNames.has(name)) {
				columns.push({ id: `phase:custom:${name}`, title: name, kind: 'phase', tasks: list, phaseName: name, droppable: true });
			}
		}

		columns.push({ id: 'done', title: localize('horusDoneColumn', "Done"), kind: 'done', tasks: done, droppable: true });
		return columns;
	}

	private renderHtml(selectedWorkflow: HorusWorkflowDto | undefined, selectedPrompt: HorusPrompt | undefined, selectedTerminalSessions: readonly HorusPromptTerminalSession[]): string {
		const nonce = generateUuid();
		const activeFilters = [this.filters.q, this.filters.promptStatus, this.filters.workflowStatus].filter(value => value !== undefined && value !== '').length;
		const workspaceLabel = this.currentWorkspace?.name ?? localize('horusNoWorkspaceOpen', "no workspace open");
		const viewModeAction = this.options.allowViewModeToggle
			? `<button data-command="setViewMode" data-view-mode="${this.viewMode === 'kanban' ? 'vertical' : 'kanban'}">${escapeHtml(this.viewMode === 'kanban' ? localize('horusVerticalView', "Vertical view") : localize('horusKanbanView', "Kanban view"))}</button>`
			: '';
		const openFullBoardAction = this.options.showOpenFullBoard
			? `<button data-command="openBoardPanel">${escapeHtml(localize('horusOpenFullWorkflowBoard', "Open full board"))}</button>`
			: '';
		return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(localize('horusWorkflowBoardTitle', "Horus Workflow"))}</title>
	<style>${this.renderStyles()}</style>
</head>
<body>
	<header class="toolbar">
		<div>
			<h1>${escapeHtml(localize('horusWorkflowBoardTitle', "Horus Workflow"))}</h1>
			<p>${escapeHtml(localize('horusWorkflowBoardSubtitle', "{0} root prompts tracked in {1}", this.board.length, workspaceLabel))}</p>
		</div>
		<div class="toolbar-actions">
			${viewModeAction}
			${openFullBoardAction}
			<button data-command="refresh">${escapeHtml(localize('horusRefreshBoard', "Refresh"))}</button>
		</div>
	</header>
	<form class="filters" data-command="filter">
		<input name="q" value="${escapeAttribute(this.filters.q ?? '')}" placeholder="${escapeAttribute(localize('horusSearchWorkflow', "Search title, task or content"))}">
		<select name="promptStatus">
			<option value="">${escapeHtml(localize('horusNonArchivedPrompts', "Not archived"))}</option>
			${this.renderPromptStatusOption(HorusPromptStatus.Draft, 'Draft')}
			${this.renderPromptStatusOption(HorusPromptStatus.Active, 'Active')}
			${this.renderPromptStatusOption(HorusPromptStatus.Archived, 'Archived')}
		</select>
		<select name="workflowStatus">
			<option value="">${escapeHtml(localize('horusAnyWorkflowStatus', "Any workflow"))}</option>
			${this.renderWorkflowStatusOption(HorusWorkflowStatus.Active, 'Active')}
			${this.renderWorkflowStatusOption(HorusWorkflowStatus.Done, 'Done')}
		</select>
		<button type="submit">${escapeHtml(localize('horusApplyFilters', "Apply"))}</button>
		<button type="button" data-command="clearFilters">${escapeHtml(localize('horusClearFilters', "Clear"))}${activeFilters ? ` (${activeFilters})` : ''}</button>
	</form>
	<main class="layout ${this.viewMode}">
		<section class="board" aria-label="${escapeAttribute(localize('horusWorkflowColumns', "Workflow columns"))}">
			${this.columns.map(column => this.renderColumn(column)).join('')}
		</section>
		<aside class="details">
			${this.renderDetails(selectedWorkflow, selectedPrompt, selectedTerminalSessions)}
		</aside>
	</main>
	<script nonce="${nonce}">
		${this.renderScript()}
	</script>
</body>
</html>`;
	}

	private renderPromptStatusOption(status: HorusPromptStatus, label: string): string {
		return `<option value="${status}" ${this.filters.promptStatus === status ? 'selected' : ''}>${escapeHtml(label)}</option>`;
	}

	private renderWorkflowStatusOption(status: HorusWorkflowStatus, label: string): string {
		return `<option value="${status}" ${this.filters.workflowStatus === status ? 'selected' : ''}>${escapeHtml(label)}</option>`;
	}

	private renderColumn(column: BoardColumn): string {
		return `<section class="column ${column.droppable ? 'droppable' : ''}" data-column-id="${escapeAttribute(column.id)}">
	<header class="column-header">
		<h2>${escapeHtml(column.title)}</h2>
		<span>${column.tasks.length}</span>
	</header>
	<div class="cards">
		${column.tasks.map(task => this.renderTaskCard(task, column.id)).join('') || `<div class="empty">${escapeHtml(localize('horusEmptyColumn', "No tasks"))}</div>`}
	</div>
</section>`;
	}

	private renderTaskCard(task: HorusTaskSummary, columnId: string): string {
		const selected = task.promptId === this.selectedPromptId ? ' selected' : '';
		const actor = task.currentActor ? this.actorLabel(task.currentActor) : undefined;
		const phase = task.currentPhaseName ? this.phaseBadge(task.currentPhaseName, task.currentPhaseColor) : `<span class="badge muted">${escapeHtml(localize('horusWorkflowNotStarted', "Not started"))}</span>`;
		const phases = [...task.phases].sort((a, b) => a.orderIndex - b.orderIndex);
		const currentIndex = phases.findIndex(candidate => candidate.id === task.currentPhaseId);
		const previous = currentIndex > 0 ? phases[currentIndex - 1] : undefined;
		return `<article class="card${selected}" draggable="true" data-prompt-id="${escapeAttribute(task.promptId)}" data-column-id="${escapeAttribute(columnId)}">
	<button class="card-title" data-command="selectPrompt" data-prompt-id="${escapeAttribute(task.promptId)}">
		<span>${task.taskNumber ? `<span class="badge blue">${escapeHtml(task.taskNumber)}</span>` : ''}${escapeHtml(task.title)}</span>
		<small>${escapeHtml(task.workingDirectoryName)}</small>
	</button>
	<div class="badges">
		${phase}
		${actor ? `<span class="badge actor">${escapeHtml(actor)}</span>` : ''}
		${task.currentPhaseIteration > 1 ? `<span class="badge blue">re-review #${task.currentPhaseIteration}</span>` : ''}
		${task.reviewVerdictSourcePhaseName ? `<span class="badge amber">${escapeHtml(localize('horusReviewVerdictBadge', "Verdict: {0}", task.reviewVerdictSourcePhaseName))}</span>` : ''}
		${task.hasLinkedPlan ? '<span class="badge green">plan</span>' : ''}
		${task.hasChildPrompts ? '<span class="badge purple">children</span>' : ''}
		${task.terminalSessionCount > 0 ? `<span class="badge blue">${escapeHtml(localize('horusTerminalCountBadge', "{0}/{1} terminals", task.activeTerminalSessionCount, task.terminalSessionCount))}</span>` : ''}
	</div>
	<div class="card-actions">
		<button data-command="openPrompt" data-prompt-id="${escapeAttribute(task.promptId)}">${escapeHtml(localize('horusOpenPrompt', "Open"))}</button>
		${task.hasLinkedPlan ? `<button data-command="createChild" data-prompt-id="${escapeAttribute(task.promptId)}">${escapeHtml(localize('horusCreateChildFromCard', "Child"))}</button>` : ''}
		${task.workflowStatus === null ? `<button data-command="startWorkflow" data-prompt-id="${escapeAttribute(task.promptId)}">${escapeHtml(localize('horusStartWorkflow', "Start"))}</button>` : ''}
		${previous && task.workflowStatus === HorusWorkflowStatus.Active && task.workflowRowVersion !== null ? `<button data-command="setWorkflowPhase" data-prompt-id="${escapeAttribute(task.promptId)}" data-row-version="${task.workflowRowVersion}" data-phase-id="${escapeAttribute(previous.id)}">${escapeHtml(localize('horusPreviousPhase', "Back"))}</button>` : ''}
		${task.workflowStatus === HorusWorkflowStatus.Active && task.workflowRowVersion !== null ? `<button data-command="advanceWorkflow" data-prompt-id="${escapeAttribute(task.promptId)}" data-row-version="${task.workflowRowVersion}">${escapeHtml(localize('horusAdvanceWorkflow', "Next"))}</button>` : ''}
		${task.workflowStatus === HorusWorkflowStatus.Done && task.workflowRowVersion !== null ? `<button data-command="reopenWorkflow" data-prompt-id="${escapeAttribute(task.promptId)}" data-row-version="${task.workflowRowVersion}">${escapeHtml(localize('horusReopenWorkflow', "Reopen"))}</button>` : ''}
		<button data-command="launchTerminal" data-prompt-id="${escapeAttribute(task.promptId)}" data-submit-prompt="true">${escapeHtml(localize('horusRunAgent', "Run"))}</button>
	</div>
</article>`;
	}

	private renderDetails(workflow: HorusWorkflowDto | undefined, prompt: HorusPrompt | undefined, terminalSessions: readonly HorusPromptTerminalSession[]): string {
		const task = prompt ? this.board.find(candidate => candidate.promptId === prompt.id) : undefined;
		if (!prompt || !task) {
			return `<div class="details-empty">
	<h2>${escapeHtml(localize('horusSelectTask', "Select a task"))}</h2>
	<p>${escapeHtml(localize('horusSelectTaskDetail', "Open details to manage workflow, timeline, child prompts and native terminals."))}</p>
</div>`;
		}

		if (!workflow) {
			return `<div class="details-block">
	<h2>${escapeHtml(prompt.title)}</h2>
	<p class="muted-text">${escapeHtml(localize('horusWorkflowNotStartedDescription', "Workflow not started. Start at any template phase."))}</p>
	<div class="phase-grid">
		${this.template?.phases.map(phase => `<button data-command="startWorkflow" data-prompt-id="${escapeAttribute(prompt.id)}" data-initial-phase-order-index="${phase.orderIndex}">${escapeHtml(phase.name)}</button>`).join('') ?? ''}
	</div>
	${this.renderPromptActions(prompt, task)}
	${this.renderTerminalSessions(terminalSessions)}
</div>`;
		}

		const phases = [...workflow.phases].sort((a, b) => a.orderIndex - b.orderIndex);
		const currentIndex = phases.findIndex(phase => phase.id === workflow.currentPhaseId);
		const previous = currentIndex > 0 ? phases[currentIndex - 1] : undefined;
		const current = phases.find(phase => phase.id === workflow.currentPhaseId);
		const isReview = current?.role === HorusWorkflowPhaseRole.PlanReview || current?.role === HorusWorkflowPhaseRole.CodeReview;
		const phaseJson = JSON.stringify(phases.map(phase => ({
			id: phase.id,
			name: phase.name,
			defaultActor: phase.defaultActor,
			orderIndex: phase.orderIndex,
			color: phase.color
		})), null, 2);

		return `<div class="details-block">
	<h2>${escapeHtml(prompt.title)}</h2>
	<div class="badges large">
		${workflow.currentPhaseName ? this.phaseBadge(workflow.currentPhaseName, workflow.currentPhaseColor) : ''}
		${workflow.currentActor ? `<span class="badge actor">${escapeHtml(this.actorLabel(workflow.currentActor))}</span>` : ''}
		<span class="badge ${workflow.status === HorusWorkflowStatus.Done ? 'green' : 'blue'}">${escapeHtml(workflow.status === HorusWorkflowStatus.Done ? 'Done' : 'Active')}</span>
	</div>
	<div class="details-actions">
		${previous && workflow.status === HorusWorkflowStatus.Active ? `<button data-command="setWorkflowPhase" data-prompt-id="${escapeAttribute(prompt.id)}" data-row-version="${workflow.rowVersion}" data-phase-id="${escapeAttribute(previous.id)}">${escapeHtml(localize('horusPreviousPhase', "Back"))}</button>` : ''}
		${workflow.status === HorusWorkflowStatus.Active ? `<button data-command="advanceWorkflow" data-prompt-id="${escapeAttribute(prompt.id)}" data-row-version="${workflow.rowVersion}">${escapeHtml(localize('horusAdvanceWorkflow', "Next"))}</button>` : ''}
		${workflow.status === HorusWorkflowStatus.Active ? `<button data-command="completeWorkflow" data-prompt-id="${escapeAttribute(prompt.id)}" data-row-version="${workflow.rowVersion}">${escapeHtml(localize('horusCompleteWorkflow', "Complete"))}</button>` : ''}
		${workflow.status === HorusWorkflowStatus.Done ? `<button data-command="reopenWorkflow" data-prompt-id="${escapeAttribute(prompt.id)}" data-row-version="${workflow.rowVersion}">${escapeHtml(localize('horusReopenWorkflow', "Reopen"))}</button>` : ''}
	</div>
	<div class="field-row">
		<label>${escapeHtml(localize('horusWorkflowPhaseLabel', "Phase"))}
			<select id="workflow-phase-select">
				${phases.map(phase => `<option value="${escapeAttribute(phase.id)}" ${phase.id === workflow.currentPhaseId ? 'selected' : ''}>${escapeHtml(phase.name)}</option>`).join('')}
			</select>
		</label>
		<button data-command="setWorkflowPhase" data-prompt-id="${escapeAttribute(prompt.id)}" data-row-version="${workflow.rowVersion}" data-source="workflow-phase-select">${escapeHtml(localize('horusSetPhase', "Set phase"))}</button>
	</div>
	<div class="field-row">
		<label>${escapeHtml(localize('horusWorkflowActorLabel', "Actor"))}
			<select id="workflow-actor-select">
				${this.renderActorOptions(workflow.currentActor)}
			</select>
		</label>
		<button data-command="changeWorkflowActor" data-prompt-id="${escapeAttribute(prompt.id)}" data-row-version="${workflow.rowVersion}" data-source="workflow-actor-select">${escapeHtml(localize('horusSetActor', "Set actor"))}</button>
	</div>
	<label class="stack">${escapeHtml(localize('horusWorkflowNote', "Note"))}
		<textarea id="workflow-note" rows="3" placeholder="${escapeAttribute(localize('horusWorkflowNotePlaceholder', "Append a timeline note"))}"></textarea>
	</label>
	<div class="details-actions">
		<button data-command="addWorkflowNote" data-prompt-id="${escapeAttribute(prompt.id)}" data-source="workflow-note">${escapeHtml(localize('horusAddNote', "Add note"))}</button>
		${isReview ? `<button data-command="addReviewVerdict" data-prompt-id="${escapeAttribute(prompt.id)}" data-row-version="${workflow.rowVersion}" data-source="workflow-note">${escapeHtml(localize('horusAddReviewVerdict', "Add review verdict"))}</button>` : ''}
	</div>
	<details>
		<summary>${escapeHtml(localize('horusEditTaskPhases', "Edit task phases"))}</summary>
		<textarea id="workflow-phases-json" rows="10">${escapeHtml(phaseJson)}</textarea>
		<button data-command="saveTaskPhases" data-prompt-id="${escapeAttribute(prompt.id)}" data-row-version="${workflow.rowVersion}" data-source="workflow-phases-json">${escapeHtml(localize('horusSavePhases', "Save phases"))}</button>
	</details>
	${this.renderPromptActions(prompt, task)}
	${this.renderTerminalSessions(terminalSessions)}
	<section class="timeline">
		<h3>${escapeHtml(localize('horusWorkflowTimeline', "Timeline"))}</h3>
		${workflow.events.map(event => this.renderEvent(event)).join('') || `<p class="muted-text">${escapeHtml(localize('horusNoWorkflowEvents', "No events yet."))}</p>`}
	</section>
</div>`;
	}

	private renderPromptActions(prompt: HorusPrompt, task: HorusTaskSummary): string {
		return `<section class="prompt-actions">
	<h3>${escapeHtml(localize('horusPromptActions', "Prompt actions"))}</h3>
	<div class="details-actions">
		<button data-command="openPrompt" data-prompt-id="${escapeAttribute(prompt.id)}">${escapeHtml(localize('horusOpenPrompt', "Open Prompt"))}</button>
		<button data-command="linkPlan" data-prompt-id="${escapeAttribute(prompt.id)}">${escapeHtml(localize('horusLinkPlan', "Link Plan"))}</button>
		${task.hasLinkedPlan ? `<button data-command="openPlan" data-prompt-id="${escapeAttribute(prompt.id)}">${escapeHtml(localize('horusOpenPlan', "Open Plan"))}</button>` : ''}
		${task.hasLinkedPlan ? `<button data-command="createChild" data-prompt-id="${escapeAttribute(prompt.id)}">${escapeHtml(localize('horusCreateChild', "Create Child"))}</button>` : ''}
	</div>
	<div class="details-actions">
		<button data-command="launchTerminal" data-prompt-id="${escapeAttribute(prompt.id)}" data-submit-prompt="false">${escapeHtml(localize('horusLaunchTerminal', "Launch agent"))}</button>
		<button data-command="launchTerminal" data-prompt-id="${escapeAttribute(prompt.id)}" data-submit-prompt="true">${escapeHtml(localize('horusSubmitToAgent', "Submit prompt"))}</button>
		<button data-command="launchTerminal" data-prompt-id="${escapeAttribute(prompt.id)}" data-agent="ClaudePlan">${escapeHtml(localize('horusClaudePlanTerminal', "Claude plan"))}</button>
		<button data-command="launchTerminal" data-prompt-id="${escapeAttribute(prompt.id)}" data-agent="Codex" data-submit-prompt="true">Codex</button>
	</div>
</section>`;
	}

	private renderTerminalSessions(sessions: readonly HorusPromptTerminalSession[]): string {
		const activeCount = sessions.filter(session => session.status === HorusPromptTerminalSessionStatus.Active).length;
		return `<section class="terminal-sessions">
	<div class="section-title">
		<h3>${escapeHtml(localize('horusLinkedTerminals', "Linked terminals"))}</h3>
		<span class="badge blue">${escapeHtml(localize('horusLinkedTerminalCount', "{0}/{1} active", activeCount, sessions.length))}</span>
	</div>
	${sessions.map(session => this.renderTerminalSession(session)).join('') || `<p class="muted-text">${escapeHtml(localize('horusNoLinkedTerminals', "No terminals are linked to this prompt yet. Use Run or Submit prompt to create one."))}</p>`}
</section>`;
	}

	private renderTerminalSession(session: HorusPromptTerminalSession): string {
		const isActive = session.status === HorusPromptTerminalSessionStatus.Active;
		const statusLabel = isActive ? localize('horusTerminalActive', "Active") : localize('horusTerminalClosed', "Closed");
		const statusClass = isActive ? 'blue' : 'muted';
		const instanceLabel = session.terminalInstanceId !== null
			? localize('horusTerminalInstance', "Terminal #{0}", session.terminalInstanceId)
			: localize('horusTerminalInstanceUnknown', "Terminal instance unknown");
		const focusAction = isActive && session.terminalInstanceId !== null
			? `<button data-command="focusTerminal" data-terminal-session-id="${escapeAttribute(session.id)}" data-terminal-instance-id="${session.terminalInstanceId}">${escapeHtml(localize('horusFocusTerminal', "Focus"))}</button>`
			: '';
		const killAction = isActive && session.terminalInstanceId !== null
			? `<button data-command="killTerminal" data-terminal-session-id="${escapeAttribute(session.id)}" data-terminal-instance-id="${session.terminalInstanceId}">${escapeHtml(localize('horusKillTerminal', "Kill"))}</button>`
			: '';
		const endedLabel = session.endedAtUtc
			? `<span>${escapeHtml(localize('horusTerminalEndedAt', "Closed {0}", new Date(session.endedAtUtc).toLocaleString()))}</span>`
			: '';

		return `<article class="terminal-session">
	<div class="terminal-session-header">
		<strong>${escapeHtml(session.terminalName)}</strong>
		<span class="badge ${statusClass}">${escapeHtml(statusLabel)}</span>
	</div>
	<div class="terminal-meta">
		<span>${escapeHtml(session.agentName)}</span>
		<span>${escapeHtml(instanceLabel)}</span>
		<span>${escapeHtml(localize('horusTerminalStartedAt', "Started {0}", new Date(session.startedAtUtc).toLocaleString()))}</span>
		${endedLabel}
	</div>
	<code>${escapeHtml(session.launchCommand)}</code>
	${focusAction || killAction ? `<div class="details-actions">${focusAction}${killAction}</div>` : ''}
</article>`;
	}

	private renderActorOptions(current: HorusWorkflowActor | null): string {
		return [
			HorusWorkflowActor.ClaudeCode,
			HorusWorkflowActor.Codex,
			HorusWorkflowActor.Human,
			HorusWorkflowActor.Grok
		].map(actor => `<option value="${actor}" ${actor === current ? 'selected' : ''}>${escapeHtml(this.actorLabel(actor))}</option>`).join('');
	}

	private renderEvent(event: HorusWorkflowDto['events'][number]): string {
		return `<article class="event">
	<strong>${escapeHtml(this.eventLabel(event.type))}</strong>
	<span>${escapeHtml(new Date(event.occurredAtUtc).toLocaleString())}</span>
	${event.phaseNameSnapshot ? `<small>${escapeHtml(event.phaseNameSnapshot)}</small>` : ''}
	${event.actor ? `<small>${escapeHtml(this.actorLabel(event.actor))}</small>` : ''}
	${event.note ? `<p>${escapeHtml(event.note)}</p>` : ''}
</article>`;
	}

	private phaseBadge(name: string, color: string | null): string {
		const style = color ? ` style="--phase-color: ${escapeAttribute(color)}"` : '';
		return `<span class="badge phase"${style}>${escapeHtml(name)}</span>`;
	}

	private actorLabel(actor: HorusWorkflowActor): string {
		switch (actor) {
			case HorusWorkflowActor.ClaudeCode:
				return 'Claude';
			case HorusWorkflowActor.Codex:
				return 'Codex';
			case HorusWorkflowActor.Human:
				return 'Você';
			case HorusWorkflowActor.Grok:
				return 'Grok';
		}
	}

	private eventLabel(type: HorusWorkflowEventType): string {
		switch (type) {
			case HorusWorkflowEventType.WorkflowStarted:
				return 'Fluxo iniciado';
			case HorusWorkflowEventType.PhaseChanged:
				return 'Mudou de fase';
			case HorusWorkflowEventType.ActorChanged:
				return 'Trocou responsável';
			case HorusWorkflowEventType.Note:
				return 'Nota';
			case HorusWorkflowEventType.Completed:
				return 'Concluída';
			case HorusWorkflowEventType.Reopened:
				return 'Reaberta';
			case HorusWorkflowEventType.PhasesEdited:
				return 'Fases editadas';
		}
	}

	private parseRowVersion(value: string): number {
		const parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed < 1) {
			throw new Error('Invalid workflow row version.');
		}

		return parsed;
	}

	private parseOptionalNumber(value: string | undefined): number | undefined {
		if (value === undefined || value === '') {
			return undefined;
		}

		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}

	private parseRequiredNumber(value: string | undefined, label: string): number {
		const parsed = this.parseOptionalNumber(value);
		if (parsed === undefined || !Number.isInteger(parsed) || parsed < 0) {
			throw new Error(`Invalid ${label}.`);
		}

		return parsed;
	}

	private parseActor(value: string | undefined): HorusWorkflowActor | undefined {
		const parsed = this.parseOptionalNumber(value);
		return parsed === HorusWorkflowActor.ClaudeCode || parsed === HorusWorkflowActor.Codex || parsed === HorusWorkflowActor.Human || parsed === HorusWorkflowActor.Grok
			? parsed
			: undefined;
	}

	private parseTerminalAgent(value: string | undefined): HorusTerminalAgentLaunch | undefined {
		return value === HorusTerminalAgentLaunch.Claude
			|| value === HorusTerminalAgentLaunch.ClaudePlan
			|| value === HorusTerminalAgentLaunch.Codex
			|| value === HorusTerminalAgentLaunch.Grok
			? value
			: undefined;
	}

	private renderStyles(): string {
		return `
* { box-sizing: border-box; }
body {
	margin: 0;
	padding: 0;
	background: var(--vscode-editor-background);
	color: var(--vscode-editor-foreground);
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size);
}
button, input, select, textarea {
	font: inherit;
	color: var(--vscode-input-foreground);
	background: var(--vscode-input-background);
	border: 1px solid var(--vscode-input-border);
	border-radius: 4px;
}
button {
	cursor: pointer;
	padding: 5px 9px;
	background: var(--vscode-button-secondaryBackground);
	color: var(--vscode-button-secondaryForeground);
}
button:hover { background: var(--vscode-button-secondaryHoverBackground); }
.toolbar, .filters {
	display: flex;
	gap: 10px;
	align-items: center;
	justify-content: space-between;
	padding: 12px 16px;
	border-bottom: 1px solid var(--vscode-panel-border);
}
.toolbar h1 { margin: 0; font-size: 18px; }
.toolbar p, .muted-text { margin: 4px 0 0; color: var(--vscode-descriptionForeground); }
.toolbar-actions, .details-actions, .badges, .field-row, .filters, .phase-grid {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: center;
}
.filters { justify-content: flex-start; }
.filters input { min-width: 260px; }
.filters input, .filters select, textarea { padding: 6px 8px; }
.layout {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
	min-height: calc(100vh - 103px);
}
.layout.vertical { grid-template-columns: minmax(0, 1fr); }
.layout.vertical .board { flex-direction: column; overflow-x: hidden; }
.layout.vertical .column { width: auto; min-height: 160px; }
.layout.vertical .details { border-left: none; border-top: 1px solid var(--vscode-panel-border); }
.board {
	display: flex;
	gap: 12px;
	overflow: auto;
	padding: 14px;
}
.column {
	flex: 0 0 310px;
	display: flex;
	flex-direction: column;
	gap: 10px;
	min-height: calc(100vh - 132px);
	border: 1px solid var(--vscode-panel-border);
	border-radius: 8px;
	background: var(--vscode-sideBar-background);
}
.column.drag-over { outline: 2px solid var(--vscode-focusBorder); }
.column-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 10px 12px;
	border-bottom: 1px solid var(--vscode-panel-border);
}
.column-header h2 { margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: .02em; }
.cards { display: grid; gap: 10px; padding: 10px; }
.card {
	display: grid;
	gap: 9px;
	padding: 10px;
	border: 1px solid var(--vscode-contrastBorder, var(--vscode-panel-border));
	border-radius: 7px;
	background: var(--vscode-editorWidget-background);
}
.card.selected { outline: 2px solid var(--vscode-focusBorder); }
.card.dragging { opacity: .45; }
.card-title {
	display: grid;
	gap: 4px;
	border: 0;
	padding: 0;
	background: transparent;
	color: var(--vscode-editor-foreground);
	text-align: left;
}
.card-title span { font-weight: 600; overflow-wrap: anywhere; }
.card-title small, .event span, .event small { color: var(--vscode-descriptionForeground); }
.card-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.badge {
	display: inline-flex;
	align-items: center;
	border-radius: 999px;
	padding: 2px 7px;
	font-size: 11px;
	background: var(--vscode-badge-background);
	color: var(--vscode-badge-foreground);
}
.badge.phase { background: color-mix(in srgb, var(--phase-color, var(--vscode-focusBorder)) 30%, transparent); border: 1px solid var(--phase-color, var(--vscode-focusBorder)); }
.badge.blue { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.badge.green { background: var(--vscode-testing-iconPassed); color: var(--vscode-editor-background); }
.badge.purple { background: #7c3aed; color: #fff; }
.badge.amber { background: var(--vscode-testing-iconQueued); color: var(--vscode-editor-background); }
.badge.actor { background: var(--vscode-statusBarItem-prominentBackground); color: var(--vscode-statusBarItem-prominentForeground); }
.badge.muted, .empty { color: var(--vscode-descriptionForeground); background: var(--vscode-input-background); }
.details {
	overflow: auto;
	border-left: 1px solid var(--vscode-panel-border);
	background: var(--vscode-sideBar-background);
}
.details-block, .details-empty { display: grid; gap: 12px; padding: 16px; }
.details-block h2, .details-empty h2, .timeline h3, .prompt-actions h3, .terminal-sessions h3 { margin: 0; }
.large .badge { font-size: 12px; }
.field-row label, .stack { display: grid; gap: 5px; }
.field-row select { min-width: 190px; }
textarea { width: 100%; resize: vertical; }
details { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 8px; }
summary { cursor: pointer; }
.timeline, .terminal-sessions { display: grid; gap: 8px; }
.section-title, .terminal-session-header, .terminal-meta {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: center;
}
.section-title, .terminal-session-header { justify-content: space-between; }
.terminal-session {
	display: grid;
	gap: 6px;
	padding: 8px;
	border: 1px solid var(--vscode-panel-border);
	border-radius: 6px;
	background: var(--vscode-editorWidget-background);
}
.terminal-session code {
	display: block;
	padding: 5px 7px;
	border-radius: 4px;
	color: var(--vscode-textPreformat-foreground);
	background: var(--vscode-textCodeBlock-background);
	overflow-wrap: anywhere;
}
.terminal-meta { color: var(--vscode-descriptionForeground); font-size: 12px; }
.event {
	display: grid;
	gap: 3px;
	padding: 8px;
	border-left: 2px solid var(--vscode-focusBorder);
	background: var(--vscode-editorWidget-background);
}
.event p { margin: 2px 0 0; white-space: pre-wrap; }
.empty { padding: 12px; text-align: center; border-radius: 6px; }
@media (max-width: 900px) {
	.toolbar, .filters {
		align-items: stretch;
		flex-direction: column;
		padding: 10px;
	}
	.toolbar-actions, .details-actions, .field-row, .filters {
		align-items: stretch;
	}
	.filters input, .filters select, .filters button, .toolbar-actions button {
		width: 100%;
		min-width: 0;
	}
	.layout {
		grid-template-columns: minmax(0, 1fr);
		min-height: auto;
	}
	.board {
		flex-direction: column;
		overflow-x: hidden;
		padding: 10px;
	}
	.column {
		flex: none;
		width: auto;
		min-height: 160px;
	}
	.details {
		border-left: none;
		border-top: 1px solid var(--vscode-panel-border);
	}
}
`;
	}

	private renderScript(): string {
		return `
const vscode = acquireVsCodeApi();
let dragged = null;

function post(message) {
	vscode.postMessage(message);
}

document.addEventListener('submit', event => {
	const form = event.target.closest('form[data-command]');
	if (!form) {
		return;
	}
	event.preventDefault();
	const data = Object.fromEntries(new FormData(form).entries());
	post({ command: form.dataset.command, ...data });
});

document.addEventListener('click', event => {
	const button = event.target.closest('[data-command]');
	if (!button || button.tagName === 'FORM') {
		return;
	}
	const message = { command: button.dataset.command };
	for (const [key, value] of Object.entries(button.dataset)) {
		if (key !== 'command' && key !== 'source') {
			message[key] = value;
		}
	}
	if (button.dataset.source) {
		const source = document.getElementById(button.dataset.source);
		if (source) {
			if (button.dataset.command === 'setWorkflowPhase') {
				message.phaseId = source.value;
			} else if (button.dataset.command === 'changeWorkflowActor') {
				message.actor = source.value;
			} else {
				message.value = source.value;
			}
		}
	}
	post(message);
});

document.addEventListener('dragstart', event => {
	const card = event.target.closest('.card[data-prompt-id]');
	if (!card) {
		return;
	}
	dragged = { promptId: card.dataset.promptId, columnId: card.dataset.columnId };
	card.classList.add('dragging');
	event.dataTransfer.effectAllowed = 'move';
	event.dataTransfer.setData('text/plain', card.dataset.promptId);
});

document.addEventListener('dragend', event => {
	const card = event.target.closest('.card');
	if (card) {
		card.classList.remove('dragging');
	}
	document.querySelectorAll('.drag-over').forEach(element => element.classList.remove('drag-over'));
	dragged = null;
});

document.addEventListener('dragover', event => {
	if (!dragged) {
		return;
	}
	const column = event.target.closest('.column.droppable');
	if (!column) {
		return;
	}
	event.preventDefault();
	column.classList.add('drag-over');
});

document.addEventListener('dragleave', event => {
	const column = event.target.closest('.column');
	if (column && !column.contains(event.relatedTarget)) {
		column.classList.remove('drag-over');
	}
});

document.addEventListener('drop', event => {
	if (!dragged) {
		return;
	}
	const column = event.target.closest('.column.droppable');
	if (!column) {
		return;
	}
	event.preventDefault();
	column.classList.remove('drag-over');
	const targetCard = event.target.closest('.card[data-prompt-id]');
	post({
		command: 'dropTask',
		promptId: dragged.promptId,
		targetColumnId: column.dataset.columnId,
		targetPromptId: targetCard && targetCard.dataset.promptId !== dragged.promptId ? targetCard.dataset.promptId : undefined
	});
});
`;
	}
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
	return escapeHtml(value).replace(/`/g, '&#96;');
}
