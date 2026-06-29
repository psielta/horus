import { Codicon } from '../../../../../base/common/codicons.js';
import { Schemas } from '../../../../../base/common/network.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { EditorInputCapabilities, GroupIdentifier, ISaveOptions, IUntypedEditorInput } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { HorusPromptKind, HorusPromptStatus, HorusTargetAgent } from '../../../../../platform/horus/common/horusTypes.js';

const horusPromptEditorIcon = registerIcon('horus-prompt-editor-label-icon', Codicon.symbolString, localize('horusPromptEditorLabelIcon', 'Icon of the Horus prompt editor label.'));

export interface HorusPromptEditorDraft {
	readonly title: string;
	readonly targetAgent: HorusTargetAgent;
	readonly kind: HorusPromptKind;
	readonly status: HorusPromptStatus;
	readonly content: string;
}

export class HorusPromptEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.horusPrompt';
	static readonly EDITOR_ID = 'workbench.editor.horusPrompt';
	private static readonly drafts = new Map<string, HorusPromptEditorDraft>();

	private readonly promptResource: URI;
	private promptName: string;
	private dirty = false;
	private draft: HorusPromptEditorDraft | undefined;
	private saveHandler: (() => Promise<boolean>) | undefined;
	private revertHandler: (() => Promise<void>) | undefined;

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.None;
	}

	constructor(
		readonly promptId: string,
		name?: string
	) {
		super();

		this.promptName = name || localize('horusPromptEditorInputName', "Horus Prompt");
		this.draft = HorusPromptEditorInput.drafts.get(promptId);
		if (this.draft) {
			this.promptName = this.draft.title;
			this.dirty = true;
		}
		this.promptResource = URI.from({
			scheme: Schemas.vscode,
			authority: 'horus-prompt',
			path: `/${encodeURIComponent(promptId)}`
		});
	}

	get typeId(): string {
		return HorusPromptEditorInput.ID;
	}

	get resource(): URI {
		return this.promptResource;
	}

	override getName(): string {
		return this.promptName;
	}

	override getIcon(): ThemeIcon {
		return horusPromptEditorIcon;
	}

	override isDirty(): boolean {
		return this.dirty;
	}

	override async save(_group: GroupIdentifier, _options?: ISaveOptions): Promise<EditorInput | undefined> {
		if (!this.saveHandler) {
			return undefined;
		}

		const saved = await this.saveHandler();
		return saved ? this : undefined;
	}

	override async revert(): Promise<void> {
		if (this.revertHandler) {
			await this.revertHandler();
			return;
		}

		this.setDraft(undefined);
	}

	setName(name: string): void {
		if (this.promptName === name) {
			return;
		}

		this.promptName = name;
		this._onDidChangeLabel.fire();
	}

	getDraft(): HorusPromptEditorDraft | undefined {
		return this.draft;
	}

	setDraft(draft: HorusPromptEditorDraft | undefined): void {
		this.draft = draft;
		if (draft) {
			HorusPromptEditorInput.drafts.set(this.promptId, draft);
			this.setName(draft.title);
			this.setDirty(true);
			return;
		}

		HorusPromptEditorInput.drafts.delete(this.promptId);
		this.setDirty(false);
	}

	setSaveHandler(handler: (() => Promise<boolean>) | undefined): void {
		this.saveHandler = handler;
	}

	setRevertHandler(handler: (() => Promise<void>) | undefined): void {
		this.revertHandler = handler;
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof HorusPromptEditorInput && otherInput.promptId === this.promptId;
	}

	private setDirty(dirty: boolean): void {
		if (this.dirty === dirty) {
			return;
		}

		this.dirty = dirty;
		this._onDidChangeDirty.fire();
	}
}
