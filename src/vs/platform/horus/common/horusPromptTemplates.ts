import { HorusPromptKind, HorusTargetAgent } from './horusTypes.js';

export const enum HorusPromptTemplateKey {
	ReviewPlan = 1,
	ImplementPlan = 2,
	ReviewPlanWithParentPrompt = 3,
	ReReviewPlan = 4,
	ImplementPlanInWorktree = 5,
	ReviewPullRequest = 6,
	MergePullRequest = 7,
	RebaseCurrentBranch = 8,
	ReReviewPullRequest = 9
}

export interface HorusPromptTemplateInputDefinition {
	readonly key: string;
	readonly label: string;
	readonly placeholder: string;
	readonly helpText: string;
	readonly required?: boolean;
	readonly multiline?: boolean;
}

export interface HorusChildPromptTemplateContext {
	readonly absolutePath: string;
	readonly displayName: string;
	readonly parentPromptContent: string;
	readonly pullRequestReference?: string | null;
	readonly inputs?: Readonly<Record<string, string>>;
}

export interface HorusRenderedPromptTemplate {
	readonly title: string;
	readonly content: string;
}

export interface HorusChildPromptTemplate {
	readonly key: HorusPromptTemplateKey;
	readonly displayName: string;
	readonly description: string;
	readonly defaultTargetAgent: HorusTargetAgent;
	readonly defaultKind: HorusPromptKind;
	readonly isReReview?: boolean;
	readonly inputs: readonly HorusPromptTemplateInputDefinition[];
	render(context: HorusChildPromptTemplateContext): HorusRenderedPromptTemplate;
}

const pullRequestInput: HorusPromptTemplateInputDefinition = {
	key: 'pullRequest',
	label: 'PR',
	placeholder: '#123 ou URL da PR',
	helpText: 'Informe o numero ou link da PR.'
};

const codexResponseInput: HorusPromptTemplateInputDefinition = {
	key: 'codexResponse',
	label: 'Resposta do Codex',
	placeholder: 'Cole a resposta do Codex apos corrigir os pontos da primeira revisao',
	helpText: 'Informe a resposta do Codex depois que ele corrigiu os pontos apontados na primeira revisao.',
	multiline: true
};

