import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { HorusCreatePromptData, HorusCreateWorkspaceData, HorusFileMentionValidationRequest, HorusFileMentionValidationResult, HorusNativeWorkspaceFolder, HorusPrompt, HorusPromptQuery, HorusStorageHealth, HorusUpdatePromptData, HorusWorkspace } from './horusTypes.js';

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
	resolveNativeWorkspaces(folders: readonly HorusNativeWorkspaceFolder[]): Promise<readonly HorusWorkspace[]>;
	listPrompts(query?: HorusPromptQuery): Promise<readonly HorusPrompt[]>;
	getPrompt(id: string): Promise<HorusPrompt | undefined>;
	createPrompt(data: HorusCreatePromptData): Promise<HorusPrompt>;
	updatePrompt(data: HorusUpdatePromptData): Promise<HorusPrompt>;
	validateFileMentions(request: HorusFileMentionValidationRequest): Promise<readonly HorusFileMentionValidationResult[]>;
}
