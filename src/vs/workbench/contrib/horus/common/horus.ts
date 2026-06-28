import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

export const HORUS_VIEW_CONTAINER_ID = 'workbench.view.horus';
export const HORUS_WORKSPACES_VIEW_ID = 'workbench.horus.workspaces';
export const HORUS_PROMPTS_VIEW_ID = 'workbench.horus.prompts';
export const HORUS_PROMPT_DETAIL_VIEW_ID = 'workbench.horus.promptDetail';

export const enum HorusCommandId {
	CreateWorkspace = 'horus.createWorkspace',
	CreatePrompt = 'horus.createPrompt',
	OpenPrompt = 'horus.openPrompt',
	Refresh = 'horus.refresh'
}

export const HorusContext = {
	HasNativeWorkspace: new RawContextKey<boolean>('horus.hasNativeWorkspace', false, localize('horusHasNativeWorkspaceContext', "Whether Horus has at least one VS Code workspace folder open.")),
	WorkspaceSelected: new RawContextKey<boolean>('horus.workspaceSelected', false, localize('horusWorkspaceSelectedContext', "Whether a Horus workspace metadata record is selected.")),
	PromptSelected: new RawContextKey<boolean>('horus.promptSelected', false, localize('horusPromptSelectedContext', "Whether a Horus prompt is selected."))
};
