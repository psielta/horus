import { Event } from '../../../base/common/event.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { HorusDataChangeEvent, IHorusStorageService } from './horusStorage.js';
import { HorusCreatePromptData, HorusCreateWorkspaceData, HorusFileMentionValidationRequest, HorusFileMentionValidationResult, HorusNativeWorkspaceFolder, HorusPrompt, HorusPromptQuery, HorusStorageHealth, HorusUpdatePromptData, HorusWorkspace } from './horusTypes.js';

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
			case 'createPrompt':
				return this.service.createPrompt(arg as HorusCreatePromptData) as Promise<T>;
			case 'updatePrompt':
				return this.service.updatePrompt(arg as HorusUpdatePromptData) as Promise<T>;
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
	createPrompt(data: HorusCreatePromptData): Promise<HorusPrompt>;
	updatePrompt(data: HorusUpdatePromptData): Promise<HorusPrompt>;
	validateFileMentions(request: HorusFileMentionValidationRequest): Promise<readonly HorusFileMentionValidationResult[]>;
};
