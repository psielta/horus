import '../views/horusViews.css';
import * as DOM from '../../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Dimension } from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IHorusStorageService } from '../../../../../platform/horus/common/horusStorage.js';
import { extractHorusFileMentions } from '../../../../../platform/horus/common/horusMentions.js';
import { HorusFileMentionValidationResult, HorusPrompt, HorusPromptKind, HorusPromptStatus, HorusTargetAgent, HorusWorkspace } from '../../../../../platform/horus/common/horusTypes.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { horusWorkbenchState } from '../horusWorkbenchState.js';
import { HorusPromptEditorInput } from './promptEditorInput.js';

interface HorusPromptEditorElements {
	readonly root: HTMLElement;
	readonly title: HTMLInputElement;
	readonly targetAgent: HTMLSelectElement;
	readonly kind: HTMLSelectElement;
	readonly status: HTMLSelectElement;
	readonly content: HTMLTextAreaElement;
	readonly saveButton: HTMLButtonElement;
	readonly validation: HTMLElement;
	readonly statusMessage: HTMLElement;
	readonly metadata: HTMLElement;
}

interface HorusPromptEditorSnapshot {
	readonly title: string;
	readonly targetAgent: HorusTargetAgent;
	readonly kind: HorusPromptKind;
	readonly status: HorusPromptStatus;
	readonly content: string;
}

export class HorusPromptEditor extends EditorPane {

	static readonly ID = HorusPromptEditorInput.EDITOR_ID;

	private readonly contentDisposables = this._register(new DisposableStore());
	private readonly mentionValidationScheduler = this._register(new RunOnceScheduler(() => this.validateMentions().catch(error => this.showStatus(String(error), true)), 300));

	private container: HTMLElement | undefined;
	private elements: HorusPromptEditorElements | undefined;
	private currentInput: HorusPromptEditorInput | undefined;
	private currentPrompt: HorusPrompt | undefined;
	private currentWorkspace: HorusWorkspace | undefined;
	private savedSnapshot: HorusPromptEditorSnapshot | undefined;
	private dirty = false;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IHorusStorageService private readonly horusStorageService: IHorusStorageService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super(HorusPromptEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		this.container = DOM.append(parent, DOM.$('.horus-prompt-editor'));
	}

	override async setInput(input: HorusPromptEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.currentInput = input;
		await this.loadPrompt(input.promptId, token);
	}

	override clearInput(): void {
		this.contentDisposables.clear();
		this.mentionValidationScheduler.cancel();
		this.elements = undefined;
		this.currentInput = undefined;
		this.currentPrompt = undefined;
		this.currentWorkspace = undefined;
		this.savedSnapshot = undefined;
		this.dirty = false;

		if (this.container) {
			DOM.clearNode(this.container);
		}

		super.clearInput();
	}

	override layout(_dimension: Dimension): void {
	}

	private async loadPrompt(promptId: string, token: CancellationToken): Promise<void> {
		if (!this.container) {
			return;
		}

		this.contentDisposables.clear();
		DOM.clearNode(this.container);
		this.container.appendChild(DOM.$('.horus-editor-loading', undefined, localize('horusPromptEditorLoading', "Loading Horus prompt...")));

		const prompt = await this.horusStorageService.getPrompt(promptId);
		if (token.isCancellationRequested) {
			return;
		}

		if (!prompt) {
			DOM.clearNode(this.container);
			this.container.appendChild(DOM.$('.horus-editor-empty', undefined, localize('horusPromptEditorMissing', "The selected Horus prompt no longer exists.")));
			return;
		}

		const workspace = (await this.horusStorageService.listWorkspaces()).find(candidate => candidate.id === prompt.workingDirectoryId);
		if (token.isCancellationRequested) {
			return;
		}

		this.currentPrompt = prompt;
		this.currentWorkspace = workspace;
		this.savedSnapshot = this.toSnapshot(prompt);
		this.dirty = false;
		this.currentInput?.setName(prompt.title);
		horusWorkbenchState.setSelectedWorkspaceId(prompt.workingDirectoryId);
		horusWorkbenchState.setSelectedPromptId(prompt.id);
		this.render(prompt);
		this.scheduleMentionValidation();
	}

