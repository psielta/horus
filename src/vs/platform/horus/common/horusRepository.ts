import { HorusCreatePromptData, HorusCreateWorkspaceData, HorusPrompt, HorusPromptQuery, HorusResolvedPromptFileReferenceData, HorusUpdatePromptData, HorusWorkspace } from './horusTypes.js';

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
	create(data: HorusCreatePromptData): Promise<HorusPrompt>;
	update(data: HorusUpdatePromptData, fileReferences: readonly HorusResolvedPromptFileReferenceData[]): Promise<HorusPrompt>;
}
