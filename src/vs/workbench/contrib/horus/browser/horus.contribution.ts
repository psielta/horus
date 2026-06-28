import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IHorusStorageService } from '../../../../platform/horus/common/horusStorage.js';
import { HorusLinkedDocument, HorusLinkedDocumentStatus, HorusLinkedDocumentVersionSource, HorusPrompt, HorusWorkspace } from '../../../../platform/horus/common/horusTypes.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
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
import { HorusPromptEditor } from './editors/promptEditor.js';
import { HorusPromptEditorInput } from './editors/promptEditorInput.js';
import { HorusCommandId, HorusContext, HORUS_PROMPT_DETAIL_VIEW_ID, HORUS_PROMPTS_VIEW_ID, HORUS_VIEW_CONTAINER_ID, HORUS_WORKSPACES_VIEW_ID } from '../common/horus.js';
import { resolveNativeHorusWorkspaces } from './horusNativeWorkspaces.js';
import { createHorusLinkedDocumentVersionResource, createHorusPromptVersionResource, HorusVersionContentProvider } from './horusVersionContentProvider.js';
import { horusWorkbenchState } from './horusWorkbenchState.js';
import { HorusLinkedPlanMonitor } from './linkedPlanMonitor.js';
import { HorusPromptDetailView } from './views/promptDetailView.js';
import { HorusPromptListView } from './views/promptListView.js';
import { HorusWorkspaceListView } from './views/workspaceListView.js';

const horusViewIcon = registerIcon('horus-view-icon', Codicon.eye, localize('horusViewIcon', 'View icon of the Horus view.'));
const horusCategory = localize2('horusCategory', "Horus");
const openFolderCommandId = 'workbench.action.files.openFolder';

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

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory)
	.registerEditorSerializer(HorusPromptEditorInput.ID, HorusPromptEditorInputSerializer);

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

const viewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: HORUS_VIEW_CONTAINER_ID,
	title: localize2('horus', "Horus"),
	icon: horusViewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [HORUS_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: false }]),
	hideIfEmpty: false,
	order: 2
}, ViewContainerLocation.Sidebar, { doNotRegisterOpenCommand: false });

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([
	{
		id: HORUS_WORKSPACES_VIEW_ID,
		name: localize2('horusWorkspaces', "Workspaces"),
		containerIcon: horusViewIcon,
		ctorDescriptor: new SyncDescriptor(HorusWorkspaceListView),
		canToggleVisibility: false,
		canMoveView: true
	},
	{
		id: HORUS_PROMPTS_VIEW_ID,
		name: localize2('horusPrompts', "Prompts"),
		containerIcon: horusViewIcon,
		ctorDescriptor: new SyncDescriptor(HorusPromptListView),
		canToggleVisibility: false,
		canMoveView: true
	},
	{
		id: HORUS_PROMPT_DETAIL_VIEW_ID,
		name: localize2('horusPromptDetails', "Prompt Details"),
		containerIcon: horusViewIcon,
		ctorDescriptor: new SyncDescriptor(HorusPromptDetailView),
		canToggleVisibility: true,
		canMoveView: true
	}
], viewContainer);

class HorusContextKeysContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.horus.contextKeys';

	private readonly hasNativeWorkspaceContext: IContextKey<boolean>;
	private readonly workspaceSelectedContext: IContextKey<boolean>;
	private readonly promptSelectedContext: IContextKey<boolean>;

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) {
		super();

		this.hasNativeWorkspaceContext = HorusContext.HasNativeWorkspace.bindTo(this.contextKeyService);
		this.workspaceSelectedContext = HorusContext.WorkspaceSelected.bindTo(this.contextKeyService);
		this.promptSelectedContext = HorusContext.PromptSelected.bindTo(this.contextKeyService);

		this.update();
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.update()));
		this._register(horusWorkbenchState.onDidChangeSelectedWorkspace(() => this.update()));
		this._register(horusWorkbenchState.onDidChangeSelectedPrompt(() => this.update()));
	}

	private update(): void {
		this.hasNativeWorkspaceContext.set(this.workspaceContextService.getWorkspace().folders.length > 0);
		this.workspaceSelectedContext.set(!!horusWorkbenchState.getSelectedWorkspaceId());
		this.promptSelectedContext.set(!!horusWorkbenchState.getSelectedPromptId());
	}
}

