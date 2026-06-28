import './horusViews.css';
import * as DOM from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { ViewPane } from '../../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../../browser/parts/views/viewsViewlet.js';

export abstract class HorusViewPane extends ViewPane {

	protected horusBody: HTMLElement | undefined;

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
		@IHoverService hoverService: IHoverService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.horusBody = DOM.append(container, DOM.$('.horus-view-pane'));
		this.refresh().catch(error => this.renderMessage(localize('horusViewLoadError', "Failed to load Horus data: {0}", String(error))));
	}

	protected renderMessage(message: string): void {
		if (!this.horusBody) {
			return;
		}

		DOM.clearNode(this.horusBody);
		this.appendMessage(message);
	}

	protected appendMessage(message: string): void {
		if (!this.horusBody) {
			return;
		}

		const element = DOM.append(this.horusBody, DOM.$('.horus-empty'));
		element.textContent = message;
	}

	protected renderButton(label: string, command: () => void): HTMLButtonElement {
		const button = DOM.$('button.horus-button') as HTMLButtonElement;
		button.textContent = label;
		this._register(DOM.addDisposableListener(button, DOM.EventType.CLICK, () => command()));
		return button;
	}

	protected abstract refresh(): Promise<void>;
}
