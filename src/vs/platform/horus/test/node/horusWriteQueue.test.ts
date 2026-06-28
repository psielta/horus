import * as assert from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { HorusWriteQueue } from '../../node/horusWriteQueue.js';

suite('HorusWriteQueue', () => {

	test('serializes writes in enqueue order', async () => {
		const queue = new HorusWriteQueue();
		const events: string[] = [];

		const first = queue.enqueue(async () => {
			events.push('first:start');
			await timeout(10);
			events.push('first:end');
			return 1;
		});

		const second = queue.enqueue(async () => {
			events.push('second:start');
			events.push('second:end');
			return 2;
		});

		assert.deepStrictEqual(await Promise.all([first, second]), [1, 2]);
		assert.deepStrictEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
	});

	test('pause rejects new writes and lets active write drain', async () => {
		const queue = new HorusWriteQueue();
		let resumeActiveWrite: (() => void) | undefined;

		const active = queue.enqueue(() => new Promise<void>(resolve => {
			resumeActiveWrite = resolve;
		}));

		queue.pause();
		await assert.rejects(queue.enqueue(async () => undefined), /paused/);
		resumeActiveWrite?.();
		await queue.whenIdle();
		await active;

		queue.resume();
		await assert.doesNotReject(queue.enqueue(async () => undefined));
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
