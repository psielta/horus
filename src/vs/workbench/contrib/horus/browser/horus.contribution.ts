import { Codicon } from '../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../nls.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IHorusStorageService } from '../../../../platform/horus/common/horusStorage.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { HorusCommandId, HORUS_PROMPTS_VIEW_ID, HORUS_VIEW_CONTAINER_ID, HORUS_WORKSPACES_VIEW_ID } from '../common/horus.js';
import { horusWorkbenchState } from './horusWorkbenchState.js';
import { HorusPromptListView } from './views/promptListView.js';
import { HorusWorkspaceListView } from './views/workspaceListView.js';

const horusViewIcon = registerIcon('horus-view-icon', Codicon.eye, localize('horusViewIcon', 'View icon of the Horus view.'));
const horusCategory = localize2('horusCategory', "Horus");

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
	}
], viewContainer);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: HorusCommandId.CreateWorkspace,
			title: localize2('horusCreateWorkspaceCommand', "Horus: Create Workspace"),
			category: horusCategory,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const horusStorageService = accessor.get(IHorusStorageService);

		const firstWorkspaceFolder = workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
		const absolutePath = await quickInputService.input({
			prompt: localize('horusWorkspacePathPrompt', "Workspace absolute path"),
			value: firstWorkspaceFolder
		});

		if (!absolutePath) {
			return;
		}

		const defaultName = absolutePath.split(/[\\/]/g).filter(Boolean).at(-1) ?? 'Workspace';
		const name = await quickInputService.input({
			prompt: localize('horusWorkspaceNamePrompt', "Workspace name"),
			value: defaultName
		});

		if (!name) {
			return;
		}

		try {
			const workspace = await horusStorageService.createWorkspace({ name, absolutePath });
			horusWorkbenchState.setSelectedWorkspaceId(workspace.id);
			notificationService.info(localize('horusWorkspaceCreated', "Horus workspace created: {0}", workspace.name));
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

		const workspaces = await horusStorageService.listWorkspaces();
		if (!workspaces.length) {
			await commandService.executeCommand(HorusCommandId.CreateWorkspace);
			return;
		}

		const selectedWorkspaceId = horusWorkbenchState.getSelectedWorkspaceId();
		const workspace = selectedWorkspaceId
			? workspaces.find(candidate => candidate.id === selectedWorkspaceId) ?? workspaces[0]
			: await quickInputService.pick(workspaces.map(workspace => ({ label: workspace.name, description: workspace.absolutePath, workspace })), {
				placeHolder: localize('horusPickWorkspace', "Select a Horus workspace")
			}).then(item => item?.workspace);

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
			await horusStorageService.createPrompt({
				workingDirectoryId: workspace.id,
				title,
				content: content ?? ''
			});
			horusWorkbenchState.setSelectedWorkspaceId(workspace.id);
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
		await horusStorageService.getHealth();
	}
});
