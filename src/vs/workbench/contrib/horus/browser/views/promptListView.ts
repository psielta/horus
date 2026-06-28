import * as DOM from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHorusStorageService } from '../../../../../platform/horus/common/horusStorage.js';
import { HorusPrompt } from '../../../../../platform/horus/common/horusTypes.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IViewletViewOptions } from '../../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { HorusCommandId } from '../../common/horus.js';
import { resolveNativeHorusWorkspaces } from '../horusNativeWorkspaces.js';
import { horusWorkbenchState } from '../horusWorkbenchState.js';
import { HorusViewPane } from './horusViewPane.js';

export class HorusPromptListView extends HorusViewPane {

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
			if (event.kind === 'prompt' || event.kind === 'workspace' || event.kind === 'storage') {
				this.refresh().catch(error => this.renderMessage(String(error)));
			}
		}));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this.refresh().catch(error => this.renderMessage(String(error)))));
		this._register(horusWorkbenchState.onDidChangeSelectedWorkspace(() => this.refresh().catch(error => this.renderMessage(String(error)))));
		this._register(horusWorkbenchState.onDidChangeSelectedPrompt(() => this.refresh().catch(error => this.renderMessage(String(error)))));
	}

	protected async refresh(): Promise<void> {
		if (!this.horusBody) {
			return;
		}

		DOM.clearNode(this.horusBody);
		this.horusBody.appendChild(this.renderButton(localize('horusCreatePrompt', "Create Prompt"), () => this.commandService.executeCommand(HorusCommandId.CreatePrompt)));

		const workspaces = await resolveNativeHorusWorkspaces(this.workspaceContextService, this.horusStorageService);
		if (!workspaces.length) {
			this.appendMessage(localize('horusOpenWorkspaceForPrompts', "Open a folder to create and list Horus prompts."));
			return;
		}

		let selectedWorkspaceId = horusWorkbenchState.getSelectedWorkspaceId();
		if (!workspaces.some(workspace => workspace.id === selectedWorkspaceId)) {
			selectedWorkspaceId = workspaces[0].id;
			horusWorkbenchState.setSelectedWorkspaceId(selectedWorkspaceId);
		}

		const prompts = await this.horusStorageService.listPrompts({ workingDirectoryId: selectedWorkspaceId, rootOnly: true });
		if (!prompts.length) {
			horusWorkbenchState.setSelectedPromptId(undefined);
			this.appendMessage(localize('horusNoPrompts', "No root prompts in this workspace."));
			return;
		}

		const selectedPromptId = horusWorkbenchState.getSelectedPromptId();
		const selectedPrompt = selectedPromptId ? await this.horusStorageService.getPrompt(selectedPromptId) : undefined;
		if (!selectedPrompt || selectedPrompt.workingDirectoryId !== selectedWorkspaceId) {
			horusWorkbenchState.setSelectedPromptId(prompts[0].id);
		}

		const list = DOM.append(this.horusBody, DOM.$('.horus-list'));
		for (const prompt of prompts) {
			list.appendChild(this.renderPrompt(prompt));
		}
	}

	private renderPrompt(prompt: HorusPrompt): HTMLElement {
		const item = DOM.$('.horus-list-item') as HTMLElement;
		if (horusWorkbenchState.getSelectedPromptId() === prompt.id) {
			item.classList.add('selected');
		}

		const title = DOM.append(item, DOM.$('.horus-list-title'));
		title.textContent = prompt.title;

		const description = DOM.append(item, DOM.$('.horus-list-description'));
		description.textContent = `v${prompt.currentVersion} - ${new Date(prompt.updatedAtUtc).toLocaleString()}`;

		this._register(DOM.addDisposableListener(item, DOM.EventType.CLICK, () => {
			horusWorkbenchState.setSelectedPromptId(prompt.id);
		}));
		this._register(DOM.addDisposableListener(item, DOM.EventType.DBLCLICK, () => {
			horusWorkbenchState.setSelectedPromptId(prompt.id);
			this.commandService.executeCommand(HorusCommandId.OpenPrompt, prompt.id);
		}));

		return item;
	}
}
