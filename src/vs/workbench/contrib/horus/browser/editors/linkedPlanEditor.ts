import '../views/horusViews.css';
import * as DOM from '../../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Dimension } from '../../../../../base/browser/dom.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IEditorConstructionOptions } from '../../../../../editor/browser/config/editorConfiguration.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IHorusStorageService } from '../../../../../platform/horus/common/horusStorage.js';
import { HorusLinkedDocument, HorusLinkedDocumentStatus, HorusLinkedDocumentVersionSource } from '../../../../../platform/horus/common/horusTypes.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { HorusCommandId } from '../../common/horus.js';
import { HorusLinkedPlanEditorInput } from './linkedPlanEditorInput.js';

interface HorusLinkedPlanEditorElements {
	readonly root: HTMLElement;
	readonly metadata: HTMLElement;
	readonly editorBody: HTMLElement;
	readonly editorContainer: HTMLElement;
	readonly previewContainer: HTMLElement;
	readonly saveButton: HTMLButtonElement;
	readonly viewModeButtons: ReadonlyMap<HorusLinkedPlanEditorViewMode, HTMLButtonElement>;
	readonly statusMessage: HTMLElement;
}

type HorusLinkedPlanEditorViewMode = 'editor' | 'preview' | 'split';

export class HorusLinkedPlanEditor extends EditorPane {

	static readonly ID = HorusLinkedPlanEditorInput.EDITOR_ID;

	private readonly contentDisposables = this._register(new DisposableStore());
	private readonly previewDisposables = this._register(new DisposableStore());
	private readonly previewRenderScheduler = this._register(new RunOnceScheduler(() => this.renderMarkdownPreview(), 150));