	private render(prompt: HorusPrompt): void {
		if (!this.container) {
			return;
		}

		DOM.clearNode(this.container);

		const root = DOM.append(this.container, DOM.$('.horus-editor-root'));
		const header = DOM.append(root, DOM.$('.horus-editor-header'));
		const title = DOM.append(header, DOM.$('input.horus-editor-title')) as HTMLInputElement;
		title.type = 'text';
		title.value = prompt.title;
		title.placeholder = localize('horusPromptEditorTitlePlaceholder', "Prompt title");

		const metadata = DOM.append(header, DOM.$('.horus-editor-metadata'));
		this.setMetadata(metadata, prompt);

		const controls = DOM.append(root, DOM.$('.horus-editor-controls'));
		const targetAgent = this.renderSelect<HorusTargetAgent>(controls, localize('horusPromptEditorAgent', "Agent"), [
			{ label: 'Claude Code', value: HorusTargetAgent.ClaudeCode },
			{ label: 'Codex', value: HorusTargetAgent.Codex },
			{ label: 'Grok', value: HorusTargetAgent.Grok }
		], prompt.targetAgent);
		const kind = this.renderSelect<HorusPromptKind>(controls, localize('horusPromptEditorKind', "Kind"), [
			{ label: localize('horusPromptKindGeneral', "General"), value: HorusPromptKind.General },
			{ label: localize('horusPromptKindPlan', "Plan"), value: HorusPromptKind.Plan },
			{ label: localize('horusPromptKindReview', "Review"), value: HorusPromptKind.Review },
			{ label: localize('horusPromptKindImplementation', "Implementation"), value: HorusPromptKind.Implementation }
		], prompt.kind);
		const status = this.renderSelect<HorusPromptStatus>(controls, localize('horusPromptEditorStatus', "Status"), [
			{ label: localize('horusPromptStatusDraft', "Draft"), value: HorusPromptStatus.Draft },
			{ label: localize('horusPromptStatusActive', "Active"), value: HorusPromptStatus.Active },
			{ label: localize('horusPromptStatusArchived', "Archived"), value: HorusPromptStatus.Archived }
		], prompt.status);

		const toolbar = DOM.append(root, DOM.$('.horus-editor-toolbar'));
		const statusMessage = DOM.append(toolbar, DOM.$('.horus-editor-status'));
		const saveButton = DOM.append(toolbar, DOM.$('button.horus-button.horus-editor-save')) as HTMLButtonElement;
		saveButton.textContent = localize('horusPromptEditorSave', "Save Prompt");

		const content = DOM.append(root, DOM.$('textarea.horus-editor-content')) as HTMLTextAreaElement;
		content.value = prompt.content;
		content.placeholder = localize('horusPromptEditorContentPlaceholder', "Write Markdown. Mention workspace files with @path/to/file.");
		content.spellcheck = false;

		const validation = DOM.append(root, DOM.$('.horus-editor-mentions'));

		this.elements = { root, title, targetAgent, kind, status, content, saveButton, validation, statusMessage, metadata };

		for (const element of [title, targetAgent, kind, status, content]) {
			this.contentDisposables.add(DOM.addDisposableListener(element, DOM.EventType.INPUT, () => this.onEditorChanged()));
		}

		this.contentDisposables.add(DOM.addDisposableListener(saveButton, DOM.EventType.CLICK, () => this.save().catch(error => this.notificationService.error(error))));
		this.showStatus(localize('horusPromptEditorReady', "Ready."), false);
		this.updateDirtyState();
	}

	private renderSelect<T extends number>(
		parent: HTMLElement,
		label: string,
		options: readonly { readonly label: string; readonly value: T }[],
		selected: T
	): HTMLSelectElement {
		const wrapper = DOM.append(parent, DOM.$('.horus-editor-field'));
		const labelElement = DOM.append(wrapper, DOM.$('label.horus-editor-label'));
		labelElement.textContent = label;

		const select = DOM.append(wrapper, DOM.$('select.horus-editor-select')) as HTMLSelectElement;
		for (const option of options) {
			const optionElement = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
			optionElement.value = String(option.value);
			optionElement.textContent = option.label;
		}

		select.value = String(selected);
		return select;
	}

	private onEditorChanged(): void {
		this.updateDirtyState();
		this.scheduleMentionValidation();
	}

	private updateDirtyState(): void {
		if (!this.elements || !this.savedSnapshot) {
			return;
		}

		this.dirty = !this.snapshotsEqual(this.savedSnapshot, this.readSnapshot());
		this.elements.saveButton.disabled = !this.dirty;
		this.showStatus(this.dirty ? localize('horusPromptEditorUnsaved', "Unsaved changes.") : localize('horusPromptEditorSaved', "Saved."), false);
	}

	private scheduleMentionValidation(): void {
		this.mentionValidationScheduler.schedule();
	}

