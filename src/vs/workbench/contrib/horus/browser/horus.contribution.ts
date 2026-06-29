import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../nls.js';
import './horusNullInlineChatSessionService.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IHorusStorageService } from '../../../../platform/horus/common/horusStorage.js';
import { HorusLinkedDocument, HorusLinkedDocumentStatus, HorusLinkedDocumentVersion, HorusLinkedDocumentVersionSource, HorusPrompt, HorusPromptVersion, HorusWorkspace } from '../../../../platform/horus/common/horusTypes.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { VIEW_CONTAINER as EXPLORER_VIEW_CONTAINER } from '../../files/browser/explorerViewlet.js';
import { WebviewViewPane } from '../../webviewView/browser/webviewViewPane.js';
import { IWebviewViewService } from '../../webviewView/browser/webviewViewService.js';
import { HorusPromptEditor } from './editors/promptEditor.js';
import { HorusPromptEditorInput } from './editors/promptEditorInput.js';
import { HorusLinkedPlanEditor } from './editors/linkedPlanEditor.js';
import { HorusLinkedPlanEditorInput } from './editors/linkedPlanEditorInput.js';
import { HorusCommandId, HorusContext, HORUS_PROMPT_DETAIL_VIEW_ID, HORUS_PROMPTS_VIEW_ID, HORUS_VIEW_CONTAINER_ID, HORUS_WORKFLOW_BOARD_VIEW_ID } from '../common/horus.js';
import { getHorusChildPromptTemplates, HorusChildPromptTemplate, HorusPromptTemplateInputDefinition, renderHorusChildPromptTemplate } from '../../../../platform/horus/common/horusPromptTemplates.js';
import { resolveCurrentHorusWorkspace } from './horusNativeWorkspaces.js';
import { createHorusLinkedDocumentVersionResource, createHorusPromptVersionResource, HorusVersionContentProvider } from './horusVersionContentProvider.js';
import { horusWorkbenchState } from './horusWorkbenchState.js';
import { HorusLinkedPlanMonitor } from './linkedPlanMonitor.js';
import { defaultTerminalLaunchForPrompt, HorusTerminalAgentLaunch, HorusTerminalLauncher } from './horusTerminalLauncher.js';
import { HorusWorkflowBoardViewResolver, openHorusWorkflowBoard } from './workflow/horusWorkflowBoard.js';
import { HorusPromptDetailView } from './views/promptDetailView.js';
import { HorusPromptListView } from './views/promptListView.js';

const horusViewIcon = registerIcon('horus-view-icon', Codicon.eye, localize('horusViewIcon', 'View icon of the Horus view.'));
const horusCategory = localize2('horusCategory', "Horus");
const openFolderCommandId = 'workbench.action.files.openFolder';

interface HorusVersionPick<TVersion extends HorusComparableVersion> {
	readonly label: string;
	readonly description: string;
	readonly detail?: string;
	readonly version: TVersion;
}

interface HorusChildPromptTemplatePick extends IQuickPickItem {
	readonly template: HorusChildPromptTemplate;
}

interface HorusComparableVersion {
	readonly versionNumber: number;
	readonly createdAtUtc: string;
}

interface HorusLaunchPromptTerminalOptions {
	readonly agent?: HorusTerminalAgentLaunch;
	readonly submitPrompt?: boolean;
}

class HorusPromptEditorInputSerializer implements IEditorSerializer {

	canSerialize(editorInput: EditorInput): boolean {
		return editorInput instanceof HorusPromptEditorInput;
	}

	serialize(editorInput: HorusPromptEditorInput): string {
		return JSON.stringify({ promptId: editorInput.promptId, name: editorInput.getName() });
	}

	deserialize(_instantiationService: IInstantiationService, serializedEditor: string): HorusPromptEditorInput | undefined {
		try {
			const data = JSON.parse(serializedEditor) as { promptId?: string; name?: string };
			return data.promptId ? new HorusPromptEditorInput(data.promptId, data.name) : undefined;
		} catch {
			return undefined;
		}
	}
}

class HorusLinkedPlanEditorInputSerializer implements IEditorSerializer {

