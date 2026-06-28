import { Event } from '../../../base/common/event.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { HorusDataChangeEvent, IHorusStorageService } from '../common/horusStorage.js';
import { HorusCreatePromptData, HorusCreateWorkspaceData, HorusFileMentionValidationRequest, HorusFileMentionValidationResult, HorusNativeWorkspaceFolder, HorusPrompt, HorusPromptQuery, HorusStorageHealth, HorusWorkspace } from '../common/horusTypes.js';

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

	createPrompt(data: HorusCreatePromptData): Promise<HorusPrompt> {
		return this.channel.call('createPrompt', data);
	}

	validateFileMentions(request: HorusFileMentionValidationRequest): Promise<readonly HorusFileMentionValidationResult[]> {
		return this.channel.call('validateFileMentions', request);
	}
}
