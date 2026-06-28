import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { HorusCreateLinkedDocumentData, HorusCreatePromptData, HorusCreateWorkspaceData, HorusFileMentionValidationRequest, HorusFileMentionValidationResult, HorusLinkedDocument, HorusLinkedDocumentQuery, HorusLinkedDocumentSyncResult, HorusLinkedDocumentVersion, HorusLinkedDocumentVersionSource, HorusNativeWorkspaceFolder, HorusPrompt, HorusPromptQuery, HorusPromptVersion, HorusStorageHealth, HorusUpdateLinkedDocumentStatusData, HorusUpdatePromptData, HorusWorkspace } from './horusTypes.js';

export const HORUS_STORAGE_CHANNEL = 'horus/storage';

export const IHorusStorageService = createDecorator<IHorusStorageService>('horusStorageService');

export interface HorusDataChangeEvent {
	readonly kind: 'workspace' | 'prompt' | 'linkedDocument' | 'storage';
	readonly id?: string;
}

export interface IHorusStorageService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeData: Event<HorusDataChangeEvent>;

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
}
