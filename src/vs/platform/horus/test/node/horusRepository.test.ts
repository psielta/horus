import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { HorusLinkedDocumentStatus, HorusLinkedDocumentType, HorusLinkedDocumentVersionSource, HorusPromptKind, HorusPromptStatus, HorusTargetAgent } from '../../common/horusTypes.js';
import { HorusLinkedDocumentRepository } from '../../node/repositories/linkedDocumentRepository.js';
import { HorusPromptRepository } from '../../node/repositories/promptRepository.js';
import { HorusWorkspaceRepository } from '../../node/repositories/workspaceRepository.js';
import { createHorusTestStore, HorusTestStore } from './horusTestUtils.js';

suite('HorusRepository', () => {

	let store: HorusTestStore | undefined;

	teardown(async () => {
		await store?.dispose();
		store = undefined;
	});

	test('getOrCreate is idempotent for native workspace folders', async () => {
		store = await createHorusTestStore('repository-workspace');
		const repository = new HorusWorkspaceRepository(store.connection);

		const first = await repository.getOrCreate({ name: 'Repo', absolutePath: store.root });
		const second = await repository.getOrCreate({ name: 'Repo', absolutePath: store.root });

		assert.strictEqual(first.id, second.id);
		assert.strictEqual((await repository.list()).length, 1);
	});

	test('creates prompt with initial version and lists root prompts', async () => {
		store = await createHorusTestStore('repository-prompt');
		const workspaceRepository = new HorusWorkspaceRepository(store.connection);
		const promptRepository = new HorusPromptRepository(store.connection);
		const workspace = await workspaceRepository.getOrCreate({ name: 'Repo', absolutePath: store.root });

		const prompt = await promptRepository.create({
			workingDirectoryId: workspace.id,
			title: 'Test prompt',
			content: '# Test'
		});

		const prompts = await promptRepository.list({ workingDirectoryId: workspace.id, rootOnly: true });
		const versions = await store.connection.get<{ readonly count: number }>('SELECT COUNT(*) AS count FROM prompt_versions WHERE prompt_id = ?;', [prompt.id], 'read');

		assert.strictEqual(prompts.length, 1);
		assert.strictEqual(prompts[0].id, prompt.id);
		assert.strictEqual(versions?.count, 1);
	});

	test('updates prompt with optimistic row version, new version and file references', async () => {
		store = await createHorusTestStore('repository-prompt-update');
		const workspaceRepository = new HorusWorkspaceRepository(store.connection);
		const promptRepository = new HorusPromptRepository(store.connection);
		const workspace = await workspaceRepository.getOrCreate({ name: 'Repo', absolutePath: store.root });
		const prompt = await promptRepository.create({
			workingDirectoryId: workspace.id,
			title: 'Original',
			content: '# Original'
		});

		const updated = await promptRepository.update({
			id: prompt.id,
			title: 'Updated',
			content: '# Updated\n@src/index.ts',
			targetAgent: HorusTargetAgent.Codex,
			kind: HorusPromptKind.Implementation,
			status: HorusPromptStatus.Active,
			rowVersion: prompt.rowVersion,
			mentions: ['src/index.ts']
		}, [
			{ relativePath: 'src/index.ts', rawMention: 'src/index.ts', exists: true, resolvedAtUtc: new Date().toISOString() }
		]);

		const versionCount = await store.connection.get<{ readonly count: number }>('SELECT COUNT(*) AS count FROM prompt_versions WHERE prompt_id = ?;', [prompt.id], 'read');
		const reference = await store.connection.get<{ readonly relative_path: string; readonly file_exists: number }>('SELECT relative_path, file_exists FROM prompt_file_references WHERE prompt_id = ?;', [prompt.id], 'read');

		assert.strictEqual(updated.title, 'Updated');
		assert.strictEqual(updated.currentVersion, 2);
		assert.strictEqual(updated.rowVersion, 2);
		assert.strictEqual(versionCount?.count, 2);
		assert.strictEqual(reference?.relative_path, 'src/index.ts');
		assert.strictEqual(reference?.file_exists, 1);
		await assert.rejects(() => promptRepository.update({
			id: prompt.id,
			title: 'Conflict',
			content: '',
			targetAgent: HorusTargetAgent.Codex,
			kind: HorusPromptKind.General,
			status: HorusPromptStatus.Draft,
			rowVersion: prompt.rowVersion
		}, []));
	});

	test('lists child prompts without including them in root prompt query', async () => {
		store = await createHorusTestStore('repository-prompt-children');
		const workspaceRepository = new HorusWorkspaceRepository(store.connection);
		const promptRepository = new HorusPromptRepository(store.connection);
		const workspace = await workspaceRepository.getOrCreate({ name: 'Repo', absolutePath: store.root });
		const parent = await promptRepository.create({
			workingDirectoryId: workspace.id,
			title: 'Parent',
			content: '# Parent'
		});
		const child = await promptRepository.create({
			workingDirectoryId: workspace.id,
			parentPromptId: parent.id,
			title: 'Child',
			content: '# Child'
		});

		const roots = await promptRepository.list({ workingDirectoryId: workspace.id, rootOnly: true });
		const children = await promptRepository.list({ workingDirectoryId: workspace.id, parentPromptId: parent.id });

		assert.deepStrictEqual(roots.map(prompt => prompt.id), [parent.id]);
		assert.deepStrictEqual(children.map(prompt => prompt.id), [child.id]);
	});

	test('reads prompt versions for native diff providers', async () => {
		store = await createHorusTestStore('repository-prompt-versions');
		const workspaceRepository = new HorusWorkspaceRepository(store.connection);
		const promptRepository = new HorusPromptRepository(store.connection);
		const workspace = await workspaceRepository.getOrCreate({ name: 'Repo', absolutePath: store.root });
		const prompt = await promptRepository.create({
			workingDirectoryId: workspace.id,
			title: 'Original',
			content: '# Original'
		});
		const updated = await promptRepository.update({
			id: prompt.id,
			title: 'Updated',
			content: '# Updated',
			targetAgent: HorusTargetAgent.Codex,
			kind: HorusPromptKind.General,
			status: HorusPromptStatus.Active,
			rowVersion: prompt.rowVersion
		}, []);

		const versions = await promptRepository.listVersions(prompt.id);
		const initial = await promptRepository.getVersion(prompt.id, 1);
		const latest = await promptRepository.getVersion(prompt.id, updated.currentVersion);

		assert.deepStrictEqual(versions.map(version => version.versionNumber), [2, 1]);
		assert.strictEqual(initial?.content, '# Original');
		assert.strictEqual(latest?.content, '# Updated');
	});

	test('links markdown plan and versions changed content', async () => {
		store = await createHorusTestStore('repository-linked-document');
		const workspaceRepository = new HorusWorkspaceRepository(store.connection);
		const promptRepository = new HorusPromptRepository(store.connection);
		const linkedDocumentRepository = new HorusLinkedDocumentRepository(store.connection);
		const workspace = await workspaceRepository.getOrCreate({ name: 'Repo', absolutePath: store.root });
		const prompt = await promptRepository.create({
			workingDirectoryId: workspace.id,
			title: 'Prompt',
			content: '# Prompt'
		});

		const linked = await linkedDocumentRepository.link({
			promptId: prompt.id,
			workingDirectoryId: workspace.id,
			absolutePath: `${store.root}\\plan.md`,
			absolutePathKey: `${store.root}/plan.md`.toLowerCase(),
			documentType: HorusLinkedDocumentType.ClaudeCodePlan,
			displayName: 'plan.md',
			pullRequestReference: null,
			content: '# Plan v1',
			contentHash: 'hash-1',
			sizeBytes: 9
		});
		const unchanged = await linkedDocumentRepository.syncContent(linked.document.id, {
			content: '# Plan v1',
			contentHash: 'hash-1',
			sizeBytes: 9,
			source: HorusLinkedDocumentVersionSource.FileWatcher
		});
		const changed = await linkedDocumentRepository.syncContent(linked.document.id, {
			content: '# Plan v2',
			contentHash: 'hash-2',
			sizeBytes: 9,
			source: HorusLinkedDocumentVersionSource.FileWatcher
		});
		const versions = await linkedDocumentRepository.listVersions(linked.document.id);

		assert.strictEqual(linked.versionCreated, true);
		assert.strictEqual(unchanged.versionCreated, false);
		assert.strictEqual(changed.versionCreated, true);
		assert.strictEqual(changed.document.currentVersion, 2);
		assert.deepStrictEqual(versions.map(version => version.versionNumber), [2, 1]);
		assert.strictEqual((await linkedDocumentRepository.getByPrompt(prompt.id))?.status, HorusLinkedDocumentStatus.Watching);
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