	private container: HTMLElement | undefined;
	private elements: HorusLinkedPlanEditorElements | undefined;
	private codeEditor: CodeEditorWidget | undefined;
	private planModel: ITextModel | undefined;
	private lastDimension: Dimension | undefined;
	private currentInput: HorusLinkedPlanEditorInput | undefined;
	private currentDocument: HorusLinkedDocument | undefined;
	private savedContent: string | undefined;
	private viewMode: HorusLinkedPlanEditorViewMode = 'split';
	private dirty = false;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IMarkdownRendererService private readonly markdownRendererService: IMarkdownRendererService,
		@IFileService private readonly fileService: IFileService,
		@IHorusStorageService private readonly horusStorageService: IHorusStorageService,
		@ICommandService private readonly commandService: ICommandService,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super(HorusLinkedPlanEditor.ID, group, telemetryService, themeService, storageService);
		this._register(this.horusStorageService.onDidChangeData(event => {
			if (this.currentDocument && (event.kind === 'linkedDocument' || event.kind === 'storage')) {
				this.refreshDocumentMetadata().catch(error => this.showStatus(String(error), true));
			}
		}));
	}

	protected override createEditor(parent: HTMLElement): void {
		this.container = DOM.append(parent, DOM.$('.horus-prompt-editor'));
	}

	override async setInput(input: HorusLinkedPlanEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this.currentInput = input;
		await this.loadDocument(input.linkedDocumentId, token);
	}

	override clearInput(): void {
		this.clearEditorContent();
		this.elements = undefined;
		this.currentInput = undefined;
		this.currentDocument = undefined;
		this.savedContent = undefined;
		this.dirty = false;

		if (this.container) {
			DOM.clearNode(this.container);
		}

		super.clearInput();
	}

	override layout(dimension: Dimension): void {
		this.lastDimension = dimension;
		this.codeEditor?.layout();
	}

	private clearEditorContent(): void {
		this.previewRenderScheduler.cancel();
		this.previewDisposables.clear();
		this.codeEditor?.setModel(null);
		this.codeEditor = undefined;
		this.planModel = undefined;
		this.contentDisposables.clear();
	}

	private async loadDocument(linkedDocumentId: string, token: CancellationToken): Promise<void> {
		if (!this.container) {
			return;
		}

		this.clearEditorContent();
		DOM.clearNode(this.container);
		this.container.appendChild(DOM.$('.horus-editor-loading', undefined, localize('horusLinkedPlanEditorLoading', "Loading Horus linked plan...")));

		const document = await this.getLinkedDocument(linkedDocumentId);
		if (token.isCancellationRequested) {
			return;
		}

		if (!document) {
			DOM.clearNode(this.container);
			this.container.appendChild(DOM.$('.horus-editor-empty', undefined, localize('horusLinkedPlanEditorMissing', "The linked plan no longer exists.")));
			return;
		}

		const content = await this.readDocumentContent(document);
		if (token.isCancellationRequested) {
			return;
		}

		this.currentDocument = document;
		this.savedContent = content;
		this.dirty = false;
		this.currentInput?.setName(document.displayName ?? document.absolutePath);
		this.render(document, content);
	}

	private render(document: HorusLinkedDocument, content: string): void {
		if (!this.container) {
			return;
		}

		DOM.clearNode(this.container);

		const root = DOM.append(this.container, DOM.$('.horus-editor-root'));
		const header = DOM.append(root, DOM.$('.horus-editor-header'));
		const title = DOM.append(header, DOM.$('.horus-editor-title')) as HTMLInputElement;
		title.type = 'text';
		title.value = document.displayName ?? document.absolutePath;
		title.readOnly = true;
		title.title = document.absolutePath;

		const metadata = DOM.append(header, DOM.$('.horus-editor-metadata'));
		this.setMetadata(metadata, document);

		const toolbar = DOM.append(root, DOM.$('.horus-editor-toolbar'));
		const statusMessage = DOM.append(toolbar, DOM.$('.horus-editor-status'));
		const viewModeButtons = this.renderViewModeButtons(toolbar);
		const openNativeButton = DOM.append(toolbar, DOM.$('button.horus-button.horus-editor-toolbar-button')) as HTMLButtonElement;
		openNativeButton.textContent = localize('horusLinkedPlanOpenNative', "Open Native File");
		const syncButton = DOM.append(toolbar, DOM.$('button.horus-button.horus-editor-toolbar-button')) as HTMLButtonElement;
		syncButton.textContent = localize('horusLinkedPlanSync', "Sync Plan");
		const compareButton = DOM.append(toolbar, DOM.$('button.horus-button.horus-editor-toolbar-button')) as HTMLButtonElement;
		compareButton.textContent = localize('horusLinkedPlanCompare', "Compare Plan");
		const saveButton = DOM.append(toolbar, DOM.$('button.horus-button.horus-editor-save')) as HTMLButtonElement;
		saveButton.textContent = localize('horusLinkedPlanSave', "Save Plan");

		const editorBody = DOM.append(root, DOM.$('.horus-editor-body'));
		const editorContainer = DOM.append(editorBody, DOM.$('.horus-editor-content'));
		editorContainer.setAttribute('aria-label', localize('horusLinkedPlanEditorContentAriaLabel', "Linked plan Markdown editor."));
		this.createMarkdownEditor(editorContainer, content);
		const previewContainer = DOM.append(editorBody, DOM.$('.horus-editor-preview'));
		previewContainer.setAttribute('aria-label', localize('horusLinkedPlanEditorPreviewAriaLabel', "Rendered linked plan Markdown preview."));

		this.elements = { root, metadata, editorBody, editorContainer, previewContainer, saveButton, viewModeButtons, statusMessage };

		this.contentDisposables.add(DOM.addDisposableListener(saveButton, DOM.EventType.CLICK, () => this.save().catch(error => this.notificationService.error(error))));
		this.contentDisposables.add(DOM.addDisposableListener(openNativeButton, DOM.EventType.CLICK, () => this.openNativeFile().catch(error => this.notificationService.error(error))));
		this.contentDisposables.add(DOM.addDisposableListener(syncButton, DOM.EventType.CLICK, () => this.syncFromDisk().catch(error => this.notificationService.error(error))));
		this.contentDisposables.add(DOM.addDisposableListener(compareButton, DOM.EventType.CLICK, () => this.commandService.executeCommand(HorusCommandId.OpenLinkedPlanDiff, document.id)));

		this.applyViewMode();
		this.schedulePreviewRender();
		this.updateDirtyState();
	}

	private createMarkdownEditor(container: HTMLElement, content: string): void {
		const options: IEditorConstructionOptions = {
			ariaLabel: localize('horusLinkedPlanEditorAriaLabel', "Horus linked plan Markdown editor"),
			automaticLayout: false,
			scrollBeyondLastLine: false,
			wordWrap: 'on',
			lineNumbers: 'on',
			lineNumbersMinChars: 2,
			glyphMargin: false,
			folding: true,
			minimap: { enabled: false },
			overviewRulerLanes: 0,
			renderWhitespace: 'selection',
			scrollbar: {
				verticalScrollbarSize: 14,
				horizontal: 'auto',
				useShadows: true,
				verticalHasArrows: false,
				horizontalHasArrows: false,
				alwaysConsumeMouseWheel: false
			}
		};

		const resource = this.currentInput?.resource;
		let createdModel = false;
		let model = resource ? this.modelService.getModel(resource) : null;
		if (model) {
			this.modelService.updateModel(model, content);
		} else {
			model = resource
				? this.modelService.createModel(content, this.languageService.createById('markdown'), resource)
				: this.modelService.createModel(content, this.languageService.createById('markdown'));
			createdModel = true;
		}

		this.planModel = model;

		const codeEditor = this.instantiationService.createInstance(CodeEditorWidget, container, options, {
			telemetryData: { source: 'horusLinkedPlanEditor' }
		});
		codeEditor.setModel(model);
		this.codeEditor = codeEditor;
		this.contentDisposables.add(codeEditor);
		if (createdModel) {
			this.contentDisposables.add(model);
		}
		this.contentDisposables.add(codeEditor.onDidChangeModelContent(() => this.onEditorChanged()));
		this.lastDimension ? this.layout(this.lastDimension) : codeEditor.layout();
	}

	private renderViewModeButtons(parent: HTMLElement): ReadonlyMap<HorusLinkedPlanEditorViewMode, HTMLButtonElement> {
		const group = DOM.append(parent, DOM.$('.horus-editor-view-modes'));
		const buttons = new Map<HorusLinkedPlanEditorViewMode, HTMLButtonElement>();
		for (const option of [
			{ mode: 'editor' as const, label: localize('horusLinkedPlanEditorModeEditor', "Editor") },
			{ mode: 'split' as const, label: localize('horusLinkedPlanEditorModeSplit', "Split") },
			{ mode: 'preview' as const, label: localize('horusLinkedPlanEditorModePreview', "Preview") }
		]) {
			const button = DOM.append(group, DOM.$('button.horus-editor-view-mode')) as HTMLButtonElement;
			button.type = 'button';
			button.textContent = option.label;
			button.setAttribute('aria-pressed', String(this.viewMode === option.mode));
			this.contentDisposables.add(DOM.addDisposableListener(button, DOM.EventType.CLICK, () => this.setViewMode(option.mode)));
			buttons.set(option.mode, button);
		}

		return buttons;
	}

	private setViewMode(viewMode: HorusLinkedPlanEditorViewMode): void {
		if (this.viewMode === viewMode) {
			return;
		}

		this.viewMode = viewMode;
		this.applyViewMode();
		this.schedulePreviewRender();
	}

	private applyViewMode(): void {
		if (!this.elements) {
			return;
		}

		this.elements.editorBody.classList.toggle('preview-only', this.viewMode === 'preview');
		this.elements.editorBody.classList.toggle('editor-only', this.viewMode === 'editor');
		this.elements.editorBody.classList.toggle('split', this.viewMode === 'split');
		this.elements.editorContainer.hidden = this.viewMode === 'preview';
		this.elements.previewContainer.hidden = this.viewMode === 'editor';
		for (const [mode, button] of this.elements.viewModeButtons) {
			const isActive = mode === this.viewMode;
			button.classList.toggle('active', isActive);
			button.setAttribute('aria-pressed', String(isActive));
		}

		this.codeEditor?.layout();
	}

	private schedulePreviewRender(): void {
		if (this.viewMode === 'editor') {
			return;
		}

		this.previewRenderScheduler.schedule();
	}

	private renderMarkdownPreview(): void {
		if (!this.elements || this.viewMode === 'editor') {
			return;
		}

		this.previewDisposables.clear();
		const markdown = new MarkdownString(this.getEditorContent(), {
			isTrusted: false,
			supportThemeIcons: true
		});
		const rendered = this.markdownRendererService.render(markdown, {
			markedOptions: {
				gfm: true
			},
			asyncRenderCallback: () => undefined
		}, this.elements.previewContainer);
		this.previewDisposables.add(rendered);
	}

	private onEditorChanged(): void {
		this.updateDirtyState();
		this.schedulePreviewRender();
	}

	private updateDirtyState(): void {
		if (!this.elements || this.savedContent === undefined) {
			return;
		}

		this.dirty = this.savedContent !== this.getEditorContent();
		this.elements.saveButton.disabled = !this.dirty;
		this.showStatus(this.dirty ? localize('horusLinkedPlanEditorUnsaved', "Unsaved changes.") : localize('horusLinkedPlanEditorSaved', "Saved."), false);
	}

	private async save(): Promise<void> {
		if (!this.elements || !this.currentDocument) {
			return;
		}

		const content = this.getEditorContent();
		this.elements.saveButton.disabled = true;
		this.showStatus(localize('horusLinkedPlanEditorSaving', "Saving..."), false);

		await this.fileService.writeFile(URI.file(this.currentDocument.absolutePath), VSBuffer.fromString(content));
		const result = await this.horusStorageService.syncLinkedDocument(this.currentDocument.id, HorusLinkedDocumentVersionSource.ManualRefresh);

		this.currentDocument = result.document;
		this.savedContent = content;
		this.currentInput?.setName(result.document.displayName ?? result.document.absolutePath);
		this.setMetadata(this.elements.metadata, result.document);
		this.dirty = false;
		this.updateDirtyState();
		this.notificationService.info(result.versionCreated
			? localize('horusLinkedPlanEditorSavedNewVersion', "Linked plan saved: version {0}", result.document.currentVersion)
			: localize('horusLinkedPlanEditorSavedNoVersion', "Linked plan saved."));
	}

	private async syncFromDisk(): Promise<void> {
		if (!this.currentDocument) {
			return;
		}

		if (this.dirty) {
			this.showStatus(localize('horusLinkedPlanEditorSyncBlockedDirty', "Save or discard current changes before syncing from disk."), true);
			return;
		}

		const result = await this.horusStorageService.syncLinkedDocument(this.currentDocument.id, HorusLinkedDocumentVersionSource.ManualRefresh);
		const content = await this.readDocumentContent(result.document);

		this.currentDocument = result.document;
		this.savedContent = content;
		if (this.planModel) {
			this.modelService.updateModel(this.planModel, content);
		}
		if (this.elements) {
			this.setMetadata(this.elements.metadata, result.document);
		}
		this.updateDirtyState();
		this.schedulePreviewRender();
		this.notificationService.info(result.versionCreated
			? localize('horusLinkedPlanEditorSyncedNewVersion', "Linked plan synced: version {0}", result.document.currentVersion)
			: localize('horusLinkedPlanEditorSyncedNoChange', "Linked plan synced: no content changes."));
	}

	private async openNativeFile(): Promise<void> {
		if (this.currentDocument) {
			await this.editorService.openEditor({ resource: URI.file(this.currentDocument.absolutePath), options: { pinned: true } });
		}
	}

	private async refreshDocumentMetadata(): Promise<void> {
		if (!this.currentDocument) {
			return;
		}

		const document = await this.getLinkedDocument(this.currentDocument.id);
		if (!document) {
			return;
		}

		this.currentDocument = document;
		this.currentInput?.setName(document.displayName ?? document.absolutePath);
		if (this.elements) {
			this.setMetadata(this.elements.metadata, document);
		}
	}

	private async getLinkedDocument(linkedDocumentId: string): Promise<HorusLinkedDocument | undefined> {
		return (await this.horusStorageService.listLinkedDocuments()).find(candidate => candidate.id === linkedDocumentId);
	}

	private async readDocumentContent(document: HorusLinkedDocument): Promise<string> {
		const file = await this.fileService.readFile(URI.file(document.absolutePath));
		return file.value.toString();
	}

	private getEditorContent(): string {
		return this.planModel?.getValue() ?? this.codeEditor?.getValue() ?? '';
	}

	private setMetadata(metadata: HTMLElement, document: HorusLinkedDocument): void {
		metadata.textContent = localize('horusLinkedPlanEditorMetadata', "Version {0} - {1} - Last sync {2}",
			document.currentVersion,
			this.getLinkedPlanStatusLabel(document.status),
			document.lastSyncedAtUtc ? new Date(document.lastSyncedAtUtc).toLocaleString() : localize('horusLinkedPlanEditorNeverSynced', "never"));
	}

	private getLinkedPlanStatusLabel(status: HorusLinkedDocumentStatus): string {
		switch (status) {
			case HorusLinkedDocumentStatus.Watching:
				return localize('horusLinkedPlanEditorWatching', "watching");
			case HorusLinkedDocumentStatus.Paused:
				return localize('horusLinkedPlanEditorPaused', "paused");
			case HorusLinkedDocumentStatus.Error:
				return localize('horusLinkedPlanEditorError', "error");
			case HorusLinkedDocumentStatus.Draft:
				return localize('horusLinkedPlanEditorDraft', "draft");
		}
	}

	private showStatus(message: string, isError: boolean): void {
		if (!this.elements) {
			return;
		}

		this.elements.statusMessage.textContent = message;
		this.elements.statusMessage.classList.toggle('error', isError);
	}
}
