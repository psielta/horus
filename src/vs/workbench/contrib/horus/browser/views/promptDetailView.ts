import * as DOM from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IHorusStorageService } from '../../../../../platform/horus/common/horusStorage.js';
import { HorusLinkedDocument, HorusLinkedDocumentStatus, HorusPrompt } from '../../../../../platform/horus/common/horusTypes.js';
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
			if (event.kind === 'prompt' || event.kind === 'linkedDocument' || event.kind === 'storage') {
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

		this.horusBody.appendChild(this.renderButton(localize('horusOpenPromptEditor', "Open Prompt Editor"), () => this.commandService.executeCommand(HorusCommandId.OpenPrompt, prompt.id)));
		this.horusBody.appendChild(this.renderButton(localize('horusComparePromptVersions', "Compare Prompt Versions"), () => this.commandService.executeCommand(HorusCommandId.OpenPromptVersionDiff, prompt.id)));
		this.horusBody.appendChild(this.renderButton(localize('horusCreateChildPromptFromDetail', "Create Child Prompt"), () => this.commandService.executeCommand(HorusCommandId.CreateChildPrompt, prompt.id)));
		this.horusBody.appendChild(this.renderButton(localize('horusLinkPlanFromDetail', "Link Plan"), () => this.commandService.executeCommand(HorusCommandId.LinkPlanToPrompt, prompt.id)));

		const title = DOM.append(this.horusBody, DOM.$('.horus-detail-title'));
		title.textContent = prompt.title;

		const metadata = DOM.append(this.horusBody, DOM.$('.horus-detail-meta'));
		metadata.textContent = localize('horusPromptMetadata', "Version {0} - Updated {1}", prompt.currentVersion, new Date(prompt.updatedAtUtc).toLocaleString());

		await this.renderLinkedPlan(prompt);
		await this.renderChildPrompts(prompt);
	}

	private async renderLinkedPlan(prompt: HorusPrompt): Promise<void> {
		if (!this.horusBody) {
			return;
		}

		const document = await this.horusStorageService.getLinkedDocumentForPrompt(prompt.id);
		const section = DOM.append(this.horusBody, DOM.$('.horus-detail-section'));
		const heading = DOM.append(section, DOM.$('.horus-detail-section-title'));
		heading.textContent = localize('horusLinkedPlanSection', "Linked Plan");

		if (!document) {
			const empty = DOM.append(section, DOM.$('.horus-detail-meta'));
			empty.textContent = localize('horusNoLinkedPlan', "No linked plan is being monitored.");
			return;
		}

		const meta = DOM.append(section, DOM.$('.horus-detail-meta'));
		meta.textContent = localize('horusLinkedPlanMeta', "{0} - {1} - v{2} - Last sync {3}",
			document.displayName ?? document.absolutePath,
			this.getLinkedPlanStatusLabel(document),
			document.currentVersion,
			document.lastSyncedAtUtc ? new Date(document.lastSyncedAtUtc).toLocaleString() : localize('horusLinkedPlanNeverSynced', "never"));
		meta.title = document.absolutePath;

		const actions = DOM.append(section, DOM.$('.horus-detail-actions'));
		actions.appendChild(this.renderButton(localize('horusOpenLinkedPlanFile', "Open File"), () => this.commandService.executeCommand(HorusCommandId.OpenLinkedPlanFile, document.id)));
		actions.appendChild(this.renderButton(localize('horusSyncLinkedPlan', "Sync Now"), () => this.commandService.executeCommand(HorusCommandId.SyncLinkedPlan, document.id)));
		actions.appendChild(this.renderButton(localize('horusCompareLinkedPlanVersions', "Compare Versions"), () => this.commandService.executeCommand(HorusCommandId.OpenLinkedPlanDiff, document.id)));
		actions.appendChild(this.renderButton(document.status === HorusLinkedDocumentStatus.Paused ? localize('horusResumeLinkedPlan', "Resume Monitoring") : localize('horusPauseLinkedPlan', "Pause Monitoring"), () => {
			const command = document.status === HorusLinkedDocumentStatus.Paused ? HorusCommandId.ResumeLinkedPlan : HorusCommandId.PauseLinkedPlan;
			return this.commandService.executeCommand(command, document.id);
		}));

		if (document.lastError) {
			const error = DOM.append(section, DOM.$('.horus-detail-error'));
			error.textContent = document.lastError;
		}

		const versions = await this.horusStorageService.listLinkedDocumentVersions(document.id);
		const versionList = DOM.append(section, DOM.$('.horus-detail-version-list'));
		for (const version of versions.slice(0, 5)) {
			const item = DOM.append(versionList, DOM.$('.horus-detail-version'));
			item.textContent = localize('horusLinkedPlanVersionItem', "v{0} - {1} - {2} bytes", version.versionNumber, new Date(version.createdAtUtc).toLocaleString(), version.sizeBytes);
		}
	}

	private async renderChildPrompts(prompt: HorusPrompt): Promise<void> {
		if (!this.horusBody) {
			return;
		}

		const children = await this.horusStorageService.listPrompts({
			workingDirectoryId: prompt.workingDirectoryId,
			parentPromptId: prompt.id
		});
		const section = DOM.append(this.horusBody, DOM.$('.horus-detail-section'));
		const heading = DOM.append(section, DOM.$('.horus-detail-section-title'));
		heading.textContent = localize('horusChildPromptsSection', "Child Prompts");

		if (!children.length) {
			const empty = DOM.append(section, DOM.$('.horus-detail-meta'));
			empty.textContent = localize('horusNoChildPrompts', "No child prompts yet.");
			return;
		}

		const list = DOM.append(section, DOM.$('.horus-list'));
		for (const child of children) {
			const item = DOM.append(list, DOM.$('.horus-list-item'));
			const title = DOM.append(item, DOM.$('.horus-list-title'));
			title.textContent = child.title;
			const description = DOM.append(item, DOM.$('.horus-list-description'));
			description.textContent = localize('horusChildPromptDescription', "v{0} - {1}", child.currentVersion, new Date(child.updatedAtUtc).toLocaleString());
			this._register(DOM.addDisposableListener(item, DOM.EventType.CLICK, () => {
				horusWorkbenchState.setSelectedPromptId(child.id);
				this.commandService.executeCommand(HorusCommandId.OpenPrompt, child.id);
			}));
		}
	}

	private getLinkedPlanStatusLabel(document: HorusLinkedDocument): string {
		switch (document.status) {
			case HorusLinkedDocumentStatus.Watching:
				return localize('horusLinkedPlanWatching', "watching");
			case HorusLinkedDocumentStatus.Paused:
				return localize('horusLinkedPlanPausedStatus', "paused");
			case HorusLinkedDocumentStatus.Error:
				return localize('horusLinkedPlanErrorStatus', "error");
			case HorusLinkedDocumentStatus.Draft:
				return localize('horusLinkedPlanDraftStatus', "draft");
		}
	}
}
