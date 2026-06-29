import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { onUnexpectedError } from '../../../../../base/common/errors.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService, IFileStat } from '../../../../../platform/files/common/files.js';
import { IRequestService, asJson } from '../../../../../platform/request/common/request.js';
import { IPathService } from '../../../../services/path/common/pathService.js';

export interface HorusAgentUsageWindow {
	readonly provider: 'Claude' | 'Codex';
	readonly label: string;
	readonly plan: string | null;
	readonly usedPercent: number | null;
	readonly usedTokens: number | null;
	readonly limitTokens: number | null;
	readonly resetsAt: string | null;
	readonly source: 'api' | 'local';
}

export interface HorusAgentUsageSnapshot {
	readonly updatedAt: number;
	readonly windows: readonly HorusAgentUsageWindow[];
	readonly error: string | null;
}

interface ClaudeCredentials {
	readonly claudeAiOauth?: {
		readonly accessToken?: string;
		readonly subscriptionType?: string;
		readonly rateLimitTier?: string;
	};
}

interface ClaudeUsageResponse {
	readonly usage?: Record<string, ClaudeUsageWindowResponse>;
	readonly subscription_type?: string;
	readonly rate_limit_tier?: string;
}

interface ClaudeUsageWindowResponse {
	readonly utilization?: number;
	readonly resets_at?: string;
	readonly used_tokens?: number;
	readonly limit_tokens?: number;
}

interface CodexTokenCountEvent {
	readonly type?: string;
	readonly payload?: {
		readonly type?: string;
		readonly rate_limits?: CodexRateLimit[];
		readonly info?: { readonly rate_limits?: CodexRateLimit[] };
	};
	readonly rate_limits?: CodexRateLimit[];
	readonly info?: { readonly rate_limits?: CodexRateLimit[] };
}

interface CodexRateLimit {
	readonly type?: string;
	readonly used_percent?: number;
	readonly resets_at?: number;
	readonly window_minutes?: number;
	readonly plan_type?: string;
	readonly limit_id?: string;
}

export class HorusAgentUsageMonitor extends Disposable {

	readonly snapshot = observableValue<HorusAgentUsageSnapshot>(this, { updatedAt: 0, windows: [], error: null });

