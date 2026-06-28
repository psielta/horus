import * as assert from 'assert';
import { Event } from '../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IHorusStorageService } from '../../common/horusStorage.js';
import { HorusStorageChannel } from '../../common/horusStorageIpc.js';
import { HorusWorkspace } from '../../common/horusTypes.js';

suite('HorusIPC', () => {

	test('routes storage commands through the channel', async () => {
		const workspace: HorusWorkspace = {
			id: 'workspace-id',
			ownerId: 'owner-id',
			name: 'Repo',
			absolutePath: 'C:\\repo',
			respectGitignore: true,
			enableAiContext: false,
			taskNumberPattern: null,
			createdAtUtc: new Date().toISOString(),
			updatedAtUtc: new Date().toISOString()
		};
		const service: IHorusStorageService = {
			_serviceBrand: undefined,
			onDidChangeData: Event.None,
			getHealth: async () => ({ databasePath: 'db', journalMode: 'wal', foreignKeys: 1, userVersion: 1 }),
			listWorkspaces: async () => [workspace],
			createWorkspace: async () => workspace,
			resolveNativeWorkspaces: async () => [workspace],
			listPrompts: async () => [],
			getPrompt: async () => undefined,
			createPrompt: async () => { throw new Error('not implemented'); },
			validateFileMentions: async () => []
		};

		const channel = new HorusStorageChannel(service);
		assert.deepStrictEqual(await channel.call('', 'resolveNativeWorkspaces', [{ name: 'Repo', absolutePath: 'C:\\repo' }]), [workspace]);
		assert.deepStrictEqual(await channel.call('', 'getHealth'), { databasePath: 'db', journalMode: 'wal', foreignKeys: 1, userVersion: 1 });
		assert.throws(() => channel.listen('', 'unknown'));
		assert.throws(() => channel.call('', 'unknown'));
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
