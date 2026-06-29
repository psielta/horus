import { Event } from '../../../base/common/event.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { HorusDataChangeEvent, IHorusStorageService } from '../common/horusStorage.js';
import { HorusAdvanceWorkflowData, HorusAdvanceWorkflowToRoleData, HorusChangeWorkflowActorData, HorusCompleteWorkflowData, HorusCreateLinkedDocumentData, HorusCreatePromptData, HorusCreateWorkspaceData, HorusFileMentionValidationRequest, HorusFileMentionValidationResult, HorusLinkedDocument, HorusLinkedDocumentQuery, HorusLinkedDocumentSyncResult, HorusLinkedDocumentVersion, HorusLinkedDocumentVersionSource, HorusNativeWorkspaceFolder, HorusPrompt, HorusPromptQuery, HorusPromptVersion, HorusReopenWorkflowData, HorusReorderBoardColumnData, HorusReviewVerdictData, HorusSetWorkflowPhaseData, HorusStartWorkflowData, HorusStorageHealth, HorusTaskSummary, HorusUpdateLinkedDocumentStatusData, HorusUpdatePromptData, HorusUpdateTaskPhasesData, HorusUpdateWorkflowTemplateData, HorusWorkflowBoardQuery, HorusWorkflowDto, HorusWorkflowNoteData, HorusWorkflowTemplateDto, HorusWorkspace } from '../common/horusTypes.js';

export class HorusStorageChannelClient implements IHorusStorageService {

	declare readonly _serviceBrand: undefined;

	readonly onDidChangeData: Event<HorusDataChangeEvent>;

	constructor(private readonly channel: IChannel) {
		this.onDidChangeData = this.channel.listen<HorusDataChangeEvent>('onDidChangeData');
	}

	getHealth(): Promise<HorusStorageHealth> {
		return this.channel.call('getHealth');
	}

	listWorkspaces(): Promise<readonly HorusWorkspace[]> {
		return this.channel.call('listWorkspaces');
	}

	createWorkspace(data: HorusCreateWorkspaceData): Promise<HorusWorkspace> {
		return this.channel.call('createWorkspace', data);
	}

	resolveNativeWorkspaces(folders: readonly HorusNativeWorkspaceFolder[]): Promise<readonly HorusWorkspace[]> {
		return this.channel.call('resolveNativeWorkspaces', folders);
	}

	listPrompts(query?: HorusPromptQuery): Promise<readonly HorusPrompt[]> {
		return this.channel.call('listPrompts', query);
	}

	getPrompt(id: string): Promise<HorusPrompt | undefined> {
		return this.channel.call('getPrompt', id);
	}

	listPromptVersions(promptId: string): Promise<readonly HorusPromptVersion[]> {
		return this.channel.call('listPromptVersions', promptId);
	}

	getPromptVersion(promptId: string, versionNumber: number): Promise<HorusPromptVersion | undefined> {
		return this.channel.call('getPromptVersion', { promptId, versionNumber });
	}

	createPrompt(data: HorusCreatePromptData): Promise<HorusPrompt> {
		return this.channel.call('createPrompt', data);
	}

	updatePrompt(data: HorusUpdatePromptData): Promise<HorusPrompt> {
		return this.channel.call('updatePrompt', data);
	}

	listLinkedDocuments(query?: HorusLinkedDocumentQuery): Promise<readonly HorusLinkedDocument[]> {
		return this.channel.call('listLinkedDocuments', query);
	}

	getLinkedDocumentForPrompt(promptId: string): Promise<HorusLinkedDocument | undefined> {
		return this.channel.call('getLinkedDocumentForPrompt', promptId);
	}

	listLinkedDocumentVersions(linkedDocumentId: string): Promise<readonly HorusLinkedDocumentVersion[]> {
		return this.channel.call('listLinkedDocumentVersions', linkedDocumentId);
	}

	getLinkedDocumentVersion(linkedDocumentId: string, versionNumber: number): Promise<HorusLinkedDocumentVersion | undefined> {
		return this.channel.call('getLinkedDocumentVersion', { linkedDocumentId, versionNumber });
	}

	linkPlanToPrompt(data: HorusCreateLinkedDocumentData): Promise<HorusLinkedDocumentSyncResult> {
		return this.channel.call('linkPlanToPrompt', data);
	}

	syncLinkedDocument(linkedDocumentId: string, source?: HorusLinkedDocumentVersionSource): Promise<HorusLinkedDocumentSyncResult> {
		return this.channel.call('syncLinkedDocument', { linkedDocumentId, source });
	}

	updateLinkedDocumentStatus(data: HorusUpdateLinkedDocumentStatusData): Promise<HorusLinkedDocument> {
		return this.channel.call('updateLinkedDocumentStatus', data);
	}

	getWorkflowTemplate(): Promise<HorusWorkflowTemplateDto> {
		return this.channel.call('getWorkflowTemplate');
	}

	updateWorkflowTemplate(data: HorusUpdateWorkflowTemplateData): Promise<HorusWorkflowTemplateDto> {
		return this.channel.call('updateWorkflowTemplate', data);
	}

	listWorkflowBoard(query?: HorusWorkflowBoardQuery): Promise<readonly HorusTaskSummary[]> {
		return this.channel.call('listWorkflowBoard', query);
	}

	getWorkflow(promptId: string): Promise<HorusWorkflowDto | undefined> {
		return this.channel.call('getWorkflow', promptId);
	}

	startWorkflow(data: HorusStartWorkflowData): Promise<HorusWorkflowDto> {
		return this.channel.call('startWorkflow', data);
	}

	advanceWorkflow(data: HorusAdvanceWorkflowData): Promise<HorusWorkflowDto> {
		return this.channel.call('advanceWorkflow', data);
	}

	setWorkflowPhase(data: HorusSetWorkflowPhaseData): Promise<HorusWorkflowDto> {
		return this.channel.call('setWorkflowPhase', data);
	}

	changeWorkflowActor(data: HorusChangeWorkflowActorData): Promise<HorusWorkflowDto> {
		return this.channel.call('changeWorkflowActor', data);
	}

	addWorkflowNote(data: HorusWorkflowNoteData): Promise<HorusWorkflowDto> {
		return this.channel.call('addWorkflowNote', data);
	}

	addReviewVerdict(data: HorusReviewVerdictData): Promise<HorusWorkflowDto> {
		return this.channel.call('addReviewVerdict', data);
	}

	completeWorkflow(data: HorusCompleteWorkflowData): Promise<HorusWorkflowDto> {
		return this.channel.call('completeWorkflow', data);
	}

	reopenWorkflow(data: HorusReopenWorkflowData): Promise<HorusWorkflowDto> {
		return this.channel.call('reopenWorkflow', data);
	}

	updateTaskPhases(data: HorusUpdateTaskPhasesData): Promise<HorusWorkflowDto> {
		return this.channel.call('updateTaskPhases', data);
	}

	reorderBoardColumn(data: HorusReorderBoardColumnData): Promise<void> {
		return this.channel.call('reorderBoardColumn', data);
	}

	advanceWorkflowToRole(data: HorusAdvanceWorkflowToRoleData): Promise<HorusWorkflowDto | undefined> {
		return this.channel.call('advanceWorkflowToRole', data);
	}

	validateFileMentions(request: HorusFileMentionValidationRequest): Promise<readonly HorusFileMentionValidationResult[]> {
		return this.channel.call('validateFileMentions', request);
	}
}