	canSerialize(editorInput: EditorInput): boolean {
		return editorInput instanceof HorusLinkedPlanEditorInput;
	}

	serialize(editorInput: HorusLinkedPlanEditorInput): string {
		return JSON.stringify({ linkedDocumentId: editorInput.linkedDocumentId, name: editorInput.getName() });
	}

	deserialize(_instantiationService: IInstantiationService, serializedEditor: string): HorusLinkedPlanEditorInput | undefined {
		try {
			const data = JSON.parse(serializedEditor) as { linkedDocumentId?: string; name?: string };
			return data.linkedDocumentId ? new HorusLinkedPlanEditorInput(data.linkedDocumentId, data.name) : undefined;
		} catch {
			return undefined;
		}
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory)
	.registerEditorSerializer(HorusPromptEditorInput.ID, HorusPromptEditorInputSerializer);

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory)
	.registerEditorSerializer(HorusLinkedPlanEditorInput.ID, HorusLinkedPlanEditorInputSerializer);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		HorusPromptEditor,
		HorusPromptEditor.ID,
		localize('horusPromptEditor', "Horus Prompt Editor")
	),
	[
		new SyncDescriptor(HorusPromptEditorInput)
	]
);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		HorusLinkedPlanEditor,
		HorusLinkedPlanEditor.ID,
		localize('horusLinkedPlanEditor', "Horus Linked Plan Editor")
	),
	[
		new SyncDescriptor(HorusLinkedPlanEditorInput)
	]
);

const horusViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: HORUS_VIEW_CONTAINER_ID,
	title: localize2('horus', "Horus"),
	icon: horusViewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [HORUS_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	hideIfEmpty: false,
	order: 2
}, ViewContainerLocation.Sidebar, { doNotRegisterOpenCommand: false });

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([
	{
		id: HORUS_WORKFLOW_BOARD_VIEW_ID,
		name: localize2('horusWorkflowBoardView', "Workflow"),
		containerIcon: horusViewIcon,
		ctorDescriptor: new SyncDescriptor(WebviewViewPane),
		canToggleVisibility: false,
		canMoveView: false
	}
], horusViewContainer);

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([
	{
		id: HORUS_PROMPTS_VIEW_ID,
		name: localize2('horusPrompts', "Prompts"),
		containerIcon: horusViewIcon,
		ctorDescriptor: new SyncDescriptor(HorusPromptListView),
		order: 2,
		canToggleVisibility: false,
		canMoveView: false
	},
	{
		id: HORUS_PROMPT_DETAIL_VIEW_ID,
		name: localize2('horusPromptDetails', "Prompt Details"),
		containerIcon: horusViewIcon,
		ctorDescriptor: new SyncDescriptor(HorusPromptDetailView),
		order: 3,
		canToggleVisibility: true,
		canMoveView: false
	}
], EXPLORER_VIEW_CONTAINER);

class HorusContextKeysContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.horus.contextKeys';

	private readonly hasNativeWorkspaceContext: IContextKey<boolean>;
	private readonly promptSelectedContext: IContextKey<boolean>;

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) {
		super();

		this.hasNativeWorkspaceContext = HorusContext.HasNativeWorkspace.bindTo(this.contextKeyService);
		this.promptSelectedContext = HorusContext.PromptSelected.bindTo(this.contextKeyService);

		this.update();
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.update()));
		this._register(horusWorkbenchState.onDidChangeSelectedPrompt(() => this.update()));
	}

	private update(): void {
		this.hasNativeWorkspaceContext.set(this.workspaceContextService.getWorkspace().folders.length > 0);
		this.promptSelectedContext.set(!!horusWorkbenchState.getSelectedPromptId());
	}
}

