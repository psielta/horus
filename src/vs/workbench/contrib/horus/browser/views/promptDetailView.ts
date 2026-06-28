import * as DOM from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IHorusStorageService } from '../../../../../platform/horus/common/horusStorage.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IViewletViewOptions } from '../../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { HorusCommandId } from '../../common/horus.js';
import { horusWorkbenchState } from '../horusWorkbenchState.js';
import { HorusViewPane } from './horusViewPane.js';

export class HorusPromptDetailView extends HorusViewPane {

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
		@ICommandService private readonly commandService: ICommandService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		this._register(this.horusStorageService.onDidChangeData(event => {
			if (event.kind === 'prompt' || event.kind === 'storage') {
				this.refresh().catch(error => this.renderMessage(String(error)));
			}
		}));
		this._register(horusWorkbenchState.onDidChangeSelectedPrompt(() => this.refresh().catch(error => this.renderMessage(String(error)))));
	}

	protected async refresh(): Promise<void> {
		if (!this.horusBody) {
			return;
		}

		DOM.clearNode(this.horusBody);
		const selectedPromptId = horusWorkbenchState.getSelectedPromptId();
		if (!selectedPromptId) {
			this.horusBody.appendChild(this.renderButton(localize('horusCreatePromptFromDetail', "Create Prompt"), () => this.commandService.executeCommand(HorusCommandId.CreatePrompt)));
			this.appendMessage(localize('horusSelectPrompt', "Select a prompt to see its details."));
			return;
		}

		const prompt = await this.horusStorageService.getPrompt(selectedPromptId);
		if (!prompt) {
			this.renderMessage(localize('horusPromptNotFound', "The selected prompt no longer exists."));
			horusWorkbenchState.setSelectedPromptId(undefined);
			return;
		}

		const title = DOM.append(this.horusBody, DOM.$('.horus-detail-title'));
		title.textContent = prompt.title;

		const metadata = DOM.append(this.horusBody, DOM.$('.horus-detail-meta'));
		metadata.textContent = localize('horusPromptMetadata', "Version {0} - Updated {1}", prompt.currentVersion, new Date(prompt.updatedAtUtc).toLocaleString());

		const content = DOM.append(this.horusBody, DOM.$('pre.horus-detail-content'));
		content.textContent = prompt.content || localize('horusPromptEmptyContent', "(empty prompt)");
	}
}
