import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

export const HORUS_PROMPTS_VIEW_ID = 'workbench.horus.prompts';
export const HORUS_PROMPT_DETAIL_VIEW_ID = 'workbench.horus.promptDetail';

export const enum HorusCommandId {
	CreatePrompt = 'horus.createPrompt',
	CreateChildPrompt = 'horus.createChildPrompt',
	OpenPrompt = 'horus.openPrompt',
	LinkPlanToPrompt = 'horus.linkPlanToPrompt',
	SyncLinkedPlan = 'horus.syncLinkedPlan',
	OpenLinkedPlanFile = 'horus.openLinkedPlanFile',
	OpenLinkedPlanDiff = 'horus.openLinkedPlanDiff',
	OpenPromptVersionDiff = 'horus.openPromptVersionDiff',
	OpenWorkflowBoard = 'horus.openWorkflowBoard',
	LaunchPromptTerminal = 'horus.launchPromptTerminal',
	PauseLinkedPlan = 'horus.pauseLinkedPlan',
	ResumeLinkedPlan = 'horus.resumeLinkedPlan',
	Refresh = 'horus.refresh'
}

export const HorusContext = {
	HasNativeWorkspace: new RawContextKey<boolean>('horus.hasNativeWorkspace', false, localize('horusHasNativeWorkspaceContext', "Whether Horus has at least one VS Code workspace folder open.")),
	PromptSelected: new RawContextKey<boolean>('horus.promptSelected', false, localize('horusPromptSelectedContext', "Whether a Horus prompt is selected."))
};
