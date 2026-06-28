import { HorusCreatePromptData, HorusCreateWorkspaceData, HorusLinkedDocument, HorusLinkedDocumentQuery, HorusLinkedDocumentStatus, HorusLinkedDocumentVersion, HorusLinkedDocumentVersionSource, HorusPrompt, HorusPromptQuery, HorusPromptVersion, HorusResolvedPromptFileReferenceData, HorusUpdatePromptData, HorusWorkspace } from './horusTypes.js';

export interface IHorusWorkspaceRepository {
	list(): Promise<readonly HorusWorkspace[]>;
	get(id: string): Promise<HorusWorkspace | undefined>;
	getByAbsolutePath(absolutePath: string): Promise<HorusWorkspace | undefined>;
	create(data: HorusCreateWorkspaceData): Promise<HorusWorkspace>;
	getOrCreate(data: HorusCreateWorkspaceData): Promise<HorusWorkspace>;
}

export interface IHorusPromptRepository {
	list(query?: HorusPromptQuery): Promise<readonly HorusPrompt[]>;
	get(id: string): Promise<HorusPrompt | undefined>;
	listVersions(promptId: string): Promise<readonly HorusPromptVersion[]>;
	getVersion(promptId: string, versionNumber: number): Promise<HorusPromptVersion | undefined>;
	create(data: HorusCreatePromptData): Promise<HorusPrompt>;
	update(data: HorusUpdatePromptData, fileReferences: readonly HorusResolvedPromptFileReferenceData[]): Promise<HorusPrompt>;
}

export interface HorusPersistLinkedDocumentData {
	readonly promptId: string;
	readonly workingDirectoryId: string | null;
	readonly absolutePath: string;
	readonly absolutePathKey: string;
	readonly documentType: number;
	readonly displayName: string | null;
	readonly pullRequestReference: string | null;
	readonly content: string;
	readonly contentHash: string;
	readonly sizeBytes: number;
}

export interface HorusPersistLinkedDocumentSyncData {
	readonly content: string;
	readonly contentHash: string;
	readonly sizeBytes: number;
	readonly source: HorusLinkedDocumentVersionSource;
}

export interface HorusLinkedDocumentPersistResult {
	readonly document: HorusLinkedDocument;
	readonly versionCreated: boolean;
}

export interface IHorusLinkedDocumentRepository {
	list(query?: HorusLinkedDocumentQuery): Promise<readonly HorusLinkedDocument[]>;
	get(id: string): Promise<HorusLinkedDocument | undefined>;
	getByPrompt(promptId: string): Promise<HorusLinkedDocument | undefined>;
	listVersions(linkedDocumentId: string): Promise<readonly HorusLinkedDocumentVersion[]>;
	getVersion(linkedDocumentId: string, versionNumber: number): Promise<HorusLinkedDocumentVersion | undefined>;
	link(data: HorusPersistLinkedDocumentData): Promise<HorusLinkedDocumentPersistResult>;
	syncContent(id: string, data: HorusPersistLinkedDocumentSyncData): Promise<HorusLinkedDocumentPersistResult>;
	updateStatus(id: string, status: HorusLinkedDocumentStatus, lastError?: string | null): Promise<HorusLinkedDocument>;
}
