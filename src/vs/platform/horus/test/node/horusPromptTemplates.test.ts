import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { getHorusChildPromptTemplates, HorusPromptTemplateKey, renderHorusChildPromptTemplate } from '../../common/horusPromptTemplates.js';
import { HorusPromptKind, HorusTargetAgent } from '../../common/horusTypes.js';

suite('HorusPromptTemplates', () => {

	test('catalog exposes the predefined child prompt templates in workflow order', () => {
		const templates = getHorusChildPromptTemplates();

		assert.deepStrictEqual(templates.map(template => template.key), [
			HorusPromptTemplateKey.ReviewPlan,
			HorusPromptTemplateKey.ImplementPlan,
			HorusPromptTemplateKey.ReviewPlanWithParentPrompt,
			HorusPromptTemplateKey.ReReviewPlan,
			HorusPromptTemplateKey.ImplementPlanInWorktree,
			HorusPromptTemplateKey.ReviewPullRequest,
			HorusPromptTemplateKey.ReReviewPullRequest,
			HorusPromptTemplateKey.RebaseCurrentBranch,
			HorusPromptTemplateKey.MergePullRequest
		]);
	});

	test('renders plan review child prompt with linked plan path and parent content', () => {
		const template = getHorusChildPromptTemplates().find(template => template.key === HorusPromptTemplateKey.ReviewPlanWithParentPrompt);
		assert.ok(template);

		const rendered = renderHorusChildPromptTemplate(template, {
			absolutePath: 'C:\\plans\\implementation.md',
			displayName: 'implementation.md',
			parentPromptContent: '# Original request'
		});

		assert.strictEqual(template.defaultTargetAgent, HorusTargetAgent.Codex);
		assert.strictEqual(template.defaultKind, HorusPromptKind.Review);
		assert.strictEqual(rendered.title, 'Revisar plano com prompt pai: implementation.md');
		assert.ok(rendered.content.includes('# Original request'));
		assert.ok(rendered.content.includes('C:\\plans\\implementation.md'));
	});

	test('renders pull request prompts using explicit input before linked plan fallback', () => {
		const template = getHorusChildPromptTemplates().find(template => template.key === HorusPromptTemplateKey.ReviewPullRequest);
		assert.ok(template);

		const rendered = renderHorusChildPromptTemplate(template, {
			absolutePath: 'C:\\plans\\pr-plan.md',
			displayName: 'pr-plan.md',
			parentPromptContent: '',
			pullRequestReference: '12',
			inputs: { pullRequest: '123' }
		});

		assert.strictEqual(rendered.title, 'Revisar PR #123: pr-plan.md');
		assert.ok(rendered.content.startsWith('/review'));
		assert.ok(rendered.content.includes('PR #123'));
	});

	test('renders re-review pull request prompt with codex response', () => {
		const template = getHorusChildPromptTemplates().find(template => template.key === HorusPromptTemplateKey.ReReviewPullRequest);
		assert.ok(template);

		const rendered = renderHorusChildPromptTemplate(template, {
			absolutePath: 'C:\\plans\\pr-plan.md',
			displayName: 'pr-plan.md',
			parentPromptContent: '',
			inputs: {
				pullRequest: '#45',
				codexResponse: 'Fixed the review items.'
			}
		});

		assert.strictEqual(template.isReReview, true);
		assert.strictEqual(rendered.title, 'Revisar novamente #45: pr-plan.md');
		assert.ok(rendered.content.includes('Fixed the review items.'));
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
