/*---------------------------------------------------------------------------------------------
 * Horus: no-op AI extension host bridges.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import {
	ExtHostContext,
	ExtHostLanguageModelsShape,
	MainContext,
	MainThreadBrowserTunnelProxyShape,
	MainThreadBrowsersShape,
	MainThreadCodeMapperShape,
	MainThreadChatAgentsShape2,
	MainThreadChatContextShape,
	MainThreadChatDebugShape,
	MainThreadChatInputNotificationShape,
	MainThreadChatOutputRendererShape,
	MainThreadChatQuotaShape,
	MainThreadChatSessionsShape,
	MainThreadChatStatusShape,
	MainThreadLanguageModelsShape,
	MainThreadLanguageModelToolsShape,
	MainThreadMcpShape,
} from '../common/extHost.protocol.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';

@extHostNamedCustomer(MainContext.MainThreadLanguageModels)
export class MainThreadHorusLanguageModelsNoop implements MainThreadLanguageModelsShape {

	private readonly _proxy: ExtHostLanguageModelsShape;

	constructor(extHostContext: IExtHostContext) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostChatProvider);
	}

	dispose(): void { }

	$registerLanguageModelProvider(_vendor: string): void {
		this._proxy.$onChatModelsChange();
	}

	$onLMProviderChange(_vendor: string): void {
		this._proxy.$onChatModelsChange();
	}

	$unregisterProvider(_vendor: string): void {
		this._proxy.$onChatModelsChange();
	}

	async $tryStartChatRequest(): Promise<void> {
		throw new Error('Horus disables VS Code language model extension bridges.');
	}

	async $reportResponsePart(): Promise<void> { }

	async $reportResponseDone(): Promise<void> { }

	async $selectChatModels(): Promise<string[]> {
		return [];
	}

	async $countTokens(_modelId: string, value: unknown, _token: CancellationToken): Promise<number> {
		return typeof value === 'string' ? value.length : JSON.stringify(value).length;
	}

	$cancelLanguageModelChatRequest(_requestId: number): void { }

	async $fileIsIgnored(): Promise<boolean> {
		return false;
	}

	$registerFileIgnoreProvider(_handle: number): void { }

	$unregisterFileIgnoreProvider(_handle: number): void { }
}

@extHostNamedCustomer(MainContext.MainThreadLanguageModelTools)
export class MainThreadHorusLanguageModelToolsNoop implements MainThreadLanguageModelToolsShape {

	dispose(): void { }

	async $getTools(): Promise<[]> {
		return [];
	}

	$acceptToolProgress(_callId: string): void { }

	async $invokeTool(): Promise<never> {
		throw new Error('Horus disables VS Code language model tool extension bridges.');
	}

	async $countTokensForInvocation(_callId: string, input: string): Promise<number> {
		return input.length;
	}

	$registerTool(_id: string, _hasHandleToolStream: boolean): void { }

	$registerToolWithDefinition(): void { }

	$unregisterTool(_name: string): void { }
}

@extHostNamedCustomer(MainContext.MainThreadChatAgents2)
export class MainThreadHorusChatAgentsNoop implements MainThreadChatAgentsShape2 {

	dispose(): void { }

	$registerAgent(): void { }
	$registerChatParticipantDetectionProvider(): void { }
	$unregisterChatParticipantDetectionProvider(): void { }
	$registerPromptFileProvider(): void { }
	$unregisterPromptFileProvider(): void { }
	$onDidChangePromptFiles(): void { }
	$registerChatSessionCustomizationProvider(): void { }
	$unregisterChatSessionCustomizationProvider(): void { }
	$onDidChangeCustomizations(): void { }
	$registerAgentCompletionsProvider(): void { }
	$unregisterAgentCompletionsProvider(): void { }
	$updateAgent(): void { }
	$unregisterAgent(): void { }
	$handleAnchorResolve(): void { }

	async $handleProgressChunk(): Promise<void> { }
	async $transferActiveChatSession(): Promise<void> { }
	async $provideCustomAgents(): Promise<[]> { return []; }
	async $provideInstructions(): Promise<[]> { return []; }
	async $provideSkills(): Promise<[]> { return []; }
	async $provideSlashCommands(): Promise<[]> { return []; }
	async $provideHooks(): Promise<[]> { return []; }
	async $providePlugins(): Promise<[]> { return []; }
}

@extHostNamedCustomer(MainContext.MainThreadChatSessions)
export class MainThreadHorusChatSessionsNoop implements MainThreadChatSessionsShape {

	dispose(): void { }

	$registerChatSessionItemController(): void { }
	$updateChatSessionItemControllerCapabilities(): void { }
	$unregisterChatSessionItemController(): void { }
	$onDidCommitChatSessionItem(): void { }
	$registerChatSessionContentProvider(): void { }
	$unregisterChatSessionContentProvider(): void { }
	$onDidChangeChatSessionOptions(): void { }
	$onDidChangeChatSessionProviderOptions(): void { }
	$updateChatSessionInputState(): void { }
	$handleAnchorResolve(): void { }
	$handleProgressComplete(): void { }

	async $updateChatSessionItems(): Promise<void> { }
	async $addOrUpdateChatSessionItem(): Promise<void> { }
	async $handleProgressChunk(): Promise<void> { }
}

@extHostNamedCustomer(MainContext.MainThreadChatContext)
export class MainThreadHorusChatContextNoop implements MainThreadChatContextShape {

	dispose(): void { }

	$registerChatWorkspaceContextProvider(): void { }
	$registerChatExplicitContextProvider(): void { }
	$registerChatResourceContextProvider(): void { }
	$unregisterChatContextProvider(): void { }
	$updateWorkspaceContextItems(): void { }
	async $executeChatContextItemCommand(): Promise<void> { }
}

@extHostNamedCustomer(MainContext.MainThreadChatDebug)
export class MainThreadHorusChatDebugNoop implements MainThreadChatDebugShape {

	dispose(): void { }

	$registerChatDebugLogProvider(): void { }
	$unregisterChatDebugLogProvider(): void { }
	$acceptChatDebugEvent(): void { }
	$subscribeToCoreDebugEvents(): void { }
	$unsubscribeFromCoreDebugEvents(): void { }
}

@extHostNamedCustomer(MainContext.MainThreadChatQuota)
export class MainThreadHorusChatQuotaNoop implements MainThreadChatQuotaShape {

	dispose(): void { }

	$updateQuotas(): void { }
}

@extHostNamedCustomer(MainContext.MainThreadChatStatus)
export class MainThreadHorusChatStatusNoop implements MainThreadChatStatusShape {

	dispose(): void { }

	$setEntry(): void { }
	$disposeEntry(): void { }
}

@extHostNamedCustomer(MainContext.MainThreadChatInputNotification)
export class MainThreadHorusChatInputNotificationNoop implements MainThreadChatInputNotificationShape {

	dispose(): void { }

	$setNotification(): void { }
	$disposeNotification(): void { }
}

@extHostNamedCustomer(MainContext.MainThreadChatOutputRenderer)
export class MainThreadHorusChatOutputRendererNoop implements MainThreadChatOutputRendererShape {

	dispose(): void { }

	$registerChatOutputRenderer(): void { }
	$unregisterChatOutputRenderer(): void { }
}

@extHostNamedCustomer(MainContext.MainThreadCodeMapper)
export class MainThreadHorusCodeMapperNoop implements MainThreadCodeMapperShape {

	dispose(): void { }

	$registerCodeMapperProvider(): void { }
	$unregisterCodeMapperProvider(): void { }
	async $handleProgress(): Promise<void> { }
}

@extHostNamedCustomer(MainContext.MainThreadBrowserTunnelProxy)
export class MainThreadHorusBrowserTunnelProxyNoop implements MainThreadBrowserTunnelProxyShape {

	dispose(): void { }

	$updateProxyInfo(): void { }
}

@extHostNamedCustomer(MainContext.MainThreadMcp)
export class MainThreadHorusMcpNoop implements MainThreadMcpShape {

	dispose(): void { }

	$onDidChangeState(): void { }
	$onDidPublishLog(): void { }
	$onDidReceiveMessage(): void { }
	$upsertMcpCollection(): void { }
	$deleteMcpCollection(): void { }
	async $getTokenFromServerMetadata(): Promise<undefined> { return undefined; }
	async $getTokenForProviderId(): Promise<undefined> { return undefined; }
	$logMcpAuthSetup(): void { }
	async $startMcpGateway(): Promise<undefined> { return undefined; }
	$disposeMcpGateway(): void { }
}

@extHostNamedCustomer(MainContext.MainThreadBrowsers)
export class MainThreadHorusBrowsersNoop implements MainThreadBrowsersShape {

	dispose(): void { }

	async $openBrowserTab(): Promise<never> {
		throw new Error('Horus disables VS Code browser view extension bridges.');
	}

	async $closeBrowserTab(): Promise<void> { }
	async $startCDPSession(): Promise<void> { }
	async $closeCDPSession(): Promise<void> { }
	async $sendCDPMessage(): Promise<void> { }
}
