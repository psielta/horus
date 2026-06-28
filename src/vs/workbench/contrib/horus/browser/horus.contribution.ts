import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IHorusStorageService } from '../../../../platform/horus/common/horusStorage.js';
import { HorusWorkspace } from '../../../../platform/horus/common/horusTypes.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { HorusCommandId, HorusContext, HORUS_PROMPT_DETAIL_VIEW_ID, HORUS_PROMPTS_VIEW_ID, HORUS_VIEW_CONTAINER_ID, HORUS_WORKSPACES_VIEW_ID } from '../common/horus.js';
import { resolveNativeHorusWorkspaces } from './horusNativeWorkspaces.js';
import { horusWorkbenchState } from './horusWorkbenchState.js';
import { HorusPromptDetailView } from './views/promptDetailView.js';
import { HorusPromptListView } from './views/promptListView.js';
import { HorusWorkspaceListView } from './views/workspaceListView.js';

const horusViewIcon = registerIcon('horus-view-icon', Codicon.eye, localize('horusViewIcon', 'View icon of the Horus view.'));
const horusCategory = localize2('horusCategory', "Horus");
const openFolderCommandId = 'workbench.action.files.openFolder';

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
			notificationService.info(localize('horusPromptCreated', "Horus prompt created: {0}", title));
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
