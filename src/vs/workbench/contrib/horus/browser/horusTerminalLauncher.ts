import { timeout } from '../../../../base/common/async.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { HorusPrompt, HorusTargetAgent, HorusWorkspace } from '../../../../platform/horus/common/horusTypes.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { ITerminalGroupService, ITerminalService } from '../../terminal/browser/terminal.js';

export const IHorusTerminalLauncher = createDecorator<IHorusTerminalLauncher>('horusTerminalLauncher');

export const enum HorusTerminalAgentLaunch {
	Claude = 'Claude',
	ClaudePlan = 'ClaudePlan',
	Codex = 'Codex',
	Grok = 'Grok'
}

export interface IHorusTerminalLauncher {
	readonly _serviceBrand: undefined;
	launchPrompt(prompt: HorusPrompt, workspace: HorusWorkspace, agent: HorusTerminalAgentLaunch, submitPrompt?: boolean): Promise<void>;
}

export class HorusTerminalLauncher implements IHorusTerminalLauncher {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ITerminalService private readonly terminalService: ITerminalService,
		@ITerminalGroupService private readonly terminalGroupService: ITerminalGroupService
	) { }

	async launchPrompt(prompt: HorusPrompt, workspace: HorusWorkspace, agent: HorusTerminalAgentLaunch, submitPrompt = false): Promise<void> {
		const launchCommand = this.resolveLaunchCommand(agent);
		const followUp = this.resolveFollowUp(agent, prompt.content, submitPrompt);
		const instance = await this.terminalService.createTerminal({
			location: TerminalLocation.Panel,
			config: {
				name: this.getTerminalName(prompt, agent),
				cwd: URI.file(workspace.absolutePath)
			}
		});

		this.terminalService.setActiveInstance(instance);
		await this.terminalGroupService.showPanel(false);
		await this.terminalService.revealActiveTerminal(false);
		await instance.focusWhenReady();

		await instance.sendText(launchCommand, true);
		if (followUp) {
			await timeout(700);
			await instance.sendText(followUp.text, followUp.execute, true);
		}
	}

	private resolveLaunchCommand(agent: HorusTerminalAgentLaunch): string {
		switch (agent) {
			case HorusTerminalAgentLaunch.Claude:
			case HorusTerminalAgentLaunch.ClaudePlan:
				return 'claude --dangerously-skip-permissions --effort max';
			case HorusTerminalAgentLaunch.Codex:
				return 'codex --yolo';
			case HorusTerminalAgentLaunch.Grok:
				return 'grok --always-approve';
		}
	}

	private resolveFollowUp(agent: HorusTerminalAgentLaunch, promptContent: string, submitPrompt: boolean): { readonly text: string; readonly execute: boolean } | undefined {
		if (agent !== HorusTerminalAgentLaunch.ClaudePlan && !submitPrompt) {
			return undefined;
		}

		const flattened = this.flattenPrompt(promptContent);
		if (!flattened) {
			return undefined;
		}

		return {
			text: flattened,
			execute: agent === HorusTerminalAgentLaunch.ClaudePlan ? false : true
		};
	}

	private flattenPrompt(promptContent: string): string {
		return promptContent.replace(/\r\n|\r|\n/g, ' ').trim();
	}

	private getTerminalName(prompt: HorusPrompt, agent: HorusTerminalAgentLaunch): string {
		const agentName = this.getAgentName(agent);
		const task = prompt.taskNumber ? `${prompt.taskNumber} ` : '';
		const title = prompt.title.length > 42 ? `${prompt.title.slice(0, 39).trimEnd()}...` : prompt.title;
		return localize('horusTerminalName', "Horus {0}{1} - {2}", task, title, agentName);
	}

	private getAgentName(agent: HorusTerminalAgentLaunch): string {
		switch (agent) {
			case HorusTerminalAgentLaunch.Claude:
				return 'Claude';
			case HorusTerminalAgentLaunch.ClaudePlan:
				return 'Claude Plan';
			case HorusTerminalAgentLaunch.Codex:
				return 'Codex';
			case HorusTerminalAgentLaunch.Grok:
				return 'Grok';
		}
	}
}

export function defaultTerminalLaunchForPrompt(prompt: HorusPrompt): HorusTerminalAgentLaunch {
	switch (prompt.targetAgent) {
		case HorusTargetAgent.Codex:
			return HorusTerminalAgentLaunch.Codex;
		case HorusTargetAgent.Grok:
			return HorusTerminalAgentLaunch.Grok;
		case HorusTargetAgent.ClaudeCode:
		default:
			return HorusTerminalAgentLaunch.Claude;
	}
}