const templates: readonly HorusChildPromptTemplate[] = [
	{
		key: HorusPromptTemplateKey.ReviewPlan,
		displayName: 'Revisar plano',
		description: 'Gera um prompt para validar, aprovar ou apontar melhorias em um plano.',
		defaultTargetAgent: HorusTargetAgent.Codex,
		defaultKind: HorusPromptKind.Review,
		inputs: [],
		render: context => ({
			title: `Revisar plano: ${context.displayName}`,
			content: `Dado o plano "${context.absolutePath}", valide o plano, aprove-o ou aponte melhorias.`
		})
	},
	{
		key: HorusPromptTemplateKey.ImplementPlan,
		displayName: 'Implementar plano',
		description: 'Gera um prompt para implementar o plano aprovado.',
		defaultTargetAgent: HorusTargetAgent.Codex,
		defaultKind: HorusPromptKind.Implementation,
		inputs: [],
		render: context => ({
			title: `Implementar plano: ${context.displayName}`,
			content: `Implemente o plano "${context.absolutePath}".`
		})
	},
	{
		key: HorusPromptTemplateKey.ReviewPlanWithParentPrompt,
		displayName: 'Revisar plano com prompt pai',
		description: 'Gera um prompt de revisao incluindo o prompt original que originou o plano.',
		defaultTargetAgent: HorusTargetAgent.Codex,
		defaultKind: HorusPromptKind.Review,
		inputs: [],
		render: context => ({
			title: `Revisar plano com prompt pai: ${context.displayName}`,
			content: `Pedi ao Claude para rodar o plan-mode usando o prompt abaixo:

\`\`\`md
${context.parentPromptContent}
\`\`\`

Ele gerou o plano "${context.absolutePath}".

Dado o plano "${context.absolutePath}", valide o plano, aprove-o ou aponte melhorias.`
		})
	},
	{
		key: HorusPromptTemplateKey.ReReviewPlan,
		displayName: 'Re-review do plano',
		description: 'Gera um prompt para revalidar um plano apos Claude corrigir pontos apontados anteriormente.',
		defaultTargetAgent: HorusTargetAgent.Codex,
		defaultKind: HorusPromptKind.Review,
		isReReview: true,
		inputs: [],
		render: context => ({
			title: `Revisar plano novamente: ${context.displayName}`,
			content: `Passei os pontos anteriores para o Claude corrigir no plano "${context.absolutePath}". Valide o plano atualizado novamente, aprove-o se estiver correto ou aponte as melhorias que ainda faltam.`
		})
	},
	{
		key: HorusPromptTemplateKey.ImplementPlanInWorktree,
		displayName: 'Implementar em worktree',
		description: 'Gera um prompt para implementar o plano em uma worktree separada e abrir PR.',
		defaultTargetAgent: HorusTargetAgent.Codex,
		defaultKind: HorusPromptKind.Implementation,
		inputs: [],
		render: context => ({
			title: `Implementar em worktree: ${context.displayName}`,
			content: `Implemente o plano \`${context.absolutePath}\` completamente em uma worktree separada.

Preserve o checkout principal e as alteracoes locais nao relacionadas. Ao terminar, rode as validacoes aplicaveis, deixe o branch pronto para revisao e abra um PR.`
		})
	},
	{
		key: HorusPromptTemplateKey.ReviewPullRequest,
		displayName: 'Revisar PR',
		description: 'Gera um prompt de revisao para a PR que implementou o plano.',
		defaultTargetAgent: HorusTargetAgent.Codex,
		defaultKind: HorusPromptKind.General,
		inputs: [pullRequestInput],
		render: context => {
			const pullRequestReference = formatPullRequestReference(getInputValue(context, 'pullRequest'));
			return {
				title: `Revisar ${pullRequestReference}: ${context.displayName}`,
				content: `/review

Revise o ${pullRequestReference} que implementa o plano \`${context.absolutePath}\`.

Use o plano como fonte da verdade. Verifique se o PR implementa o plano completamente, preserva a arquitetura existente, nao introduz regressoes e se as validacoes necessarias foram executadas.

Priorize bugs, riscos de comportamento e testes ausentes. Reporte os achados com severidade e referencias concretas de arquivo/linha quando possivel.`
			};
		}
	},
	{
		key: HorusPromptTemplateKey.ReReviewPullRequest,
		displayName: 'Re-review de PR',
		description: 'Gera um prompt para revisar novamente uma PR apos correcoes dos pontos anteriores.',
		defaultTargetAgent: HorusTargetAgent.Codex,
		defaultKind: HorusPromptKind.General,
		isReReview: true,
		inputs: [pullRequestInput, codexResponseInput],
		render: context => {
			const pullRequestReference = formatPullRequestReference(getInputValue(context, 'pullRequest'));
			const codexResponse = getInputValue(context, 'codexResponse') ?? '';
			return {
				title: `Revisar novamente ${pullRequestReference}: ${context.displayName}`,
				content: `/review

Revise novamente o ${pullRequestReference} depois que o Codex corrigiu os pontos da revisao anterior.

O PR implementa o plano \`${context.absolutePath}\`. Use o plano como fonte da verdade, use o contexto da sessao atual do Claude Code da primeira revisao quando disponivel e verifique se as correcoes foram realmente aplicadas sem introduzir regressoes.

Resposta do Codex apos aplicar as correcoes:

\`\`\`md
${codexResponse}
\`\`\`

Trate a resposta do Codex como um repasse, nao como prova. Priorize bugs nao resolvidos, riscos de comportamento, regressoes e testes ausentes. Reporte os achados com severidade e referencias concretas de arquivo/linha quando possivel. Se o PR estiver aceitavel agora, diga isso claramente.`
			};
		}
	},
	{
		key: HorusPromptTemplateKey.RebaseCurrentBranch,
		displayName: 'Atualizar branch com main',
		description: 'Gera um prompt para atualizar a branch ou worktree atual com as ultimas alteracoes da main remota usando rebase.',
		defaultTargetAgent: HorusTargetAgent.Codex,
		defaultKind: HorusPromptKind.General,
		inputs: [],
		render: () => ({
			title: 'Atualizar branch com main',
			content: `Atualize meu branch/worktree atual com as ultimas alteracoes do branch main remoto usando rebase.

Preserve as alteracoes locais nao relacionadas. Se houver conflitos, pare e me avise para resolvermos juntos.`
		})
	},
	{
		key: HorusPromptTemplateKey.MergePullRequest,
		displayName: 'Fazer merge da PR',
		description: 'Gera um prompt para o Codex fazer merge seguro da PR.',
		defaultTargetAgent: HorusTargetAgent.Codex,
		defaultKind: HorusPromptKind.General,
		inputs: [pullRequestInput],
		render: context => {
			const pullRequestReference = formatPullRequestReference(getInputValue(context, 'pullRequest'));
			return {
				title: `Mesclar ${pullRequestReference}: ${context.displayName}`,
				content: `Faca o merge do ${pullRequestReference} que implementa o plano \`${context.absolutePath}\`.

Antes de mesclar, confirme que o PR esta pronto para merge, que as validacoes necessarias passaram e preserve as alteracoes locais nao relacionadas.

Se houver conflitos ou checks falhando, pare e reporte o bloqueio exato. Apos o merge, sincronize o branch main local com o remoto, remova a worktree se existir, exclua o branch local/remoto se ainda existirem e for seguro, e confirme o estado final do repositorio.`
			};
		}
	}
];

export function getHorusChildPromptTemplates(): readonly HorusChildPromptTemplate[] {
	return templates;
}

export function renderHorusChildPromptTemplate(template: HorusChildPromptTemplate, context: HorusChildPromptTemplateContext): HorusRenderedPromptTemplate {
	return template.render(context);
}

function getInputValue(context: HorusChildPromptTemplateContext, key: string): string | undefined {
	const input = context.inputs?.[key]?.trim();
	if (input) {
		return input;
	}

	return key === 'pullRequest' ? context.pullRequestReference?.trim() || undefined : undefined;
}

function formatPullRequestReference(value: string | undefined): string {
	const normalized = value?.trim() ?? '';
	if (!normalized) {
		return 'PR';
	}

	if (
		normalized.startsWith('#') ||
		normalized.toLowerCase().startsWith('pr ') ||
		normalized.toLowerCase().startsWith('http://') ||
		normalized.toLowerCase().startsWith('https://')
	) {
		return normalized;
	}

	return `PR #${normalized}`;
}
