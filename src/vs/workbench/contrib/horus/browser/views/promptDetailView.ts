import * as DOM from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IHorusStorageService } from '../../../../../platform/horus/common/horusStorage.js';
import { HorusLinkedDocument, HorusLinkedDocumentStatus, HorusPrompt, HorusPromptTerminalSession, HorusPromptTerminalSessionStatus } from '../../../../../platform/horus/common/horusTypes.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IViewletViewOptions } from '../../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { HorusCommandId } from '../../common/horus.js';
import { HorusTerminalLauncher } from '../horusTerminalLauncher.js';
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
		@IInstantiationService private readonly horusInstantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IHorusStorageService private readonly horusStorageService: IHorusStorageService,
		@ICommandService private readonly commandService: ICommandService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, horusInstantiationService, openerService, themeService, hoverService);

		this._register(this.horusStorageService.onDidChangeData(event => {
			if (event.kind === 'prompt' || event.kind === 'linkedDocument' || event.kind === 'terminalSession' || event.kind === 'storage') {
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
		this.horusBody.appendChild(this.renderButton(localize('horusLinkPlanFromDetail', "Link Plan"), () => this.commandService.executeCommand(HorusCommandId.LinkPlanToPrompt, prompt.id)));

		const title = DOM.append(this.horusBody, DOM.$('.horus-detail-title'));
		title.textContent = prompt.title;

		const metadata = DOM.append(this.horusBody, DOM.$('.horus-detail-meta'));
		metadata.textContent = localize('horusPromptMetadata', "Version {0} - Updated {1}", prompt.currentVersion, new Date(prompt.updatedAtUtc).toLocaleString());

		await this.renderLinkedPlan(prompt);
		await this.renderTerminalSessions(prompt);
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
		actions.appendChild(this.renderButton(localize('horusCreateChildPromptFromDetail', "Create Child Prompt"), () => this.commandService.executeCommand(HorusCommandId.CreateChildPrompt, prompt.id)));
		actions.appendChild(this.renderButton(localize('horusOpenLinkedPlanFile', "Open Plan"), () => this.commandService.executeCommand(HorusCommandId.OpenLinkedPlanFile, document.id)));
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

	private async renderTerminalSessions(prompt: HorusPrompt): Promise<void> {
		if (!this.horusBody) {
			return;
		}

		const sessions = await this.horusStorageService.listPromptTerminalSessions(prompt.id);
		const activeCount = sessions.filter(session => session.status === HorusPromptTerminalSessionStatus.Active).length;
		const section = DOM.append(this.horusBody, DOM.$('.horus-detail-section'));
		const heading = DOM.append(section, DOM.$('.horus-detail-section-title'));
		heading.textContent = localize('horusLinkedTerminalsDetailSection', "Linked Terminals");

		const meta = DOM.append(section, DOM.$('.horus-detail-meta'));
		meta.textContent = localize('horusLinkedTerminalsDetailMeta', "{0}/{1} active", activeCount, sessions.length);

		if (!sessions.length) {
			const empty = DOM.append(section, DOM.$('.horus-detail-meta'));
			empty.textContent = localize('horusNoLinkedTerminalsDetail', "No terminals are linked to this prompt yet.");
			return;
		}

		const list = DOM.append(section, DOM.$('.horus-terminal-session-list'));
		for (const session of sessions) {
			this.renderTerminalSession(list, session);
		}
	}

	private renderTerminalSession(container: HTMLElement, session: HorusPromptTerminalSession): void {
		const item = DOM.append(container, DOM.$('.horus-terminal-session'));
		const title = DOM.append(item, DOM.$('.horus-terminal-session-title'));
		title.textContent = session.terminalName;

		const status = session.status === HorusPromptTerminalSessionStatus.Active
			? localize('horusTerminalSessionActive', "active")
			: localize('horusTerminalSessionClosed', "closed");
		const instance = session.terminalInstanceId !== null
			? localize('horusTerminalSessionInstance', "Terminal #{0}", session.terminalInstanceId)
			: localize('horusTerminalSessionNoInstance', "Terminal instance unknown");

		const description = DOM.append(item, DOM.$('.horus-terminal-session-description'));
		description.textContent = localize('horusTerminalSessionDescription', "{0} - {1} - {2} - started {3}",
			status,
			session.agentName,
			instance,
			new Date(session.startedAtUtc).toLocaleString());

		const command = DOM.append(item, DOM.$('code.horus-terminal-session-command'));
		command.textContent = session.launchCommand;

		if (session.status !== HorusPromptTerminalSessionStatus.Active || session.terminalInstanceId === null) {
			return;
		}

		const actions = DOM.append(item, DOM.$('.horus-detail-actions'));
		actions.appendChild(this.renderButton(localize('horusFocusLinkedTerminalDetail', "Focus"), () => {
			this.focusTerminalSession(session).catch(error => this.renderMessage(String(error)));
		}));
		actions.appendChild(this.renderButton(localize('horusKillLinkedTerminalDetail', "Kill"), () => {
			this.killTerminalSession(session).catch(error => this.renderMessage(String(error)));
		}));
	}

	private async focusTerminalSession(session: HorusPromptTerminalSession): Promise<void> {
		if (session.terminalInstanceId === null) {
			await this.horusStorageService.updatePromptTerminalSession({
				id: session.id,
				status: HorusPromptTerminalSessionStatus.Closed,
				endedAtUtc: new Date().toISOString()
			});
			await this.refresh();
			return;
		}

		const focused = await this.horusInstantiationService.createInstance(HorusTerminalLauncher).focusTerminalInstance(session.terminalInstanceId);
		const now = new Date().toISOString();
		await this.horusStorageService.updatePromptTerminalSession({
			id: session.id,
			status: focused ? HorusPromptTerminalSessionStatus.Active : HorusPromptTerminalSessionStatus.Closed,
			lastActivatedAtUtc: focused ? now : undefined,
			endedAtUtc: focused ? undefined : now
		});
		await this.refresh();
	}

	private async killTerminalSession(session: HorusPromptTerminalSession): Promise<void> {
		if (session.terminalInstanceId !== null) {
			await this.horusInstantiationService.createInstance(HorusTerminalLauncher).killTerminalInstance(session.terminalInstanceId);
		}

		await this.horusStorageService.updatePromptTerminalSession({
			id: session.id,
			status: HorusPromptTerminalSessionStatus.Closed,
			endedAtUtc: new Date().toISOString()
		});
		await this.refresh();
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
