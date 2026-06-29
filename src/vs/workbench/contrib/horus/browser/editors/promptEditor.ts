import '../views/horusViews.css';
import * as DOM from '../../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Dimension } from '../../../../../base/browser/dom.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { joinPath, relativePath as resourceRelativePath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IEditorConstructionOptions } from '../../../../../editor/browser/config/editorConfiguration.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { IEditorDecorationsCollection } from '../../../../../editor/common/editorCommon.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { CompletionContext, CompletionItem, CompletionItemKind, CompletionList, ILinksList } from '../../../../../editor/common/languages.js';
import { IModelDeltaDecoration, ITextModel, TrackedRangeStickiness } from '../../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IHorusStorageService } from '../../../../../platform/horus/common/horusStorage.js';
import { extractHorusFileMentions } from '../../../../../platform/horus/common/horusMentions.js';
import { HorusFileMentionValidationResult, HorusLinkedDocument, HorusLinkedDocumentStatus, HorusPrompt, HorusPromptKind, HorusPromptStatus, HorusPromptTerminalSession, HorusPromptTerminalSessionStatus, HorusTargetAgent, HorusWorkspace } from '../../../../../platform/horus/common/horusTypes.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { ISearchService, QueryType } from '../../../../services/search/common/search.js';
import { horusWorkbenchState } from '../horusWorkbenchState.js';
import { HorusCommandId } from '../../common/horus.js';
import { HorusPromptEditorInput } from './promptEditorInput.js';
import { defaultTerminalLaunchForPrompt, HorusTerminalAgentLaunch, HorusTerminalLauncher } from '../horusTerminalLauncher.js';

interface HorusPromptEditorElements {
	readonly root: HTMLElement;
	readonly title: HTMLInputElement;
	readonly targetAgent: HTMLSelectElement;
	readonly kind: HTMLSelectElement;
	readonly status: HTMLSelectElement;
	readonly editorBody: HTMLElement;
	readonly editorContainer: HTMLElement;
	readonly previewContainer: HTMLElement;
	readonly createChildButton: HTMLButtonElement;
	readonly saveButton: HTMLButtonElement;
	readonly viewModeButtons: ReadonlyMap<HorusPromptEditorViewMode, HTMLButtonElement>;
	readonly validation: HTMLElement;
	readonly linkedPlan: HTMLElement;
	readonly terminalControls: HTMLElement;
	readonly statusMessage: HTMLElement;
	readonly metadata: HTMLElement;
}

interface HorusPromptEditorSnapshot {
	readonly title: string;
	readonly targetAgent: HorusTargetAgent;
	readonly kind: HorusPromptKind;
	readonly status: HorusPromptStatus;
	readonly content: string;
}

type HorusPromptEditorViewMode = 'editor' | 'preview' | 'split';

const horusFileMentionExcludePattern = {
	'.git': true,
	'.git/**': true,
	'**/.git': true,
	'**/.git/**': true
};