registerWorkbenchContribution2(HorusContextKeysContribution.ID, HorusContextKeysContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(HorusLinkedPlanMonitor.ID, HorusLinkedPlanMonitor, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(HorusVersionContentProvider.ID, HorusVersionContentProvider, WorkbenchPhase.AfterRestored);

class HorusWorkflowBoardViewContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.horus.workflowBoardView';

	constructor(
		@IWebviewViewService webviewViewService: IWebviewViewService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		const resolver = this._register(instantiationService.createInstance(HorusWorkflowBoardViewResolver));
		this._register(webviewViewService.register(HORUS_WORKFLOW_BOARD_VIEW_ID, resolver));
	}
}

registerWorkbenchContribution2(HorusWorkflowBoardViewContribution.ID, HorusWorkflowBoardViewContribution, WorkbenchPhase.AfterRestored);

async function resolveWorkspaceForCommand(
	workspaceContextService: IWorkspaceContextService,
	horusStorageService: IHorusStorageService,
	commandService: ICommandService,
	notificationService: INotificationService
): Promise<HorusWorkspace | undefined> {
	const workspace = await resolveCurrentHorusWorkspace(workspaceContextService, horusStorageService);
	if (!workspace) {
		notificationService.info(localize('horusOpenFolderFirst', "Open a folder first. Horus uses the VS Code workspace as its workspace."));
		await commandService.executeCommand(openFolderCommandId);
		return undefined;
	}

	horusWorkbenchState.setSelectedWorkspaceId(workspace.id);
	return workspace;
}

async function resolveSelectedPromptForCommand(
	horusStorageService: IHorusStorageService,
	notificationService: INotificationService,
	promptId?: string
): Promise<HorusPrompt | undefined> {
	const selectedPromptId = promptId ?? horusWorkbenchState.getSelectedPromptId();
	if (!selectedPromptId) {
		notificationService.info(localize('horusSelectPromptFirst', "Select a Horus prompt first."));
		return undefined;
	}

	const prompt = await horusStorageService.getPrompt(selectedPromptId);
	if (!prompt) {
		notificationService.error(localize('horusSelectedPromptMissing', "The selected Horus prompt no longer exists."));
		horusWorkbenchState.setSelectedPromptId(undefined);
		return undefined;
	}

	return prompt;
}

async function resolveLinkedPlanForCommand(
	horusStorageService: IHorusStorageService,
	notificationService: INotificationService,
	promptIdOrLinkedDocumentId?: string
): Promise<HorusLinkedDocument | undefined> {
	if (promptIdOrLinkedDocumentId) {
		const byPrompt = await horusStorageService.getLinkedDocumentForPrompt(promptIdOrLinkedDocumentId);
		if (byPrompt) {
			return byPrompt;
		}

		const byId = (await horusStorageService.listLinkedDocuments()).find(candidate => candidate.id === promptIdOrLinkedDocumentId);
		if (byId) {
			return byId;
		}
	}

	const prompt = await resolveSelectedPromptForCommand(horusStorageService, notificationService);
	if (!prompt) {
		return undefined;
	}

	const document = await horusStorageService.getLinkedDocumentForPrompt(prompt.id);
	if (!document) {
		notificationService.info(localize('horusNoLinkedPlanForPrompt', "This prompt does not have a linked plan."));
	}

	return document;
}

async function pickChildPromptTemplate(quickInputService: IQuickInputService): Promise<HorusChildPromptTemplate | undefined> {
	const pick = await quickInputService.pick(getHorusChildPromptTemplates().map(template => ({
		label: template.displayName,
		description: template.description,
		detail: getChildPromptTemplateMetadata(template),
		template
	} satisfies HorusChildPromptTemplatePick)), {
		placeHolder: localize('horusPickChildPromptTemplate', "Select the child prompt type")
	});

	return pick?.template;
}

function getChildPromptTemplateMetadata(template: HorusChildPromptTemplate): string {
	return template.inputs.length
		? localize('horusChildPromptTemplateNeedsInput', "Requires: {0}", template.inputs.map(input => input.label).join(', '))
		: localize('horusChildPromptTemplateNoInput', "No additional input required");
}

async function collectChildPromptTemplateInputs(
	quickInputService: IQuickInputService,
	template: HorusChildPromptTemplate,
	linkedPlan: HorusLinkedDocument
): Promise<Readonly<Record<string, string>> | undefined> {
	const values: Record<string, string> = {};

	for (const input of template.inputs) {
		const value = await inputChildPromptTemplateValue(quickInputService, input, linkedPlan);
		if (value === undefined) {
			return undefined;
		}

		values[input.key] = value.trim();
	}

	return values;
}

async function inputChildPromptTemplateValue(
	quickInputService: IQuickInputService,
	input: HorusPromptTemplateInputDefinition,
	linkedPlan: HorusLinkedDocument
): Promise<string | undefined> {
	const existingValue = input.key === 'pullRequest' ? linkedPlan.pullRequestReference ?? '' : '';
	const value = await quickInputService.input({
		title: input.label,
		value: existingValue,
		prompt: input.multiline ? localize('horusTemplateInputSingleLineLimitation', "{0} Paste concise text here; the native quick input is single-line.", input.helpText) : input.helpText,
		placeHolder: input.placeholder,
		ignoreFocusLost: !!input.multiline,
		validateInput: input.required === false
			? undefined
			: async value => value.trim() ? undefined : localize('horusTemplateInputRequired', "{0} is required.", input.label)
	});

	if (value === undefined) {
		return undefined;
	}

	return value.trim();
}

async function pickVersionPair<TVersion extends HorusComparableVersion>(
	quickInputService: IQuickInputService,
	versions: readonly TVersion[],
	originalPlaceHolder: string,
	modifiedPlaceHolder: string,
	getDetail: (version: TVersion) => string | undefined
): Promise<{ readonly original: TVersion; readonly modified: TVersion } | undefined> {
	const items = versions.map(version => toVersionPickItem(version, getDetail));
	const original = await quickInputService.pick(items, { placeHolder: originalPlaceHolder });
	if (!original) {
		return undefined;
	}

	const modified = await quickInputService.pick(items.filter(item => item.version.versionNumber !== original.version.versionNumber), { placeHolder: modifiedPlaceHolder });
	if (!modified) {
		return undefined;
	}

	return { original: original.version, modified: modified.version };
}

function toVersionPickItem<TVersion extends HorusComparableVersion>(version: TVersion, getDetail: (version: TVersion) => string | undefined): HorusVersionPick<TVersion> {
	return {
		label: localize('horusVersionPickLabel', "Version {0}", version.versionNumber),
		description: new Date(version.createdAtUtc).toLocaleString(),
		detail: getDetail(version),
		version
	};
}

function getPromptVersionPickDetail(version: HorusPromptVersion): string | undefined {
	const note = version.changeNote?.trim();
	return note ? localize('horusPromptVersionPickDetail', "{0} - {1} characters", note, version.content.length) : localize('horusPromptVersionPickDetailNoNote', "{0} characters", version.content.length);
}

function getLinkedDocumentVersionPickDetail(version: HorusLinkedDocumentVersion): string {
	return localize('horusLinkedVersionPickDetail', "{0} - {1} bytes - {2}", getLinkedDocumentVersionSourceLabel(version.source), version.sizeBytes, version.contentHash.slice(0, 12));
}

function getLinkedDocumentVersionSourceLabel(source: HorusLinkedDocumentVersionSource): string {
	switch (source) {
		case HorusLinkedDocumentVersionSource.Initial:
			return localize('horusLinkedVersionSourceInitial', "Initial");
		case HorusLinkedDocumentVersionSource.FileWatcher:
			return localize('horusLinkedVersionSourceFileWatcher', "File watcher");
		case HorusLinkedDocumentVersionSource.ManualRefresh:
			return localize('horusLinkedVersionSourceManualRefresh', "Manual refresh");
	}
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: HorusCommandId.CreatePrompt,
			title: localize2('horusCreatePromptCommand', "Horus: Create Prompt"),
			category: horusCategory,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const horusStorageService = accessor.get(IHorusStorageService);
		const commandService = accessor.get(ICommandService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);

		const workspace = await resolveWorkspaceForCommand(workspaceContextService, horusStorageService, commandService, notificationService);
		if (!workspace) {
			return;
		}

		const title = await quickInputService.input({ prompt: localize('horusPromptTitlePrompt', "Prompt title") });
		if (!title) {
			return;
		}

		const content = await quickInputService.input({
			prompt: localize('horusPromptContentPrompt', "Initial Markdown content"),
			value: ''
		});

		try {
			const prompt = await horusStorageService.createPrompt({
				workingDirectoryId: workspace.id,
				title,
				content: content ?? ''
			});
			horusWorkbenchState.setSelectedWorkspaceId(workspace.id);
			horusWorkbenchState.setSelectedPromptId(prompt.id);
			await commandService.executeCommand(HorusCommandId.OpenPrompt, prompt.id);
			notificationService.info(localize('horusPromptCreated', "Horus prompt created: {0}", title));
		} catch (error) {
			notificationService.error(error);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: HorusCommandId.CreateChildPrompt,
			title: localize2('horusCreateChildPromptCommand', "Horus: Create Child Prompt"),
			category: horusCategory,
			f1: true,
			precondition: HorusContext.PromptSelected
		});
	}

	async run(accessor: ServicesAccessor, parentPromptId?: string): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const horusStorageService = accessor.get(IHorusStorageService);
		const commandService = accessor.get(ICommandService);
		const instantiationService = accessor.get(IInstantiationService);

		const parent = await resolveSelectedPromptForCommand(horusStorageService, notificationService, parentPromptId);
		if (!parent) {
			return;
		}

		const linkedPlan = await horusStorageService.getLinkedDocumentForPrompt(parent.id);
		if (!linkedPlan) {
			notificationService.info(localize('horusChildPromptRequiresLinkedPlan', "Link a Markdown plan before creating child prompts."));
			return;
		}

		const template = await pickChildPromptTemplate(quickInputService);
		if (!template) {
			return;
		}

		const inputs = await collectChildPromptTemplateInputs(quickInputService, template, linkedPlan);
		if (!inputs) {
			return;
		}

		const rendered = renderHorusChildPromptTemplate(template, {
			absolutePath: linkedPlan.absolutePath,
			displayName: linkedPlan.displayName ?? linkedPlan.absolutePath,
			parentPromptContent: parent.content,
			pullRequestReference: linkedPlan.pullRequestReference,
			inputs
		});

		try {
			const child = await horusStorageService.createPrompt({
				workingDirectoryId: parent.workingDirectoryId,
				parentPromptId: parent.id,
				title: rendered.title,
				content: rendered.content,
				targetAgent: template.defaultTargetAgent,
				kind: template.defaultKind,
				changeNote: localize('horusChildPromptGeneratedViaTemplate', "Generated via \"{0}\"", template.displayName)
			});
			if (template.targetPhaseRole) {
				await horusStorageService.advanceWorkflowToRole({
					promptId: parent.id,
					targetRole: template.targetPhaseRole,
					sourceName: template.displayName,
					isReReview: template.isReReview
				});
			}
			horusWorkbenchState.setSelectedWorkspaceId(parent.workingDirectoryId);
			horusWorkbenchState.setSelectedPromptId(child.id);
			await commandService.executeCommand(HorusCommandId.OpenPrompt, child.id);
			const launch = await quickInputService.pick([
				{
					label: localize('horusLaunchChildPromptNow', "Submit child prompt in native terminal"),
					description: localize('horusLaunchChildPromptNowDescription', "Opens VS Code integrated terminal in the workspace and sends the prompt."),
					launch: true
				},
				{
					label: localize('horusOpenChildPromptOnly', "Only open the prompt"),
					description: localize('horusOpenChildPromptOnlyDescription', "Do not start an agent terminal now."),
					launch: false
				}
			], {
				placeHolder: localize('horusLaunchChildPromptQuestion', "Launch this child prompt in a native terminal?")
			});
			if (launch?.launch) {
				const workspace = (await horusStorageService.listWorkspaces()).find(candidate => candidate.id === child.workingDirectoryId);
				if (!workspace) {
					notificationService.error(localize('horusPromptWorkspaceMissing', "The prompt workspace was not found."));
					return;
				}
				await instantiationService.createInstance(HorusTerminalLauncher).launchPrompt(child, workspace, defaultTerminalLaunchForPrompt(child), true);
			}
			notificationService.info(localize('horusChildPromptCreated', "Child prompt created from {0}: {1}", template.displayName, child.title));
		} catch (error) {
			notificationService.error(error);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: HorusCommandId.OpenPrompt,
			title: localize2('horusOpenPromptCommand', "Horus: Open Prompt"),
			category: horusCategory,
			f1: true,
			precondition: HorusContext.PromptSelected
		});
	}

	async run(accessor: ServicesAccessor, promptId?: string): Promise<void> {
		const notificationService = accessor.get(INotificationService);
		const editorService = accessor.get(IEditorService);
		const horusStorageService = accessor.get(IHorusStorageService);

		const selectedPromptId = promptId ?? horusWorkbenchState.getSelectedPromptId();
		if (!selectedPromptId) {
			notificationService.info(localize('horusSelectPromptFirst', "Select a Horus prompt first."));
			return;
		}

		const prompt = await horusStorageService.getPrompt(selectedPromptId);
		if (!prompt) {
			notificationService.error(localize('horusOpenPromptMissing', "The selected Horus prompt no longer exists."));
			horusWorkbenchState.setSelectedPromptId(undefined);
			return;
		}

		horusWorkbenchState.setSelectedWorkspaceId(prompt.workingDirectoryId);
		horusWorkbenchState.setSelectedPromptId(prompt.id);
		await editorService.openEditor(new HorusPromptEditorInput(prompt.id, prompt.title), { pinned: true });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: HorusCommandId.OpenWorkflowBoard,
			title: localize2('horusOpenWorkflowBoardCommand', "Horus: Open Workflow Board"),
			category: horusCategory,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const instantiationService = accessor.get(IInstantiationService);
		const notificationService = accessor.get(INotificationService);

		try {
			await openHorusWorkflowBoard(instantiationService);
		} catch (error) {
			notificationService.error(error);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: HorusCommandId.LaunchPromptTerminal,
			title: localize2('horusLaunchPromptTerminalCommand', "Horus: Launch Prompt Terminal"),
			category: horusCategory,
			f1: true,
			precondition: HorusContext.PromptSelected
		});
	}

	async run(accessor: ServicesAccessor, promptId?: string, options?: HorusLaunchPromptTerminalOptions): Promise<void> {
		const notificationService = accessor.get(INotificationService);
		const horusStorageService = accessor.get(IHorusStorageService);
		const instantiationService = accessor.get(IInstantiationService);

		try {
			const prompt = await resolveSelectedPromptForCommand(horusStorageService, notificationService, promptId);
			if (!prompt) {
				return;
			}

			const workspace = (await horusStorageService.listWorkspaces()).find(candidate => candidate.id === prompt.workingDirectoryId);
			if (!workspace) {
				notificationService.error(localize('horusPromptWorkspaceMissing', "The prompt workspace was not found."));
				return;
			}

			const agent = options?.agent ?? defaultTerminalLaunchForPrompt(prompt);
			await instantiationService.createInstance(HorusTerminalLauncher).launchPrompt(prompt, workspace, agent, options?.submitPrompt);
		} catch (error) {
			notificationService.error(error);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: HorusCommandId.LinkPlanToPrompt,
			title: localize2('horusLinkPlanToPromptCommand', "Horus: Link Plan to Prompt"),
			category: horusCategory,
			f1: true,
			precondition: HorusContext.PromptSelected
		});
	}

	async run(accessor: ServicesAccessor, promptId?: string): Promise<void> {
		const notificationService = accessor.get(INotificationService);
		const horusStorageService = accessor.get(IHorusStorageService);
		const fileDialogService = accessor.get(IFileDialogService);

		const prompt = await resolveSelectedPromptForCommand(horusStorageService, notificationService, promptId);
		if (!prompt) {
			return;
		}

		const workspace = (await horusStorageService.listWorkspaces()).find(candidate => candidate.id === prompt.workingDirectoryId);
		const selection = await fileDialogService.showOpenDialog({
			title: localize('horusPickLinkedPlanTitle', "Select Markdown plan to monitor"),
			openLabel: localize('horusPickLinkedPlanOpenLabel', "Link Plan"),
			defaultUri: workspace ? URI.file(workspace.absolutePath) : undefined,
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			filters: [{ name: localize('horusMarkdownFilesFilter', "Markdown"), extensions: ['md', 'markdown'] }]
		});

		const resource = selection?.[0];
		if (!resource) {
			return;
		}

		try {
			const result = await horusStorageService.linkPlanToPrompt({
				promptId: prompt.id,
				absolutePath: resource.fsPath
			});
			notificationService.info(localize('horusLinkedPlanCreated', "Linked plan is now monitored: {0}", result.document.displayName ?? result.document.absolutePath));
		} catch (error) {
			notificationService.error(error);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: HorusCommandId.SyncLinkedPlan,
			title: localize2('horusSyncLinkedPlanCommand', "Horus: Sync Linked Plan"),
			category: horusCategory,
			f1: true,
			precondition: HorusContext.PromptSelected
		});
	}

	async run(accessor: ServicesAccessor, promptIdOrLinkedDocumentId?: string): Promise<void> {
		const notificationService = accessor.get(INotificationService);
		const horusStorageService = accessor.get(IHorusStorageService);

		const document = await resolveLinkedPlanForCommand(horusStorageService, notificationService, promptIdOrLinkedDocumentId);
		if (!document) {
			return;
		}

		try {
			const result = await horusStorageService.syncLinkedDocument(document.id, HorusLinkedDocumentVersionSource.ManualRefresh);
			notificationService.info(result.versionCreated
				? localize('horusLinkedPlanSyncedNewVersion', "Linked plan synced: version {0}", result.document.currentVersion)
				: localize('horusLinkedPlanSyncedNoChange', "Linked plan synced: no content changes."));
		} catch (error) {
			notificationService.error(error);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: HorusCommandId.OpenLinkedPlanFile,
			title: localize2('horusOpenLinkedPlanFileCommand', "Horus: Open Linked Plan"),
			category: horusCategory,
			f1: true,
			precondition: HorusContext.PromptSelected
		});
	}

	async run(accessor: ServicesAccessor, promptIdOrLinkedDocumentId?: string): Promise<void> {
		const notificationService = accessor.get(INotificationService);
		const horusStorageService = accessor.get(IHorusStorageService);
		const editorService = accessor.get(IEditorService);

		const document = await resolveLinkedPlanForCommand(horusStorageService, notificationService, promptIdOrLinkedDocumentId);
		if (document) {
			await editorService.openEditor(new HorusLinkedPlanEditorInput(document.id, document.displayName ?? document.absolutePath), { pinned: true });
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: HorusCommandId.OpenLinkedPlanDiff,
			title: localize2('horusOpenLinkedPlanDiffCommand', "Horus: Compare Linked Plan Versions"),
			category: horusCategory,
			f1: true,
			precondition: HorusContext.PromptSelected
		});
	}

	async run(accessor: ServicesAccessor, promptIdOrLinkedDocumentId?: string): Promise<void> {
		const notificationService = accessor.get(INotificationService);
		const horusStorageService = accessor.get(IHorusStorageService);
		const editorService = accessor.get(IEditorService);
		const quickInputService = accessor.get(IQuickInputService);

		const document = await resolveLinkedPlanForCommand(horusStorageService, notificationService, promptIdOrLinkedDocumentId);
		if (!document) {
			return;
		}

		const versions = await horusStorageService.listLinkedDocumentVersions(document.id);
		if (versions.length < 2) {
			notificationService.info(localize('horusLinkedPlanNeedsTwoVersions', "The linked plan needs at least two versions to compare."));
			return;
		}

		const pair = await pickVersionPair(
			quickInputService,
			versions,
			localize('horusPickLinkedPlanOriginalVersion', "Select the linked plan base/original version"),
			localize('horusPickLinkedPlanModifiedVersion', "Select the linked plan version to compare against"),
			getLinkedDocumentVersionPickDetail
		);
		if (!pair) {
			return;
		}

		await editorService.openEditor({
			label: localize('horusLinkedPlanDiffLabel', "{0}: v{1} ↔ v{2}", document.displayName ?? 'Linked plan', pair.original.versionNumber, pair.modified.versionNumber),
			original: { resource: createHorusLinkedDocumentVersionResource(document.id, pair.original.versionNumber) },
			modified: { resource: createHorusLinkedDocumentVersionResource(document.id, pair.modified.versionNumber) },
			options: { pinned: true }
		});
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: HorusCommandId.OpenPromptVersionDiff,
			title: localize2('horusOpenPromptVersionDiffCommand', "Horus: Compare Prompt Versions"),
			category: horusCategory,
			f1: true,
			precondition: HorusContext.PromptSelected
		});
	}

	async run(accessor: ServicesAccessor, promptId?: string): Promise<void> {
		const notificationService = accessor.get(INotificationService);
		const horusStorageService = accessor.get(IHorusStorageService);
		const editorService = accessor.get(IEditorService);
		const quickInputService = accessor.get(IQuickInputService);

		const prompt = await resolveSelectedPromptForCommand(horusStorageService, notificationService, promptId);
		if (!prompt) {
			return;
		}

		const versions = await horusStorageService.listPromptVersions(prompt.id);
		if (versions.length < 2) {
			notificationService.info(localize('horusPromptNeedsTwoVersions', "The prompt needs at least two versions to compare."));
			return;
		}

		const pair = await pickVersionPair(
			quickInputService,
			versions,
			localize('horusPickPromptOriginalVersion', "Select the prompt base/original version"),
			localize('horusPickPromptModifiedVersion', "Select the prompt version to compare against"),
			getPromptVersionPickDetail
		);
		if (!pair) {
			return;
		}

		await editorService.openEditor({
			label: localize('horusPromptDiffLabel', "{0}: v{1} ↔ v{2}", prompt.title, pair.original.versionNumber, pair.modified.versionNumber),
			original: { resource: createHorusPromptVersionResource(prompt.id, pair.original.versionNumber) },
			modified: { resource: createHorusPromptVersionResource(prompt.id, pair.modified.versionNumber) },
			options: { pinned: true }
		});
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: HorusCommandId.PauseLinkedPlan,
			title: localize2('horusPauseLinkedPlanCommand', "Horus: Pause Linked Plan Monitoring"),
			category: horusCategory,
			f1: true,
			precondition: HorusContext.PromptSelected
		});
	}

	async run(accessor: ServicesAccessor, promptIdOrLinkedDocumentId?: string): Promise<void> {
		const notificationService = accessor.get(INotificationService);
		const horusStorageService = accessor.get(IHorusStorageService);
		const document = await resolveLinkedPlanForCommand(horusStorageService, notificationService, promptIdOrLinkedDocumentId);
		if (!document) {
			return;
		}

		try {
			await horusStorageService.updateLinkedDocumentStatus({ id: document.id, status: HorusLinkedDocumentStatus.Paused });
			notificationService.info(localize('horusLinkedPlanPaused', "Linked plan monitoring paused."));
		} catch (error) {
			notificationService.error(error);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: HorusCommandId.ResumeLinkedPlan,
			title: localize2('horusResumeLinkedPlanCommand', "Horus: Resume Linked Plan Monitoring"),
			category: horusCategory,
			f1: true,
			precondition: HorusContext.PromptSelected
		});
	}

	async run(accessor: ServicesAccessor, promptIdOrLinkedDocumentId?: string): Promise<void> {
		const notificationService = accessor.get(INotificationService);
		const horusStorageService = accessor.get(IHorusStorageService);
		const document = await resolveLinkedPlanForCommand(horusStorageService, notificationService, promptIdOrLinkedDocumentId);
		if (!document) {
			return;
		}

		try {
			await horusStorageService.updateLinkedDocumentStatus({ id: document.id, status: HorusLinkedDocumentStatus.Watching });
			await horusStorageService.syncLinkedDocument(document.id, HorusLinkedDocumentVersionSource.ManualRefresh);
			notificationService.info(localize('horusLinkedPlanResumed', "Linked plan monitoring resumed."));
		} catch (error) {
			notificationService.error(error);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: HorusCommandId.Refresh,
			title: localize2('horusRefreshCommand', "Horus: Refresh"),
			category: horusCategory,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const horusStorageService = accessor.get(IHorusStorageService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		await resolveCurrentHorusWorkspace(workspaceContextService, horusStorageService);
		await horusStorageService.getHealth();
	}
});
