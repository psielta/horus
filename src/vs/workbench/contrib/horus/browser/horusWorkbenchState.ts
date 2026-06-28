import { Emitter, Event } from '../../../../base/common/event.js';

class HorusWorkbenchState {
	private readonly onDidChangeSelectedWorkspaceEmitter = new Emitter<string | undefined>();
	readonly onDidChangeSelectedWorkspace: Event<string | undefined> = this.onDidChangeSelectedWorkspaceEmitter.event;

	private readonly onDidChangeSelectedPromptEmitter = new Emitter<string | undefined>();
	readonly onDidChangeSelectedPrompt: Event<string | undefined> = this.onDidChangeSelectedPromptEmitter.event;

	private selectedWorkspaceId: string | undefined;
	private selectedPromptId: string | undefined;

	getSelectedWorkspaceId(): string | undefined {
		return this.selectedWorkspaceId;
	}

	setSelectedWorkspaceId(workspaceId: string | undefined): void {
		if (this.selectedWorkspaceId === workspaceId) {
			return;
		}

		this.selectedWorkspaceId = workspaceId;
		this.setSelectedPromptId(undefined);
		this.onDidChangeSelectedWorkspaceEmitter.fire(workspaceId);
	}

	getSelectedPromptId(): string | undefined {
		return this.selectedPromptId;
	}

	setSelectedPromptId(promptId: string | undefined): void {
		if (this.selectedPromptId === promptId) {
			return;
		}

		this.selectedPromptId = promptId;
		this.onDidChangeSelectedPromptEmitter.fire(promptId);
	}
}

export const horusWorkbenchState = new HorusWorkbenchState();
