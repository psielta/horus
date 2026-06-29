import * as DOM from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHorusStorageService } from '../../../../../platform/horus/common/horusStorage.js';
import { HorusWorkspace } from '../../../../../platform/horus/common/horusTypes.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IViewletViewOptions } from '../../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { resolveNativeHorusWorkspaces } from '../horusNativeWorkspaces.js';
import { horusWorkbenchState } from '../horusWorkbenchState.js';
import { HorusViewPane } from './horusViewPane.js';

export class HorusWorkspaceListView extends HorusViewPane {

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IHorusStorageService private readonly horusStorageService: IHorusStorageService,
		@ICommandService private readonly commandService: ICommandService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		this._register(this.horusStorageService.onDidChangeData(event => {
			if (event.kind === 'workspace' || event.kind === 'prompt' || event.kind === 'storage') {
				this.refresh().catch(error => this.renderMessage(String(error)));
			}
		}));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.refresh().catch(error => this.renderMessage(String(error)))));
		this._register(horusWorkbenchState.onDidChangeSelectedWorkspace(() => this.refresh().catch(error => this.renderMessage(String(error)))));
	}

	protected async refresh(): Promise<void> {
		if (!this.horusBody) {
			return;
		}

		const workspaces = await resolveNativeHorusWorkspaces(this.workspaceContextService, this.horusStorageService);
		DOM.clearNode(this.horusBody);

		if (!workspaces.length) {
			this.horusBody.appendChild(this.renderButton(localize('horusOpenFolder', "Open Folder"), () => this.commandService.executeCommand('workbench.action.files.openFolder')));
			this.appendMessage(localize('horusNoNativeWorkspace', "Open a folder in VS Code to use Horus in that workspace."));
			return;
		}

		if (!workspaces.some(workspace => workspace.id === horusWorkbenchState.getSelectedWorkspaceId())) {
			horusWorkbenchState.setSelectedWorkspaceId(workspaces[0].id);
		}

		const list = DOM.append(this.horusBody, DOM.$('.horus-list'));
		for (const workspace of workspaces) {
			list.appendChild(this.renderWorkspace(workspace));
		}
	}

	private renderWorkspace(workspace: HorusWorkspace): HTMLElement {
		const item = DOM.$('.horus-list-item') as HTMLElement;
		if (horusWorkbenchState.getSelectedWorkspaceId() === workspace.id) {
			item.classList.add('selected');
		}

		const title = DOM.append(item, DOM.$('.horus-list-title'));
		title.textContent = workspace.name;

		const description = DOM.append(item, DOM.$('.horus-list-description'));
		description.textContent = `${workspace.absolutePath} - ${workspace.promptCount ?? 0} prompts`;

		this._register(DOM.addDisposableListener(item, DOM.EventType.CLICK, () => {
			horusWorkbenchState.setSelectedWorkspaceId(workspace.id);
		}));

		return item;
	}
}
