import { HorusCreatePromptData, HorusCreateWorkspaceData, HorusPrompt, HorusPromptQuery, HorusWorkspace } from './horusTypes.js';

export interface IHorusWorkspaceRepository {
	list(): Promise<readonly HorusWorkspace[]>;
	get(id: string): Promise<HorusWorkspace | undefined>;
	create(data: HorusCreateWorkspaceData): Promise<HorusWorkspace>;
}

export interface IHorusPromptRepository {
	list(query?: HorusPromptQuery): Promise<readonly HorusPrompt[]>;
	get(id: string): Promise<HorusPrompt | undefined>;
	create(data: HorusCreatePromptData): Promise<HorusPrompt>;
}