	private refreshHandle: ReturnType<typeof setInterval> | undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IRequestService private readonly requestService: IRequestService,
		@IPathService private readonly pathService: IPathService
	) {
		super();
		this.refresh().catch(onUnexpectedError);
		this.refreshHandle = setInterval(() => this.refresh().catch(onUnexpectedError), 60_000);
	}

	override dispose(): void {
		if (this.refreshHandle) {
			clearInterval(this.refreshHandle);
			this.refreshHandle = undefined;
		}
		super.dispose();
	}

	async refresh(): Promise<void> {
		try {
			const windows = [
				...await this.readClaudeUsage(),
				...await this.readCodexUsage()
			];
			this.snapshot.set({ updatedAt: Date.now(), windows, error: null }, undefined);
		} catch (error) {
			this.snapshot.set({ updatedAt: Date.now(), windows: this.snapshot.get().windows, error: String(error) }, undefined);
		}
	}

	private async readClaudeUsage(): Promise<readonly HorusAgentUsageWindow[]> {
		const credentials = await this.readClaudeCredentials();
		if (credentials?.claudeAiOauth?.accessToken) {
			const apiUsage = await this.fetchClaudeApiUsage(credentials).catch(() => undefined);
			if (apiUsage?.length) {
				return apiUsage;
			}
		}

		return this.readClaudeLocalUsage(credentials?.claudeAiOauth?.subscriptionType ?? credentials?.claudeAiOauth?.rateLimitTier ?? null);
	}

	private async readClaudeCredentials(): Promise<ClaudeCredentials | undefined> {
		const candidates = [
			this.joinHome('.claude', '.credentials.json'),
			this.joinHome('.config', 'claude', '.credentials.json')
		];

		for (const candidate of candidates) {
			const text = await this.readText(candidate).catch(() => undefined);
			if (text) {
				return JSON.parse(text) as ClaudeCredentials;
			}
		}

		return undefined;
	}

	private async fetchClaudeApiUsage(credentials: ClaudeCredentials): Promise<readonly HorusAgentUsageWindow[]> {
		const token = credentials.claudeAiOauth?.accessToken;
		if (!token) {
			return [];
		}

		const context = await this.requestService.request({
			type: 'GET',
			url: 'https://api.anthropic.com/api/oauth/usage',
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'anthropic-beta': 'oauth-2025-04-20',
				'User-Agent': 'claude-code/unknown'
			},
			timeout: 10_000,
			callSite: 'horusAgentUsage'
		}, CancellationToken.None);
		const data = await asJson<ClaudeUsageResponse>(context);
		const usage = data?.usage;
		if (!usage) {
			return [];
		}

		const plan = credentials.claudeAiOauth?.subscriptionType ?? data?.subscription_type ?? credentials.claudeAiOauth?.rateLimitTier ?? data?.rate_limit_tier ?? null;
		return Object.entries(usage).map(([key, value]) => ({
			provider: 'Claude' as const,
			label: this.claudeWindowLabel(key),
			plan,
			usedPercent: typeof value.utilization === 'number' ? this.normalizePercent(value.utilization) : null,
			usedTokens: value.used_tokens ?? null,
			limitTokens: value.limit_tokens ?? null,
			resetsAt: value.resets_at ?? null,
			source: 'api' as const
		}));
	}

	private async readClaudeLocalUsage(plan: string | null): Promise<readonly HorusAgentUsageWindow[]> {
		const files = await this.collectFiles(this.joinHome('.claude', 'projects'), '.jsonl', 120);
		let fiveHourTokens = 0;
		let sevenDayTokens = 0;
		const now = Date.now();
		const fiveHoursAgo = now - 5 * 60 * 60 * 1000;
		const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
		const seen = new Set<string>();

		for (const file of files) {
			const text = await this.readText(file).catch(() => undefined);
			if (!text) {
				continue;
			}

			for (const line of text.split(/\r?\n/)) {
				if (!line.trim()) {
					continue;
				}
				const entry = JSON.parse(line) as Record<string, any>;
				const timestamp = Date.parse(String(entry.timestamp ?? entry.created_at ?? ''));
				if (!Number.isFinite(timestamp) || timestamp < sevenDaysAgo) {
					continue;
				}
				const message = entry.message;
				if (message?.role !== 'assistant') {
					continue;
				}
				const uniqueKey = String(entry.uuid ?? entry.id ?? `${file.toString()}-${timestamp}-${line.length}`);
				if (seen.has(uniqueKey)) {
					continue;
				}
				seen.add(uniqueKey);
				const usage = message.usage ?? entry.usage ?? {};
				const tokens = Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0);
				if (!Number.isFinite(tokens) || tokens <= 0) {
					continue;
				}
				sevenDayTokens += tokens;
				if (timestamp >= fiveHoursAgo) {
					fiveHourTokens += tokens;
				}
			}
		}

		return [
			{ provider: 'Claude', label: 'Sessão 5h', plan, usedPercent: null, usedTokens: fiveHourTokens, limitTokens: null, resetsAt: null, source: 'local' },
			{ provider: 'Claude', label: 'Semana', plan, usedPercent: null, usedTokens: sevenDayTokens, limitTokens: null, resetsAt: null, source: 'local' }
		];
	}

	private async readCodexUsage(): Promise<readonly HorusAgentUsageWindow[]> {
		const sessionsRoot = this.joinHome('.codex', 'sessions');
		const files = (await this.collectFiles(sessionsRoot, '.jsonl', 80))
			.filter(uri => /rollout-.*\.jsonl$/i.test(uri.path))
			.slice(-5);
		const windows = new Map<string, HorusAgentUsageWindow>();

		for (const file of files) {
			const text = await this.readText(file).catch(() => undefined);
			if (!text) {
				continue;
			}
			const lines = text.split(/\r?\n/).filter(Boolean).reverse();
			for (const line of lines) {
				const event = JSON.parse(line) as CodexTokenCountEvent;
				const rateLimits = this.getCodexRateLimits(event);
				if (!rateLimits.length) {
					continue;
				}
				for (const limit of rateLimits) {
					const key = limit.type ?? limit.limit_id ?? String(limit.window_minutes ?? 'unknown');
					if (windows.has(key)) {
						continue;
					}
					const resetsAt = typeof limit.resets_at === 'number' ? new Date(limit.resets_at * 1000).toISOString() : null;
					if (resetsAt && Date.parse(resetsAt) <= Date.now()) {
						continue;
					}
					windows.set(key, {
						provider: 'Codex',
						label: this.codexWindowLabel(limit),
						plan: limit.plan_type ?? limit.limit_id ?? null,
						usedPercent: typeof limit.used_percent === 'number' ? this.normalizePercent(limit.used_percent) : null,
						usedTokens: null,
						limitTokens: null,
						resetsAt,
						source: 'local'
					});
				}
				break;
			}
		}

		return [...windows.values()];
	}

	private getCodexRateLimits(event: CodexTokenCountEvent): readonly CodexRateLimit[] {
		if (event.type === 'token_count') {
			return event.rate_limits ?? event.info?.rate_limits ?? [];
		}
		if (event.type === 'event_msg' && event.payload?.type === 'token_count') {
			return event.payload.rate_limits ?? event.payload.info?.rate_limits ?? [];
		}
		return [];
	}

	private async collectFiles(root: URI, extension: string, limit: number): Promise<URI[]> {
		const result: URI[] = [];
		await this.walk(root, extension, result, limit).catch(() => undefined);
		return result;
	}

	private async walk(resource: URI, extension: string, result: URI[], limit: number): Promise<void> {
		if (result.length >= limit) {
			return;
		}

		const stat = await this.fileService.resolve(resource).catch(() => undefined);
		if (!stat) {
			return;
		}
		if (stat.isFile && resource.path.toLowerCase().endsWith(extension)) {
			result.push(resource);
			return;
		}
		if (!stat.isDirectory || !stat.children) {
			return;
		}

		for (const child of this.sortChildren(stat.children)) {
			await this.walk(child.resource, extension, result, limit);
			if (result.length >= limit) {
				return;
			}
		}
	}

	private sortChildren(children: IFileStat[]): IFileStat[] {
		return [...children].sort((a, b) => a.name.localeCompare(b.name));
	}

	private async readText(resource: URI): Promise<string> {
		const content = await this.fileService.readFile(resource);
		return content.value.toString();
	}

	private joinHome(...segments: string[]): URI {
		return URI.joinPath(this.pathService.userHome({ preferLocal: true }), ...segments);
	}

	private normalizePercent(value: number): number {
		if (value > 1) {
			return Math.max(0, Math.min(1, value / 100));
		}
		return Math.max(0, Math.min(1, value));
	}

	private claudeWindowLabel(key: string): string {
		switch (key) {
			case 'five_hour':
				return 'Sessão 5h';
			case 'seven_day':
				return 'Semana';
			case 'seven_day_opus':
				return 'Semana Opus';
			default:
				return key.replace(/_/g, ' ');
		}
	}

	private codexWindowLabel(limit: CodexRateLimit): string {
		if (limit.type === 'primary' || limit.window_minutes === 300) {
			return 'Sessão 5h';
		}
		if (limit.type === 'secondary') {
			return 'Semana';
		}
		return limit.window_minutes ? `${limit.window_minutes} min` : (limit.type ?? 'Limite');
	}
}
