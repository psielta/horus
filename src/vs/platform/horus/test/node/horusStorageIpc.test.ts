import * as assert from 'assert';
import { Event } from '../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IHorusStorageService } from '../../common/horusStorage.js';
import { HorusStorageChannel } from '../../common/horusStorageIpc.js';
import { HorusPrompt, HorusPromptKind, HorusPromptStatus, HorusTargetAgent, HorusWorkspace } from '../../common/horusTypes.js';

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
		const prompt: HorusPrompt = {
			id: 'prompt-id',
			ownerId: 'owner-id',
			workingDirectoryId: workspace.id,
			parentPromptId: null,
			futureTaskId: null,
			taskNumber: null,
			title: 'Prompt',
			content: '# Prompt',
			targetAgent: HorusTargetAgent.Codex,
			kind: HorusPromptKind.General,
			status: HorusPromptStatus.Draft,
			currentVersion: 1,
			boardRank: 0,
			rowVersion: 1,
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
			listPromptVersions: async () => [],
			getPromptVersion: async () => undefined,
			createPrompt: async () => { throw new Error('not implemented'); },
			updatePrompt: async () => prompt,
			listLinkedDocuments: async () => [],
			getLinkedDocumentForPrompt: async () => undefined,
			listLinkedDocumentVersions: async () => [],
			getLinkedDocumentVersion: async () => undefined,
			linkPlanToPrompt: async () => { throw new Error('not implemented'); },
			syncLinkedDocument: async () => { throw new Error('not implemented'); },
			updateLinkedDocumentStatus: async () => { throw new Error('not implemented'); },
			getWorkflowTemplate: async () => { throw new Error('not implemented'); },
			updateWorkflowTemplate: async () => { throw new Error('not implemented'); },
			listWorkflowBoard: async () => [],
			getWorkflow: async () => undefined,
			startWorkflow: async () => { throw new Error('not implemented'); },
			advanceWorkflow: async () => { throw new Error('not implemented'); },
			setWorkflowPhase: async () => { throw new Error('not implemented'); },
			changeWorkflowActor: async () => { throw new Error('not implemented'); },
			addWorkflowNote: async () => { throw new Error('not implemented'); },
			addReviewVerdict: async () => { throw new Error('not implemented'); },
			completeWorkflow: async () => { throw new Error('not implemented'); },
			reopenWorkflow: async () => { throw new Error('not implemented'); },
			updateTaskPhases: async () => { throw new Error('not implemented'); },
			reorderBoardColumn: async () => undefined,
			advanceWorkflowToRole: async () => undefined,
			validateFileMentions: async () => []
		};

		const channel = new HorusStorageChannel(service);
		assert.deepStrictEqual(await channel.call('', 'resolveNativeWorkspaces', [{ name: 'Repo', absolutePath: 'C:\\repo' }]), [workspace]);
		assert.deepStrictEqual(await channel.call('', 'updatePrompt', { id: prompt.id }), prompt);
		assert.deepStrictEqual(await channel.call('', 'getHealth'), { databasePath: 'db', journalMode: 'wal', foreignKeys: 1, userVersion: 1 });
		assert.throws(() => channel.listen('', 'unknown'));
		assert.throws(() => channel.call('', 'unknown'));
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
