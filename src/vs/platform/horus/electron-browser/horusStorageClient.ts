import { Event } from '../../../base/common/event.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { HorusDataChangeEvent, IHorusStorageService } from '../common/horusStorage.js';
import { HorusCreateLinkedDocumentData, HorusCreatePromptData, HorusCreateWorkspaceData, HorusFileMentionValidationRequest, HorusFileMentionValidationResult, HorusLinkedDocument, HorusLinkedDocumentQuery, HorusLinkedDocumentSyncResult, HorusLinkedDocumentVersion, HorusLinkedDocumentVersionSource, HorusNativeWorkspaceFolder, HorusPrompt, HorusPromptQuery, HorusPromptVersion, HorusStorageHealth, HorusUpdateLinkedDocumentStatusData, HorusUpdatePromptData, HorusWorkspace } from '../common/horusTypes.js';

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

	validateFileMentions(request: HorusFileMentionValidationRequest): Promise<readonly HorusFileMentionValidationResult[]> {
		return this.channel.call('validateFileMentions', request);
	}
}
