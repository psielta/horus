import { Codicon } from '../../../../../base/common/codicons.js';
import { Schemas } from '../../../../../base/common/network.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';

const horusPromptEditorIcon = registerIcon('horus-prompt-editor-label-icon', Codicon.symbolString, localize('horusPromptEditorLabelIcon', 'Icon of the Horus prompt editor label.'));

export class HorusPromptEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.horusPrompt';
	static readonly EDITOR_ID = 'workbench.editor.horusPrompt';

	private readonly promptResource: URI;
	private promptName: string;

	override get capabilities(): EditorInputCapabilities {
		return super.capabilities;
	}

	constructor(
		readonly promptId: string,
		name?: string
	) {
		super();

		this.promptName = name || localize('horusPromptEditorInputName', "Horus Prompt");
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

	setName(name: string): void {
		if (this.promptName === name) {
			return;
		}

		this.promptName = name;
		this._onDidChangeLabel.fire();
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof HorusPromptEditorInput && otherInput.promptId === this.promptId;
	}
}
