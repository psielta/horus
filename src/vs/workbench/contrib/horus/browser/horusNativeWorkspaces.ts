import { basename } from '../../../../base/common/resources.js';
import { IHorusStorageService } from '../../../../platform/horus/common/horusStorage.js';
import { HorusNativeWorkspaceFolder, HorusWorkspace } from '../../../../platform/horus/common/horusTypes.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

export function getNativeWorkspaceFolders(workspaceContextService: IWorkspaceContextService): readonly HorusNativeWorkspaceFolder[] {
	return workspaceContextService.getWorkspace().folders.map(folder => ({
		name: folder.name || basename(folder.uri),
		absolutePath: folder.uri.fsPath
	}));
}

export function getCurrentNativeWorkspaceFolder(workspaceContextService: IWorkspaceContextService): HorusNativeWorkspaceFolder | undefined {
	return getNativeWorkspaceFolders(workspaceContextService)[0];
}

export async function resolveNativeHorusWorkspaces(
	workspaceContextService: IWorkspaceContextService,
	horusStorageService: IHorusStorageService
): Promise<readonly HorusWorkspace[]> {
	const folders = getNativeWorkspaceFolders(workspaceContextService);
	if (!folders.length) {
		return [];
	}

	return horusStorageService.resolveNativeWorkspaces(folders);
}

export async function resolveCurrentHorusWorkspace(
	workspaceContextService: IWorkspaceContextService,
	horusStorageService: IHorusStorageService
): Promise<HorusWorkspace | undefined> {
	const folder = getCurrentNativeWorkspaceFolder(workspaceContextService);
	if (!folder) {
		return undefined;
	}

	return (await horusStorageService.resolveNativeWorkspaces([folder]))[0];
}