const horusFileMentionPattern = /(^|[\s([{"'])@["']?([^\s@]+)/g;
const horusTrailingPathPunctuationPattern = /[)"',.;:!?]+$/;

interface HorusFileMentionOccurrence {
	readonly relativePath: string;
	readonly range: Range;
}

export class HorusPromptEditor extends EditorPane {

	static readonly ID = HorusPromptEditorInput.EDITOR_ID;

	private readonly contentDisposables = this._register(new DisposableStore());
	private readonly previewDisposables = this._register(new DisposableStore());
	private readonly terminalControlsDisposables = this._register(new DisposableStore());
	private readonly mentionValidationScheduler = this._register(new RunOnceScheduler(() => this.validateMentions().catch(error => this.showStatus(String(error), true)), 300));
	private readonly previewRenderScheduler = this._register(new RunOnceScheduler(() => this.renderMarkdownPreview(), 150));

	private container: HTMLElement | undefined;
	private elements: HorusPromptEditorElements | undefined;
	private codeEditor: CodeEditorWidget | undefined;
	private promptModel: ITextModel | undefined;
	private mentionDecorations: IEditorDecorationsCollection | undefined;
	private lastDimension: Dimension | undefined;
	private currentInput: HorusPromptEditorInput | undefined;
	private currentPrompt: HorusPrompt | undefined;
	private currentWorkspace: HorusWorkspace | undefined;
	private savedSnapshot: HorusPromptEditorSnapshot | undefined;
	private viewMode: HorusPromptEditorViewMode = 'split';
	private dirty = false;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@IMarkdownRendererService private readonly markdownRendererService: IMarkdownRendererService,
		@ISearchService private readonly searchService: ISearchService,
		@IHorusStorageService private readonly horusStorageService: IHorusStorageService,
		@ICommandService private readonly commandService: ICommandService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super(HorusPromptEditor.ID, group, telemetryService, themeService, storageService);
		this._register(this.horusStorageService.onDidChangeData(event => {
			if (this.currentPrompt && (event.kind === 'linkedDocument' || event.kind === 'prompt' || event.kind === 'storage')) {
				this.renderLinkedPlanSummary().catch(error => this.showStatus(String(error), true));
			}
			if (this.currentPrompt && (event.kind === 'terminalSession' || event.kind === 'prompt' || event.kind === 'storage')) {
				this.renderTerminalControls().catch(error => this.showStatus(String(error), true));
			}
		}));
	}

	protected override createEditor(parent: HTMLElement): void {
		this.container = DOM.append(parent, DOM.$('.horus-prompt-editor'));
	}

	override async setInput(input: HorusPromptEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.currentInput?.setSaveHandler(undefined);
		this.currentInput?.setRevertHandler(undefined);
		this.currentInput = input;
		await this.loadPrompt(input.promptId, token);
	}

	override clearInput(): void {
		this.clearEditorContent();
		this.mentionValidationScheduler.cancel();
		this.elements = undefined;
		this.currentInput = undefined;
		this.currentPrompt = undefined;
		this.currentWorkspace = undefined;
		this.savedSnapshot = undefined;
		this.dirty = false;

		if (this.container) {
			DOM.clearNode(this.container);
		}

		super.clearInput();
	}

	override layout(dimension: Dimension): void {
		this.lastDimension = dimension;
		this.codeEditor?.layout();
	}

	private clearEditorContent(): void {
		this.previewRenderScheduler.cancel();
		this.previewDisposables.clear();
		this.terminalControlsDisposables.clear();
		this.currentInput?.setSaveHandler(undefined);
		this.currentInput?.setRevertHandler(undefined);
		this.mentionDecorations?.clear();
		this.mentionDecorations = undefined;
		this.codeEditor?.setModel(null);
		this.codeEditor = undefined;
		this.promptModel = undefined;
		this.contentDisposables.clear();
	}

	private async loadPrompt(promptId: string, token: CancellationToken): Promise<void> {
		if (!this.container) {
			return;
		}

		this.clearEditorContent();
		DOM.clearNode(this.container);
		this.container.appendChild(DOM.$('.horus-editor-loading', undefined, localize('horusPromptEditorLoading', "Loading Horus prompt...")));

		const prompt = await this.horusStorageService.getPrompt(promptId);
		if (token.isCancellationRequested) {
			return;
		}

		if (!prompt) {
			DOM.clearNode(this.container);
			this.container.appendChild(DOM.$('.horus-editor-empty', undefined, localize('horusPromptEditorMissing', "The selected Horus prompt no longer exists.")));
			return;
		}

		const workspace = (await this.horusStorageService.listWorkspaces()).find(candidate => candidate.id === prompt.workingDirectoryId);
		if (token.isCancellationRequested) {
			return;
		}

		this.currentPrompt = prompt;
		this.currentWorkspace = workspace;
		this.savedSnapshot = this.toSnapshot(prompt);
		const draft = this.currentInput?.getDraft();
		const promptToRender = draft ? { ...prompt, ...draft } : prompt;
		this.dirty = !!draft;
		this.currentInput?.setName(promptToRender.title);
		horusWorkbenchState.setSelectedWorkspaceId(prompt.workingDirectoryId);
		horusWorkbenchState.setSelectedPromptId(prompt.id);
		this.render(promptToRender);
		this.scheduleMentionValidation();
	}

	private render(prompt: HorusPrompt): void {
		if (!this.container) {
			return;
		}

		DOM.clearNode(this.container);

		const root = DOM.append(this.container, DOM.$('.horus-editor-root'));
		const header = DOM.append(root, DOM.$('.horus-editor-header'));
		const title = DOM.append(header, DOM.$('input.horus-editor-title')) as HTMLInputElement;
		title.type = 'text';
		title.value = prompt.title;
		title.placeholder = localize('horusPromptEditorTitlePlaceholder', "Prompt title");

		const metadata = DOM.append(header, DOM.$('.horus-editor-metadata'));
		this.setMetadata(metadata, prompt);

		const controls = DOM.append(root, DOM.$('.horus-editor-controls'));
		const targetAgent = this.renderSelect<HorusTargetAgent>(controls, localize('horusPromptEditorAgent', "Agent"), [
			{ label: 'Claude Code', value: HorusTargetAgent.ClaudeCode },
			{ label: 'Codex', value: HorusTargetAgent.Codex },
			{ label: 'Grok', value: HorusTargetAgent.Grok }
		], prompt.targetAgent);
		const kind = this.renderSelect<HorusPromptKind>(controls, localize('horusPromptEditorKind', "Kind"), [
			{ label: localize('horusPromptKindGeneral', "General"), value: HorusPromptKind.General },
			{ label: localize('horusPromptKindPlan', "Plan"), value: HorusPromptKind.Plan },
			{ label: localize('horusPromptKindReview', "Review"), value: HorusPromptKind.Review },
			{ label: localize('horusPromptKindImplementation', "Implementation"), value: HorusPromptKind.Implementation }
		], prompt.kind);
		const status = this.renderSelect<HorusPromptStatus>(controls, localize('horusPromptEditorStatus', "Status"), [
			{ label: localize('horusPromptStatusDraft', "Draft"), value: HorusPromptStatus.Draft },
			{ label: localize('horusPromptStatusActive', "Active"), value: HorusPromptStatus.Active },
			{ label: localize('horusPromptStatusArchived', "Archived"), value: HorusPromptStatus.Archived }
		], prompt.status);

		const toolbar = DOM.append(root, DOM.$('.horus-editor-toolbar'));
		const statusMessage = DOM.append(toolbar, DOM.$('.horus-editor-status'));
		const viewModeButtons = this.renderViewModeButtons(toolbar);
		const comparePromptButton = DOM.append(toolbar, DOM.$('button.horus-button.horus-editor-toolbar-button')) as HTMLButtonElement;
		comparePromptButton.textContent = localize('horusPromptEditorComparePrompt', "Compare Prompt");
		const createChildButton = DOM.append(toolbar, DOM.$('button.horus-button.horus-editor-toolbar-button')) as HTMLButtonElement;
		createChildButton.textContent = localize('horusPromptEditorCreateChild', "Create Child");
		createChildButton.disabled = true;
		const linkPlanButton = DOM.append(toolbar, DOM.$('button.horus-button.horus-editor-toolbar-button')) as HTMLButtonElement;
		linkPlanButton.textContent = localize('horusPromptEditorLinkPlan', "Link Plan");
		const openPlanButton = DOM.append(toolbar, DOM.$('button.horus-button.horus-editor-toolbar-button')) as HTMLButtonElement;
		openPlanButton.textContent = localize('horusPromptEditorOpenPlan', "Open Plan");
		const syncPlanButton = DOM.append(toolbar, DOM.$('button.horus-button.horus-editor-toolbar-button')) as HTMLButtonElement;
		syncPlanButton.textContent = localize('horusPromptEditorSyncPlan', "Sync Plan");
		const comparePlanButton = DOM.append(toolbar, DOM.$('button.horus-button.horus-editor-toolbar-button')) as HTMLButtonElement;
		comparePlanButton.textContent = localize('horusPromptEditorComparePlan', "Compare Plan");
		const saveButton = DOM.append(toolbar, DOM.$('button.horus-button.horus-editor-save')) as HTMLButtonElement;
		saveButton.textContent = localize('horusPromptEditorSave', "Save Prompt");

		const linkedPlan = DOM.append(root, DOM.$('.horus-editor-linked-plan'));
		const terminalControls = DOM.append(root, DOM.$('.horus-editor-terminals'));
		const editorBody = DOM.append(root, DOM.$('.horus-editor-body'));
		const editorContainer = DOM.append(editorBody, DOM.$('.horus-editor-content'));
		editorContainer.setAttribute('aria-label', localize('horusPromptEditorContentAriaLabel', "Horus prompt Markdown editor. Mention workspace files with @path/to/file."));
		this.createMarkdownEditor(editorContainer, prompt);
		const previewContainer = DOM.append(editorBody, DOM.$('.horus-editor-preview'));
		previewContainer.setAttribute('aria-label', localize('horusPromptEditorPreviewAriaLabel', "Rendered Markdown preview."));

		const validation = DOM.append(root, DOM.$('.horus-editor-mentions'));

		this.elements = { root, title, targetAgent, kind, status, editorBody, editorContainer, previewContainer, createChildButton, saveButton, viewModeButtons, validation, linkedPlan, terminalControls, statusMessage, metadata };
		this.currentInput?.setSaveHandler(() => this.save());
		this.currentInput?.setRevertHandler(() => this.revertDraft());

		for (const element of [title, targetAgent, kind, status]) {
			this.contentDisposables.add(DOM.addDisposableListener(element, DOM.EventType.INPUT, () => this.onEditorChanged()));
		}

		this.contentDisposables.add(DOM.addDisposableListener(saveButton, DOM.EventType.CLICK, () => this.save().catch(error => this.notificationService.error(error))));
		this.contentDisposables.add(DOM.addDisposableListener(comparePromptButton, DOM.EventType.CLICK, () => this.commandService.executeCommand(HorusCommandId.OpenPromptVersionDiff, prompt.id)));
		this.contentDisposables.add(DOM.addDisposableListener(createChildButton, DOM.EventType.CLICK, () => this.commandService.executeCommand(HorusCommandId.CreateChildPrompt, prompt.id)));
		this.contentDisposables.add(DOM.addDisposableListener(linkPlanButton, DOM.EventType.CLICK, () => this.commandService.executeCommand(HorusCommandId.LinkPlanToPrompt, prompt.id)));
		this.contentDisposables.add(DOM.addDisposableListener(openPlanButton, DOM.EventType.CLICK, () => this.commandService.executeCommand(HorusCommandId.OpenLinkedPlanFile, prompt.id)));
		this.contentDisposables.add(DOM.addDisposableListener(syncPlanButton, DOM.EventType.CLICK, () => this.commandService.executeCommand(HorusCommandId.SyncLinkedPlan, prompt.id)));
		this.contentDisposables.add(DOM.addDisposableListener(comparePlanButton, DOM.EventType.CLICK, () => this.commandService.executeCommand(HorusCommandId.OpenLinkedPlanDiff, prompt.id)));
		this.applyViewMode();
		this.renderLinkedPlanSummary().catch(error => this.showStatus(String(error), true));
		this.renderTerminalControls().catch(error => this.showStatus(String(error), true));
		this.schedulePreviewRender();
		this.showStatus(localize('horusPromptEditorReady', "Ready."), false);
		this.updateDirtyState();
	}

	private async renderLinkedPlanSummary(): Promise<void> {
		if (!this.elements || !this.currentPrompt) {
			return;
		}

		DOM.clearNode(this.elements.linkedPlan);
		const document = await this.horusStorageService.getLinkedDocumentForPrompt(this.currentPrompt.id);
		if (!document) {
			this.elements.createChildButton.disabled = true;
			this.elements.createChildButton.title = localize('horusPromptEditorCreateChildNeedsPlan', "Link a plan before creating child prompts.");
			this.elements.linkedPlan.textContent = localize('horusPromptEditorNoLinkedPlan', "No linked plan. Use Link Plan to monitor an external Markdown plan.");
			return;
		}

		this.elements.createChildButton.disabled = false;
		this.elements.createChildButton.title = localize('horusPromptEditorCreateChildFromPlan', "Create a child prompt from the linked plan.");
		const summary = DOM.append(this.elements.linkedPlan, DOM.$('.horus-editor-linked-plan-summary'));
		summary.classList.toggle('error', document.status === HorusLinkedDocumentStatus.Error);
		summary.textContent = this.getLinkedPlanSummary(document);
		summary.title = document.absolutePath;

		if (document.lastError) {
			const error = DOM.append(this.elements.linkedPlan, DOM.$('.horus-editor-linked-plan-error'));
			error.textContent = document.lastError;
		}
	}

	private getLinkedPlanSummary(document: HorusLinkedDocument): string {
		const status = this.getLinkedPlanStatusLabel(document.status);
		const synced = document.lastSyncedAtUtc ? new Date(document.lastSyncedAtUtc).toLocaleString() : localize('horusPromptEditorLinkedPlanNeverSynced', "never");
		return localize('horusPromptEditorLinkedPlanSummary', "Linked plan: {0} - {1} - v{2} - Last sync {3}", document.displayName ?? document.absolutePath, status, document.currentVersion, synced);
	}

	private getLinkedPlanStatusLabel(status: HorusLinkedDocumentStatus): string {
		switch (status) {
			case HorusLinkedDocumentStatus.Watching:
				return localize('horusPromptEditorLinkedPlanWatching', "watching");
			case HorusLinkedDocumentStatus.Paused:
				return localize('horusPromptEditorLinkedPlanPaused', "paused");
			case HorusLinkedDocumentStatus.Error:
				return localize('horusPromptEditorLinkedPlanError', "error");
			case HorusLinkedDocumentStatus.Draft:
				return localize('horusPromptEditorLinkedPlanDraft', "draft");
		}
	}

	private async renderTerminalControls(): Promise<void> {
		if (!this.elements || !this.currentPrompt) {
			return;
		}

		this.terminalControlsDisposables.clear();
		DOM.clearNode(this.elements.terminalControls);

		const prompt = this.currentPrompt;
		const sessions = await this.horusStorageService.listPromptTerminalSessions(prompt.id);
		if (!this.elements || this.currentPrompt?.id !== prompt.id) {
			return;
		}

		const activeCount = sessions.filter(session => session.status === HorusPromptTerminalSessionStatus.Active).length;
		const header = DOM.append(this.elements.terminalControls, DOM.$('.horus-editor-terminal-header'));
		const title = DOM.append(header, DOM.$('.horus-editor-terminal-title'));
		title.textContent = localize('horusPromptEditorLinkedTerminals', "Linked Terminals");
		const meta = DOM.append(header, DOM.$('.horus-editor-terminal-meta'));
		meta.textContent = localize('horusPromptEditorLinkedTerminalMeta', "{0}/{1} active", activeCount, sessions.length);

		const actions = DOM.append(this.elements.terminalControls, DOM.$('.horus-editor-terminal-actions'));
		this.renderTerminalButton(actions, localize('horusPromptEditorRunTerminal', "Run"), () => this.launchTerminal(defaultTerminalLaunchForPrompt(prompt), false));
		this.renderTerminalButton(actions, localize('horusPromptEditorSubmitTerminal', "Submit Prompt"), () => this.launchTerminal(defaultTerminalLaunchForPrompt(prompt), true));
		this.renderTerminalButton(actions, localize('horusPromptEditorClaudePlanTerminal', "Claude Plan"), () => this.launchTerminal(HorusTerminalAgentLaunch.ClaudePlan, false));
		this.renderTerminalButton(actions, localize('horusPromptEditorCodexTerminal', "Codex"), () => this.launchTerminal(HorusTerminalAgentLaunch.Codex, true));

		const list = DOM.append(this.elements.terminalControls, DOM.$('.horus-editor-terminal-list'));
		if (!sessions.length) {
			const empty = DOM.append(list, DOM.$('.horus-editor-terminal-empty'));
			empty.textContent = localize('horusPromptEditorNoLinkedTerminals', "No terminals linked yet. Use Run or Submit Prompt to create one.");
			return;
		}

		for (const session of sessions) {
			this.renderTerminalSession(list, session);
		}
	}

	private renderTerminalSession(parent: HTMLElement, session: HorusPromptTerminalSession): void {
		const item = DOM.append(parent, DOM.$('.horus-editor-terminal-session'));
		const header = DOM.append(item, DOM.$('.horus-editor-terminal-session-header'));
		const title = DOM.append(header, DOM.$('.horus-editor-terminal-session-title'));
		title.textContent = session.terminalName;

		const isActive = session.status === HorusPromptTerminalSessionStatus.Active;
		const status = DOM.append(header, DOM.$(`.horus-editor-terminal-session-status.${isActive ? 'active' : 'closed'}`));
		status.textContent = isActive
			? localize('horusPromptEditorTerminalActive', "Active")
			: localize('horusPromptEditorTerminalClosed', "Closed");

		const instance = session.terminalInstanceId !== null
			? localize('horusPromptEditorTerminalInstance', "Terminal #{0}", session.terminalInstanceId)
			: localize('horusPromptEditorTerminalNoInstance', "Terminal instance unknown");
		const description = DOM.append(item, DOM.$('.horus-editor-terminal-session-description'));
		description.textContent = localize('horusPromptEditorTerminalDescription', "{0} - {1} - started {2}",
			session.agentName,
			instance,
			new Date(session.startedAtUtc).toLocaleString());

		const command = DOM.append(item, DOM.$('code.horus-editor-terminal-session-command'));
		command.textContent = session.launchCommand;

		if (!isActive || session.terminalInstanceId === null) {
			if (session.endedAtUtc) {
				const closedAt = DOM.append(item, DOM.$('.horus-editor-terminal-session-description'));
				closedAt.textContent = localize('horusPromptEditorTerminalEndedAt', "Closed {0}", new Date(session.endedAtUtc).toLocaleString());
			}
			return;
		}

		const actions = DOM.append(item, DOM.$('.horus-editor-terminal-session-actions'));
		this.renderTerminalButton(actions, localize('horusPromptEditorFocusTerminal', "Focus"), () => this.focusTerminalSession(session));
		this.renderTerminalButton(actions, localize('horusPromptEditorKillTerminal', "Kill"), () => this.killTerminalSession(session));
	}

	private renderTerminalButton(parent: HTMLElement, label: string, handler: () => Promise<void>): HTMLButtonElement {
		const button = DOM.append(parent, DOM.$('button.horus-button.horus-editor-terminal-button')) as HTMLButtonElement;
		button.type = 'button';
		button.textContent = label;
		this.terminalControlsDisposables.add(DOM.addDisposableListener(button, DOM.EventType.CLICK, () => {
			button.disabled = true;
			handler()
				.catch(error => this.notificationService.error(error))
				.finally(() => {
					button.disabled = false;
				});
		}));
		return button;
	}

	private async launchTerminal(agent: HorusTerminalAgentLaunch, submitPrompt: boolean): Promise<void> {
		if (!this.currentPrompt) {
			return;
		}

		if (this.dirty) {
			const saved = await this.save();
			if (!saved || !this.currentPrompt) {
				return;
			}
		}

		const workspace = await this.resolveCurrentWorkspace();
		if (!workspace) {
			throw new Error(localize('horusPromptEditorTerminalWorkspaceMissing', "The prompt workspace was not found."));
		}

		const session = await this.instantiationService.createInstance(HorusTerminalLauncher).launchPrompt(this.currentPrompt, workspace, agent, submitPrompt);
		this.showStatus(localize('horusPromptEditorTerminalLaunched', "Linked terminal created: {0}", session.terminalName), false);
		await this.renderTerminalControls();
	}

	private async focusTerminalSession(session: HorusPromptTerminalSession): Promise<void> {
		if (session.terminalInstanceId === null) {
			await this.horusStorageService.updatePromptTerminalSession({
				id: session.id,
				status: HorusPromptTerminalSessionStatus.Closed,
				endedAtUtc: new Date().toISOString()
			});
			await this.renderTerminalControls();
			return;
		}

		const focused = await this.instantiationService.createInstance(HorusTerminalLauncher).focusTerminalInstance(session.terminalInstanceId);
		const now = new Date().toISOString();
		await this.horusStorageService.updatePromptTerminalSession({
			id: session.id,
			status: focused ? HorusPromptTerminalSessionStatus.Active : HorusPromptTerminalSessionStatus.Closed,
			lastActivatedAtUtc: focused ? now : undefined,
			endedAtUtc: focused ? undefined : now
		});
		if (!focused) {
			throw new Error(localize('horusPromptEditorTerminalNotFound', "This terminal is no longer available. The linked session was marked as closed."));
		}
		await this.renderTerminalControls();
	}

	private async killTerminalSession(session: HorusPromptTerminalSession): Promise<void> {
		if (session.terminalInstanceId !== null) {
			await this.instantiationService.createInstance(HorusTerminalLauncher).killTerminalInstance(session.terminalInstanceId);
		}

		await this.horusStorageService.updatePromptTerminalSession({
			id: session.id,
			status: HorusPromptTerminalSessionStatus.Closed,
			endedAtUtc: new Date().toISOString()
		});
		this.showStatus(localize('horusPromptEditorTerminalKilled', "Linked terminal marked as closed."), false);
		await this.renderTerminalControls();
	}

	private async resolveCurrentWorkspace(): Promise<HorusWorkspace | undefined> {
		if (this.currentWorkspace) {
			return this.currentWorkspace;
		}

		if (!this.currentPrompt) {
			return undefined;
		}

		const prompt = this.currentPrompt;
		this.currentWorkspace = (await this.horusStorageService.listWorkspaces()).find(candidate => candidate.id === prompt.workingDirectoryId);
		return this.currentWorkspace;
	}

	private createMarkdownEditor(container: HTMLElement, prompt: HorusPrompt): void {
		const options: IEditorConstructionOptions = {
			ariaLabel: localize('horusPromptEditorAriaLabel', "Horus prompt Markdown editor"),
			automaticLayout: false,
			fixedOverflowWidgets: true,
			links: true,
			scrollBeyondLastLine: false,
			wordWrap: 'on',
			lineNumbers: 'on',
			lineNumbersMinChars: 2,
			glyphMargin: false,
			folding: true,
			minimap: { enabled: false },
			overviewRulerLanes: 0,
			renderWhitespace: 'selection',
			scrollbar: {
				verticalScrollbarSize: 14,
				horizontal: 'auto',
				useShadows: true,
				verticalHasArrows: false,
				horizontalHasArrows: false,
				alwaysConsumeMouseWheel: false
			}
		};

		const resource = this.currentInput?.resource;
		let createdModel = false;
		let model = resource ? this.modelService.getModel(resource) : null;
		if (model) {
			this.modelService.updateModel(model, prompt.content);
		} else {
			model = resource
				? this.modelService.createModel(prompt.content, this.languageService.createById('markdown'), resource)
				: this.modelService.createModel(prompt.content, this.languageService.createById('markdown'));
			createdModel = true;
		}

		this.promptModel = model;

		const codeEditor = this.instantiationService.createInstance(CodeEditorWidget, container, options, {
			telemetryData: { source: 'horusPromptEditor' }
		});
		codeEditor.setModel(model);
		this.codeEditor = codeEditor;
		this.mentionDecorations = codeEditor.createDecorationsCollection();
		this.contentDisposables.add(codeEditor);
		if (createdModel) {
			this.contentDisposables.add(model);
		}
		this.contentDisposables.add(codeEditor.onDidChangeModelContent(() => this.onEditorChanged()));
		this.registerFileMentionCompletionProvider(model);
		this.updateFileMentionDecorations();
		this.lastDimension ? this.layout(this.lastDimension) : codeEditor.layout();
	}

	private registerFileMentionCompletionProvider(model: ITextModel): void {
		this.contentDisposables.add(this.languageFeaturesService.completionProvider.register({
			language: 'markdown',
			scheme: Schemas.vscode,
			hasAccessToAllModels: true
		}, {
			_debugDisplayName: 'horusFileMentionCompletionProvider',
			triggerCharacters: ['@', '/', '\\', '.', '-', '_'],
			provideCompletionItems: async (candidateModel: ITextModel, position: Position, _context: CompletionContext, token: CancellationToken): Promise<CompletionList> => {
				if (candidateModel.uri.toString() !== model.uri.toString()) {
					return { suggestions: [] };
				}

				const mention = this.getFileMentionCompletionContext(candidateModel, position);
				if (!mention || !this.currentWorkspace) {
					return { suggestions: [] };
				}

				return {
					suggestions: await this.provideFileMentionCompletionItems(this.currentWorkspace, mention.pathPrefix, mention.range, token),
					incomplete: true
				};
			}
		}));

		this.contentDisposables.add(this.languageFeaturesService.linkProvider.register({
			language: 'markdown',
			scheme: Schemas.vscode,
			hasAccessToAllModels: true
		}, {
			provideLinks: async (candidateModel: ITextModel, token: CancellationToken): Promise<ILinksList> => {
				if (candidateModel.uri.toString() !== model.uri.toString() || !this.currentWorkspace) {
					return { links: [] };
				}

				const workspaceRoot = URI.file(this.currentWorkspace.absolutePath);
				const links: ILinksList['links'] = [];
				for (const mention of this.findFileMentionOccurrences(candidateModel)) {
					if (token.isCancellationRequested) {
						return { links: [] };
					}

					const resource = this.resolveFileMentionResource(workspaceRoot, mention.relativePath);
					if (!resource) {
						continue;
					}

					links.push({
						range: mention.range,
						url: resource,
						tooltip: localize('horusPromptFileMentionLinkTooltip', "Open {0}", mention.relativePath)
					});
				}

				return { links };
			}
		}));
	}

	private getFileMentionCompletionContext(model: ITextModel, position: Position): { readonly pathPrefix: string; readonly range: Range } | undefined {
		const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
		const atIndex = linePrefix.lastIndexOf('@');
		if (atIndex < 0) {
			return undefined;
		}

		const beforeAt = atIndex === 0 ? '' : linePrefix.charAt(atIndex - 1);
		if (beforeAt && !/[\s([{"']/.test(beforeAt)) {
			return undefined;
		}

		const pathPrefix = linePrefix.slice(atIndex + 1).replace(/^["']/, '');
		if (/\s|@/.test(pathPrefix)) {
			return undefined;
		}

		return {
			pathPrefix,
			range: new Range(position.lineNumber, atIndex + 1, position.lineNumber, position.column)
		};
	}

	private async provideFileMentionCompletionItems(workspace: HorusWorkspace, pathPrefix: string, range: Range, token: CancellationToken): Promise<CompletionItem[]> {
		const workspaceRoot = URI.file(workspace.absolutePath);
		const searchResult = await this.searchService.fileSearch({
			type: QueryType.File,
			_reason: 'horusPromptFileMention',
			folderQueries: [{
				folder: workspaceRoot,
				disregardIgnoreFiles: workspace.respectGitignore === false,
				disregardParentIgnoreFiles: workspace.respectGitignore === false,
				disregardGlobalIgnoreFiles: workspace.respectGitignore === false
			}],
			filePattern: pathPrefix || undefined,
			excludePattern: horusFileMentionExcludePattern,
			maxResults: 100,
			sortByScore: true
		}, token);

		if (token.isCancellationRequested) {
			return [];
		}

		const seen = new Set<string>();
		const suggestions: CompletionItem[] = [];
		for (const match of searchResult.results) {
			const relativePath = resourceRelativePath(workspaceRoot, match.resource)?.replace(/\\/g, '/');
			if (!relativePath || relativePath.startsWith('../') || this.isExcludedFileMentionPath(relativePath) || seen.has(relativePath.toLowerCase())) {
				continue;
			}

			seen.add(relativePath.toLowerCase());
			suggestions.push({
				label: `@${relativePath}`,
				kind: CompletionItemKind.File,
				insertText: `@${relativePath}`,
				filterText: `@${relativePath}`,
				sortText: relativePath,
				detail: localize('horusPromptFileMentionDetail', "Workspace file"),
				range
			});
		}

		return suggestions;
	}

	private isExcludedFileMentionPath(relativePath: string): boolean {
		return relativePath === '.git'
			|| relativePath.startsWith('.git/')
			|| relativePath.endsWith('/.git')
			|| relativePath.includes('/.git/');
	}

	private updateFileMentionDecorations(): void {
		if (!this.promptModel || !this.mentionDecorations) {
			return;
		}

		const decorations: IModelDeltaDecoration[] = [];
		for (const mention of this.findFileMentionOccurrences(this.promptModel)) {
			decorations.push({
				range: mention.range,
				options: {
					description: 'horus-file-mention',
					stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
					inlineClassName: 'horus-file-mention-link',
					hoverMessage: new MarkdownString().appendText(localize('horusPromptFileMentionHover', "Ctrl+click to open {0}", mention.relativePath))
				}
			});
		}

		this.mentionDecorations.set(decorations);
	}

	private findFileMentionOccurrences(model: ITextModel): readonly HorusFileMentionOccurrence[] {
		const occurrences: HorusFileMentionOccurrence[] = [];
		for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber++) {
			const line = model.getLineContent(lineNumber);
			horusFileMentionPattern.lastIndex = 0;

			let match: RegExpExecArray | null;
			while ((match = horusFileMentionPattern.exec(line)) !== null) {
				const rawPath = match[2] ?? '';
				const normalizedPath = rawPath.replace(horusTrailingPathPunctuationPattern, '').replace(/^["']|["']$/g, '').trim().replace(/\\/g, '/');
				if (!normalizedPath || (!/[\\/]/.test(normalizedPath) && !/\.[^./\\]+$/.test(normalizedPath)) || this.isExcludedFileMentionPath(normalizedPath)) {
					continue;
				}

				const boundaryLength = match[1]?.length ?? 0;
				const mentionStartOffset = match.index + boundaryLength;
				const matchedMention = match[0].slice(boundaryLength);
				const hasOpeningQuote = matchedMention.startsWith('@"') || matchedMention.startsWith("@'");
				const pathStartOffset = mentionStartOffset + 1 + (hasOpeningQuote ? 1 : 0);
				const visiblePathLength = rawPath.replace(horusTrailingPathPunctuationPattern, '').replace(/["']$/g, '').length;
				occurrences.push({
					relativePath: normalizedPath,
					range: new Range(lineNumber, mentionStartOffset + 1, lineNumber, pathStartOffset + visiblePathLength + 1)
				});
			}
		}

		return occurrences;
	}

	private resolveFileMentionResource(workspaceRoot: URI, relativePath: string): URI | undefined {
		const normalizedPath = relativePath.replace(/\\/g, '/');
		if (normalizedPath.startsWith('/') || normalizedPath === '..' || normalizedPath.startsWith('../') || normalizedPath.includes('/../') || this.isExcludedFileMentionPath(normalizedPath)) {
			return undefined;
		}

		return joinPath(workspaceRoot, ...normalizedPath.split('/').filter(segment => !!segment));
	}

	private renderViewModeButtons(parent: HTMLElement): ReadonlyMap<HorusPromptEditorViewMode, HTMLButtonElement> {
		const group = DOM.append(parent, DOM.$('.horus-editor-view-modes'));
		const buttons = new Map<HorusPromptEditorViewMode, HTMLButtonElement>();
		for (const option of [
			{ mode: 'editor' as const, label: localize('horusPromptEditorModeEditor', "Editor") },
			{ mode: 'split' as const, label: localize('horusPromptEditorModeSplit', "Split") },
			{ mode: 'preview' as const, label: localize('horusPromptEditorModePreview', "Preview") }
		]) {
			const button = DOM.append(group, DOM.$('button.horus-editor-view-mode')) as HTMLButtonElement;
			button.type = 'button';
			button.textContent = option.label;
			button.setAttribute('aria-pressed', String(this.viewMode === option.mode));
			this.contentDisposables.add(DOM.addDisposableListener(button, DOM.EventType.CLICK, () => this.setViewMode(option.mode)));
			buttons.set(option.mode, button);
		}

		return buttons;
	}

	private setViewMode(viewMode: HorusPromptEditorViewMode): void {
		if (this.viewMode === viewMode) {
			return;
		}

		this.viewMode = viewMode;
		this.applyViewMode();
		this.schedulePreviewRender();
	}

	private applyViewMode(): void {
		if (!this.elements) {
			return;
		}

		this.elements.editorBody.classList.toggle('preview-only', this.viewMode === 'preview');
		this.elements.editorBody.classList.toggle('editor-only', this.viewMode === 'editor');
		this.elements.editorBody.classList.toggle('split', this.viewMode === 'split');
		this.elements.editorContainer.hidden = this.viewMode === 'preview';
		this.elements.previewContainer.hidden = this.viewMode === 'editor';
		for (const [mode, button] of this.elements.viewModeButtons) {
			const isActive = mode === this.viewMode;
			button.classList.toggle('active', isActive);
			button.setAttribute('aria-pressed', String(isActive));
		}

		this.codeEditor?.layout();
	}

	private schedulePreviewRender(): void {
		if (this.viewMode === 'editor') {
			return;
		}

		this.previewRenderScheduler.schedule();
	}

	private renderMarkdownPreview(): void {
		if (!this.elements || this.viewMode === 'editor') {
			return;
		}

		this.previewDisposables.clear();
		const markdown = new MarkdownString(this.getEditorContent(), {
			isTrusted: false,
			supportThemeIcons: true
		});
		const rendered = this.markdownRendererService.render(markdown, {
			markedOptions: {
				gfm: true
			},
			asyncRenderCallback: () => undefined
		}, this.elements.previewContainer);
		this.previewDisposables.add(rendered);
	}

	private renderSelect<T extends number>(
		parent: HTMLElement,
		label: string,
		options: readonly { readonly label: string; readonly value: T }[],
		selected: T
	): HTMLSelectElement {
		const wrapper = DOM.append(parent, DOM.$('.horus-editor-field'));
		const labelElement = DOM.append(wrapper, DOM.$('label.horus-editor-label'));
		labelElement.textContent = label;

		const select = DOM.append(wrapper, DOM.$('select.horus-editor-select')) as HTMLSelectElement;
		for (const option of options) {
			const optionElement = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
			optionElement.value = String(option.value);
			optionElement.textContent = option.label;
		}

		select.value = String(selected);
		return select;
	}

	private onEditorChanged(): void {
		this.updateDirtyState();
		this.updateFileMentionDecorations();
		this.scheduleMentionValidation();
		this.schedulePreviewRender();
	}

	private updateDirtyState(): void {
		if (!this.elements || !this.savedSnapshot) {
			return;
		}

		const snapshot = this.readSnapshot();
		this.dirty = !this.snapshotsEqual(this.savedSnapshot, snapshot);
		this.currentInput?.setDraft(this.dirty ? snapshot : undefined);
		this.elements.saveButton.disabled = !this.dirty;
		this.showStatus(this.dirty ? localize('horusPromptEditorUnsaved', "Unsaved changes.") : localize('horusPromptEditorSaved', "Saved."), false);
	}

	private scheduleMentionValidation(): void {
		this.mentionValidationScheduler.schedule();
	}

	private async validateMentions(): Promise<void> {
		if (!this.elements) {
			return;
		}

		const mentions = extractHorusFileMentions(this.getEditorContent());
		if (!mentions.length) {
			this.renderMentionValidation([]);
			return;
		}

		if (!this.currentWorkspace) {
			this.elements.validation.textContent = localize('horusPromptEditorMissingWorkspace', "{0} file mention(s). Open the original workspace folder to validate them.", mentions.length);
			return;
		}

		this.elements.validation.textContent = localize('horusPromptEditorValidatingMentions', "Validating {0} file mention(s)...", mentions.length);
		const results = await this.horusStorageService.validateFileMentions({
			workspacePath: this.currentWorkspace.absolutePath,
			mentions,
			respectGitignore: this.currentWorkspace.respectGitignore
		});
		this.renderMentionValidation(results);
	}

	private renderMentionValidation(results: readonly HorusFileMentionValidationResult[]): void {
		if (!this.elements) {
			return;
		}

		DOM.clearNode(this.elements.validation);
		if (!results.length) {
			this.elements.validation.textContent = localize('horusPromptEditorNoMentions', "No file mentions detected.");
			return;
		}

		const missingCount = results.filter(result => !result.exists).length;
		const summary = DOM.append(this.elements.validation, DOM.$('.horus-editor-mentions-summary'));
		summary.textContent = missingCount
			? localize('horusPromptEditorMissingMentions', "{0} file mention(s), {1} missing or ignored.", results.length, missingCount)
			: localize('horusPromptEditorValidMentions', "{0} file mention(s), all resolved.", results.length);

		const list = DOM.append(this.elements.validation, DOM.$('.horus-editor-mentions-list'));
		for (const result of results.slice(0, 20)) {
			const item = DOM.append(list, DOM.$(`.horus-editor-mention.${result.exists ? 'valid' : 'missing'}`));
			item.textContent = `${result.exists ? 'OK' : 'Missing'} @${result.relativePath}`;
			item.title = result.absolutePath;
		}
	}

	private async revertDraft(): Promise<void> {
		if (!this.currentPrompt) {
			this.currentInput?.setDraft(undefined);
			return;
		}

		this.currentInput?.setDraft(undefined);
		this.currentInput?.setName(this.currentPrompt.title);
		this.savedSnapshot = this.toSnapshot(this.currentPrompt);
		this.clearEditorContent();
		this.render(this.currentPrompt);
		this.scheduleMentionValidation();
		this.schedulePreviewRender();
	}

	private async save(): Promise<boolean> {
		if (!this.elements || !this.currentPrompt) {
			return false;
		}

		const snapshot = this.readSnapshot();
		if (!snapshot.title.trim()) {
			this.showStatus(localize('horusPromptEditorTitleRequired', "Title is required."), true);
			return false;
		}

		this.elements.saveButton.disabled = true;
		this.showStatus(localize('horusPromptEditorSaving', "Saving..."), false);

		const updated = await this.horusStorageService.updatePrompt({
			id: this.currentPrompt.id,
			title: snapshot.title,
			content: snapshot.content,
			targetAgent: snapshot.targetAgent,
			kind: snapshot.kind,
			status: snapshot.status,
			rowVersion: this.currentPrompt.rowVersion,
			mentions: extractHorusFileMentions(snapshot.content)
		});

		this.currentPrompt = updated;
		this.savedSnapshot = this.toSnapshot(updated);
		this.currentInput?.setDraft(undefined);
		this.currentInput?.setName(updated.title);
		this.setMetadata(this.elements.metadata, updated);
		this.dirty = false;
		this.updateDirtyState();
		this.scheduleMentionValidation();
		this.notificationService.info(localize('horusPromptEditorSavedNotification', "Horus prompt saved: {0}", updated.title));
		return true;
	}

	private readSnapshot(): HorusPromptEditorSnapshot {
		if (!this.elements) {
			throw new Error('Horus prompt editor is not rendered.');
		}

		return {
			title: this.elements.title.value,
			targetAgent: Number(this.elements.targetAgent.value) as HorusTargetAgent,
			kind: Number(this.elements.kind.value) as HorusPromptKind,
			status: Number(this.elements.status.value) as HorusPromptStatus,
			content: this.getEditorContent()
		};
	}

	private getEditorContent(): string {
		return this.promptModel?.getValue() ?? this.codeEditor?.getValue() ?? '';
	}

	private toSnapshot(prompt: HorusPrompt): HorusPromptEditorSnapshot {
		return {
			title: prompt.title,
			targetAgent: prompt.targetAgent,
			kind: prompt.kind,
			status: prompt.status,
			content: prompt.content
		};
	}

	private snapshotsEqual(left: HorusPromptEditorSnapshot, right: HorusPromptEditorSnapshot): boolean {
		return left.title === right.title
			&& left.targetAgent === right.targetAgent
			&& left.kind === right.kind
			&& left.status === right.status
			&& left.content === right.content;
	}

	private setMetadata(metadata: HTMLElement, prompt: HorusPrompt): void {
		metadata.textContent = localize('horusPromptEditorMetadata', "Version {0} - Row {1} - Updated {2}", prompt.currentVersion, prompt.rowVersion, new Date(prompt.updatedAtUtc).toLocaleString());
	}

	private showStatus(message: string, isError: boolean): void {
		if (!this.elements) {
			return;
		}

		this.elements.statusMessage.textContent = message;
		this.elements.statusMessage.classList.toggle('error', isError);
	}
}