	private async validateMentions(): Promise<void> {
		if (!this.elements) {
			return;
		}

		const mentions = extractHorusFileMentions(this.elements.content.value);
		if (!mentions.length) {
			this.renderMentionValidation([]);
			return;
		}

		if (!this.currentWorkspace) {
			this.elements.validation.textContent = localize('horusPromptEditorMissingWorkspace', "{0} file mention(s). Open the original workspace folder to validate them.", mentions.length);
			return;
		}

		this.elements.validation.textContent = localize('horusPromptEditorValidatingMentions', "Validating {0} file mention(s)...", mentions.length);
		const results = await this.horusStorageService.validateFileMentions({
			workspacePath: this.currentWorkspace.absolutePath,
			mentions,
			respectGitignore: this.currentWorkspace.respectGitignore
		});
		this.renderMentionValidation(results);
	}

	private renderMentionValidation(results: readonly HorusFileMentionValidationResult[]): void {
		if (!this.elements) {
			return;
		}

		DOM.clearNode(this.elements.validation);
		if (!results.length) {
			this.elements.validation.textContent = localize('horusPromptEditorNoMentions', "No file mentions detected.");
			return;
		}

		const missingCount = results.filter(result => !result.exists).length;
		const summary = DOM.append(this.elements.validation, DOM.$('.horus-editor-mentions-summary'));
		summary.textContent = missingCount
			? localize('horusPromptEditorMissingMentions', "{0} file mention(s), {1} missing or ignored.", results.length, missingCount)
			: localize('horusPromptEditorValidMentions', "{0} file mention(s), all resolved.", results.length);

		const list = DOM.append(this.elements.validation, DOM.$('.horus-editor-mentions-list'));
		for (const result of results.slice(0, 20)) {
			const item = DOM.append(list, DOM.$(`.horus-editor-mention.${result.exists ? 'valid' : 'missing'}`));
			item.textContent = `${result.exists ? 'OK' : 'Missing'} @${result.relativePath}`;
			item.title = result.absolutePath;
		}
	}

	private async save(): Promise<void> {
		if (!this.elements || !this.currentPrompt) {
			return;
		}

		const snapshot = this.readSnapshot();
		if (!snapshot.title.trim()) {
			this.showStatus(localize('horusPromptEditorTitleRequired', "Title is required."), true);
			return;
		}

		this.elements.saveButton.disabled = true;
		this.showStatus(localize('horusPromptEditorSaving', "Saving..."), false);

		const updated = await this.horusStorageService.updatePrompt({
			id: this.currentPrompt.id,
			title: snapshot.title,
			content: snapshot.content,
			targetAgent: snapshot.targetAgent,
			kind: snapshot.kind,
			status: snapshot.status,
			rowVersion: this.currentPrompt.rowVersion,
			mentions: extractHorusFileMentions(snapshot.content)
		});

		this.currentPrompt = updated;
		this.savedSnapshot = this.toSnapshot(updated);
		this.currentInput?.setName(updated.title);
		this.setMetadata(this.elements.metadata, updated);
		this.dirty = false;
		this.updateDirtyState();
		this.scheduleMentionValidation();
		this.notificationService.info(localize('horusPromptEditorSavedNotification', "Horus prompt saved: {0}", updated.title));
	}

	private readSnapshot(): HorusPromptEditorSnapshot {
		if (!this.elements) {
			throw new Error('Horus prompt editor is not rendered.');
		}

		return {
			title: this.elements.title.value,
			targetAgent: Number(this.elements.targetAgent.value) as HorusTargetAgent,
			kind: Number(this.elements.kind.value) as HorusPromptKind,
			status: Number(this.elements.status.value) as HorusPromptStatus,
			content: this.elements.content.value
		};
	}

	private toSnapshot(prompt: HorusPrompt): HorusPromptEditorSnapshot {
		return {
			title: prompt.title,
			targetAgent: prompt.targetAgent,
			kind: prompt.kind,
			status: prompt.status,
			content: prompt.content
		};
	}

	private snapshotsEqual(left: HorusPromptEditorSnapshot, right: HorusPromptEditorSnapshot): boolean {
		return left.title === right.title
			&& left.targetAgent === right.targetAgent
			&& left.kind === right.kind
			&& left.status === right.status
			&& left.content === right.content;
	}

	private setMetadata(metadata: HTMLElement, prompt: HorusPrompt): void {
		metadata.textContent = localize('horusPromptEditorMetadata', "Version {0} - Row {1} - Updated {2}", prompt.currentVersion, prompt.rowVersion, new Date(prompt.updatedAtUtc).toLocaleString());
	}

	private showStatus(message: string, isError: boolean): void {
		if (!this.elements) {
			return;
		}

		this.elements.statusMessage.textContent = message;
		this.elements.statusMessage.classList.toggle('error', isError);
	}
}
