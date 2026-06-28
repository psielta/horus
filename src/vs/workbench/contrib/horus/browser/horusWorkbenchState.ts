import { Emitter, Event } from '../../../../base/common/event.js';

class HorusWorkbenchState {
	private readonly onDidChangeSelectedWorkspaceEmitter = new Emitter<string | undefined>();
	readonly onDidChangeSelectedWorkspace: Event<string | undefined> = this.onDidChangeSelectedWorkspaceEmitter.event;

	private selectedWorkspaceId: string | undefined;

	getSelectedWorkspaceId(): string | undefined {
		return this.selectedWorkspaceId;
	}

	setSelectedWorkspaceId(workspaceId: string | undefined): void {
		if (this.selectedWorkspaceId === workspaceId) {
			return;
		}

		this.selectedWorkspaceId = workspaceId;
		this.onDidChangeSelectedWorkspaceEmitter.fire(workspaceId);
	}
}

export const horusWorkbenchState = new HorusWorkbenchState();
