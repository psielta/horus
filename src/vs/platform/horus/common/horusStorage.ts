import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { HorusCreatePromptData, HorusCreateWorkspaceData, HorusFileMentionValidationRequest, HorusFileMentionValidationResult, HorusPrompt, HorusPromptQuery, HorusStorageHealth, HorusWorkspace } from './horusTypes.js';

export const HORUS_STORAGE_CHANNEL = 'horus/storage';

export const IHorusStorageService = createDecorator<IHorusStorageService>('horusStorageService');

export interface HorusDataChangeEvent {
	readonly kind: 'workspace' | 'prompt' | 'storage';
	readonly id?: string;
}

export interface IHorusStorageService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeData: Event<HorusDataChangeEvent>;

	getHealth(): Promise<HorusStorageHealth>;
	listWorkspaces(): Promise<readonly HorusWorkspace[]>;
	createWorkspace(data: HorusCreateWorkspaceData): Promise<HorusWorkspace>;
	listPrompts(query?: HorusPromptQuery): Promise<readonly HorusPrompt[]>;
	createPrompt(data: HorusCreatePromptData): Promise<HorusPrompt>;
	validateFileMentions(request: HorusFileMentionValidationRequest): Promise<readonly HorusFileMentionValidationResult[]>;
}
