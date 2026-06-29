import { Codicon } from '../../../../../base/common/codicons.js';
import { Schemas } from '../../../../../base/common/network.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';

const horusLinkedPlanEditorIcon = registerIcon('horus-linked-plan-editor-label-icon', Codicon.markdown, localize('horusLinkedPlanEditorLabelIcon', 'Icon of the Horus linked plan editor label.'));

export class HorusLinkedPlanEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.horusLinkedPlan';
	static readonly EDITOR_ID = 'workbench.editor.horusLinkedPlan';

	private readonly linkedPlanResource: URI;
	private linkedPlanName: string;

	override get capabilities(): EditorInputCapabilities {
		return super.capabilities;
	}

	constructor(
		readonly linkedDocumentId: string,
		name?: string
	) {
		super();

		this.linkedPlanName = name || localize('horusLinkedPlanEditorInputName', "Horus Linked Plan");
		this.linkedPlanResource = URI.from({
			scheme: Schemas.vscode,
			authority: 'horus-linked-plan',
			path: `/${encodeURIComponent(linkedDocumentId)}`
		});
	}

	get typeId(): string {
		return HorusLinkedPlanEditorInput.ID;
	}

	get resource(): URI {
		return this.linkedPlanResource;
	}

	override getName(): string {
		return this.linkedPlanName;
	}

	override getIcon(): ThemeIcon {
		return horusLinkedPlanEditorIcon;
	}

	setName(name: string): void {
		if (this.linkedPlanName === name) {
			return;
		}

		this.linkedPlanName = name;
		this._onDidChangeLabel.fire();
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput instanceof HorusLinkedPlanEditorInput && otherInput.linkedDocumentId === this.linkedDocumentId;
	}
}