registerWorkbenchContribution2(HorusContextKeysContribution.ID, HorusContextKeysContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(HorusLinkedPlanMonitor.ID, HorusLinkedPlanMonitor, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(HorusVersionContentProvider.ID, HorusVersionContentProvider, WorkbenchPhase.AfterRestored);

async function resolveWorkspaceForCommand(
	workspaceContextService: IWorkspaceContextService,
	horusStorageService: IHorusStorageService,
	quickInputService: IQuickInputService,
	commandService: ICommandService,
	notificationService: INotificationService
): Promise<HorusWorkspace | undefined> {
	const workspaces = await resolveNativeHorusWorkspaces(workspaceContextService, horusStorageService);
	if (!workspaces.length) {
		notificationService.info(localize('horusOpenFolderFirst', "Open a folder first. Horus uses the VS Code workspace as its workspace."));
		await commandService.executeCommand(openFolderCommandId);
		return undefined;
	}

	const selectedWorkspaceId = horusWorkbenchState.getSelectedWorkspaceId();
	const selectedWorkspace = selectedWorkspaceId ? workspaces.find(workspace => workspace.id === selectedWorkspaceId) : undefined;
	if (selectedWorkspace) {
		return selectedWorkspace;
	}

	if (workspaces.length === 1) {
		horusWorkbenchState.setSelectedWorkspaceId(workspaces[0].id);
		return workspaces[0];
	}

	const item = await quickInputService.pick(workspaces.map(workspace => ({
		label: workspace.name,
		description: workspace.absolutePath,
		workspace
	})), {
		placeHolder: localize('horusPickNativeWorkspace', "Select an open VS Code workspace folder")
	});

	if (!item) {
		return undefined;
	}

	horusWorkbenchState.setSelectedWorkspaceId(item.workspace.id);
	return item.workspace;
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

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: HorusCommandId.CreateWorkspace,
			title: localize2('horusUseCurrentWorkspaceCommand', "Horus: Use Current VS Code Workspace"),
			category: horusCategory,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const horusStorageService = accessor.get(IHorusStorageService);
		const commandService = accessor.get(ICommandService);

		try {
			const workspace = await resolveWorkspaceForCommand(workspaceContextService, horusStorageService, quickInputService, commandService, notificationService);
			if (workspace) {
				notificationService.info(localize('horusWorkspaceReady', "Horus is using the open workspace: {0}", workspace.name));
			}
		} catch (error) {
			notificationService.error(error);
		}
	}
});

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

		const workspace = await resolveWorkspaceForCommand(workspaceContextService, horusStorageService, quickInputService, commandService, notificationService);
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

		const parent = await resolveSelectedPromptForCommand(horusStorageService, notificationService, parentPromptId);
		if (!parent) {
			return;
		}

		const title = await quickInputService.input({
			prompt: localize('horusChildPromptTitlePrompt', "Child prompt title"),
			value: localize('horusChildPromptDefaultTitle', "{0} - child", parent.title)
		});
		if (!title) {
			return;
		}

		const content = await quickInputService.input({
			prompt: localize('horusChildPromptContentPrompt', "Initial Markdown content"),
			value: ''
		});

		try {
			const child = await horusStorageService.createPrompt({
				workingDirectoryId: parent.workingDirectoryId,
				parentPromptId: parent.id,
				title,
				content: content ?? '',
				targetAgent: parent.targetAgent,
				kind: parent.kind
			});
			horusWorkbenchState.setSelectedWorkspaceId(parent.workingDirectoryId);
			horusWorkbenchState.setSelectedPromptId(child.id);
			await commandService.executeCommand(HorusCommandId.OpenPrompt, child.id);
			notificationService.info(localize('horusChildPromptCreated', "Child prompt created: {0}", child.title));
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
			title: localize2('horusOpenLinkedPlanFileCommand', "Horus: Open Linked Plan File"),
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
			await editorService.openEditor({ resource: URI.file(document.absolutePath), options: { pinned: true } });
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

		const document = await resolveLinkedPlanForCommand(horusStorageService, notificationService, promptIdOrLinkedDocumentId);
		if (!document) {
			return;
		}

		const versions = await horusStorageService.listLinkedDocumentVersions(document.id);
		if (versions.length < 2) {
			notificationService.info(localize('horusLinkedPlanNeedsTwoVersions', "The linked plan needs at least two versions to compare."));
			return;
		}

		const [latest, previous] = versions;
		await editorService.openEditor({
			label: localize('horusLinkedPlanDiffLabel', "{0}: v{1} ↔ v{2}", document.displayName ?? 'Linked plan', previous.versionNumber, latest.versionNumber),
			original: { resource: createHorusLinkedDocumentVersionResource(document.id, previous.versionNumber) },
			modified: { resource: createHorusLinkedDocumentVersionResource(document.id, latest.versionNumber) },
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

		const prompt = await resolveSelectedPromptForCommand(horusStorageService, notificationService, promptId);
		if (!prompt) {
			return;
		}

		const versions = await horusStorageService.listPromptVersions(prompt.id);
		if (versions.length < 2) {
			notificationService.info(localize('horusPromptNeedsTwoVersions', "The prompt needs at least two versions to compare."));
			return;
		}

		const [latest, previous] = versions;
		await editorService.openEditor({
			label: localize('horusPromptDiffLabel', "{0}: v{1} ↔ v{2}", prompt.title, previous.versionNumber, latest.versionNumber),
			original: { resource: createHorusPromptVersionResource(prompt.id, previous.versionNumber) },
			modified: { resource: createHorusPromptVersionResource(prompt.id, latest.versionNumber) },
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
		await resolveNativeHorusWorkspaces(workspaceContextService, horusStorageService);
		await horusStorageService.getHealth();
	}
});
