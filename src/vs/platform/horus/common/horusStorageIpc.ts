import { Event } from '../../../base/common/event.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { HorusDataChangeEvent, IHorusStorageService } from './horusStorage.js';
import { HorusCreateLinkedDocumentData, HorusCreatePromptData, HorusCreateWorkspaceData, HorusFileMentionValidationRequest, HorusFileMentionValidationResult, HorusLinkedDocument, HorusLinkedDocumentQuery, HorusLinkedDocumentSyncResult, HorusLinkedDocumentVersion, HorusLinkedDocumentVersionSource, HorusNativeWorkspaceFolder, HorusPrompt, HorusPromptQuery, HorusPromptVersion, HorusStorageHealth, HorusUpdateLinkedDocumentStatusData, HorusUpdatePromptData, HorusWorkspace } from './horusTypes.js';

export class HorusStorageChannel implements IServerChannel {

	constructor(private readonly service: IHorusStorageService) { }

	listen<T>(_ctx: string, event: string): Event<T> {
		switch (event) {
			case 'onDidChangeData':
				return this.service.onDidChangeData as Event<T>;
		}

		throw new Error(`Unknown Horus storage event: ${event}`);
	}

	call<T>(_ctx: string, command: string, arg?: unknown, _cancellationToken?: CancellationToken): Promise<T> {
		switch (command) {
			case 'getHealth':
				return this.service.getHealth() as Promise<T>;
			case 'listWorkspaces':
				return this.service.listWorkspaces() as Promise<T>;
			case 'createWorkspace':
				return this.service.createWorkspace(arg as HorusCreateWorkspaceData) as Promise<T>;
			case 'resolveNativeWorkspaces':
				return this.service.resolveNativeWorkspaces(arg as readonly HorusNativeWorkspaceFolder[]) as Promise<T>;
			case 'listPrompts':
				return this.service.listPrompts(arg as HorusPromptQuery | undefined) as Promise<T>;
			case 'getPrompt':
				return this.service.getPrompt(arg as string) as Promise<T>;
			case 'listPromptVersions':
				return this.service.listPromptVersions(arg as string) as Promise<T>;
			case 'getPromptVersion': {
				const data = arg as { readonly promptId: string; readonly versionNumber: number };
				return this.service.getPromptVersion(data.promptId, data.versionNumber) as Promise<T>;
			}
			case 'createPrompt':
				return this.service.createPrompt(arg as HorusCreatePromptData) as Promise<T>;
			case 'updatePrompt':
				return this.service.updatePrompt(arg as HorusUpdatePromptData) as Promise<T>;
			case 'listLinkedDocuments':
				return this.service.listLinkedDocuments(arg as HorusLinkedDocumentQuery | undefined) as Promise<T>;
			case 'getLinkedDocumentForPrompt':
				return this.service.getLinkedDocumentForPrompt(arg as string) as Promise<T>;
			case 'listLinkedDocumentVersions':
				return this.service.listLinkedDocumentVersions(arg as string) as Promise<T>;
			case 'getLinkedDocumentVersion': {
				const data = arg as { readonly linkedDocumentId: string; readonly versionNumber: number };
				return this.service.getLinkedDocumentVersion(data.linkedDocumentId, data.versionNumber) as Promise<T>;
			}
			case 'linkPlanToPrompt':
				return this.service.linkPlanToPrompt(arg as HorusCreateLinkedDocumentData) as Promise<T>;
			case 'syncLinkedDocument':
				if (typeof arg === 'string') {
					return this.service.syncLinkedDocument(arg) as Promise<T>;
				}
				return this.service.syncLinkedDocument((arg as { readonly linkedDocumentId: string; readonly source?: HorusLinkedDocumentVersionSource }).linkedDocumentId, (arg as { readonly linkedDocumentId: string; readonly source?: HorusLinkedDocumentVersionSource }).source) as Promise<T>;
			case 'updateLinkedDocumentStatus':
				return this.service.updateLinkedDocumentStatus(arg as HorusUpdateLinkedDocumentStatusData) as Promise<T>;
			case 'validateFileMentions':
				return this.service.validateFileMentions(arg as HorusFileMentionValidationRequest) as Promise<T>;
		}

		throw new Error(`Unknown Horus storage command: ${command}`);
	}
}

export type HorusStorageChannelShape = {
	onDidChangeData: Event<HorusDataChangeEvent>;
	getHealth(): Promise<HorusStorageHealth>;
	listWorkspaces(): Promise<readonly HorusWorkspace[]>;
	createWorkspace(data: HorusCreateWorkspaceData): Promise<HorusWorkspace>;
	resolveNativeWorkspaces(folders: readonly HorusNativeWorkspaceFolder[]): Promise<readonly HorusWorkspace[]>;
	listPrompts(query?: HorusPromptQuery): Promise<readonly HorusPrompt[]>;
	getPrompt(id: string): Promise<HorusPrompt | undefined>;
	listPromptVersions(promptId: string): Promise<readonly HorusPromptVersion[]>;
	getPromptVersion(promptId: string, versionNumber: number): Promise<HorusPromptVersion | undefined>;
	createPrompt(data: HorusCreatePromptData): Promise<HorusPrompt>;
	updatePrompt(data: HorusUpdatePromptData): Promise<HorusPrompt>;
	listLinkedDocuments(query?: HorusLinkedDocumentQuery): Promise<readonly HorusLinkedDocument[]>;
	getLinkedDocumentForPrompt(promptId: string): Promise<HorusLinkedDocument | undefined>;
	listLinkedDocumentVersions(linkedDocumentId: string): Promise<readonly HorusLinkedDocumentVersion[]>;
	getLinkedDocumentVersion(linkedDocumentId: string, versionNumber: number): Promise<HorusLinkedDocumentVersion | undefined>;
	linkPlanToPrompt(data: HorusCreateLinkedDocumentData): Promise<HorusLinkedDocumentSyncResult>;
	syncLinkedDocument(linkedDocumentId: string, source?: HorusLinkedDocumentVersionSource): Promise<HorusLinkedDocumentSyncResult>;
	updateLinkedDocumentStatus(data: HorusUpdateLinkedDocumentStatusData): Promise<HorusLinkedDocument>;
	validateFileMentions(request: HorusFileMentionValidationRequest): Promise<readonly HorusFileMentionValidationResult[]>;
};
