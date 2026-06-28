import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { HorusPromptKind, HorusPromptStatus, HorusTargetAgent } from '../../common/horusTypes.js';
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

	ensureNoDisposablesAreLeakedInTestSuite();
});
