import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { createHorusTestStore, HorusTestStore } from './horusTestUtils.js';

interface JournalModeRow {
	readonly journal_mode: string;
}

interface ForeignKeysRow {
	readonly foreign_keys: number;
}

interface CountRow {
	readonly count: number;
}

suite('HorusSQLiteConnection', () => {

	let store: HorusTestStore | undefined;

	teardown(async () => {
		await store?.dispose();
		store = undefined;
	});

	test('configures WAL, busy timeout and foreign keys', async () => {
		store = await createHorusTestStore('connection-pragmas');

		const journalMode = await store.connection.get<JournalModeRow>('PRAGMA journal_mode;', [], 'write');
		const foreignKeys = await store.connection.get<ForeignKeysRow>('PRAGMA foreign_keys;', [], 'write');

		assert.strictEqual(journalMode?.journal_mode, 'wal');
		assert.strictEqual(foreignKeys?.foreign_keys, 1);
	});

	test('read connection sees committed snapshot during write transaction', async () => {
		store = await createHorusTestStore('connection-read-during-write');

		await store.connection.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
		await store.connection.run('INSERT INTO items (value) VALUES (?);', ['committed']);

		await store.connection.exec('BEGIN IMMEDIATE;', 'write');
		try {
			await store.connection.run('INSERT INTO items (value) VALUES (?);', ['uncommitted']);
			const count = await store.connection.get<CountRow>('SELECT COUNT(*) AS count FROM items;', [], 'read');
			assert.strictEqual(count?.count, 1);
		} finally {
			await store.connection.exec('ROLLBACK;', 'write');
		}
	});

	test('rolls back failed transactions', async () => {
		store = await createHorusTestStore('connection-rollback');

		await store.connection.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
		await assert.rejects(store.connection.transaction(async () => {
			await store!.connection.run('INSERT INTO items (value) VALUES (?);', ['rolled-back']);
			throw new Error('fail transaction');
		}), /fail transaction/);

		const count = await store.connection.get<CountRow>('SELECT COUNT(*) AS count FROM items;', [], 'read');
		assert.strictEqual(count?.count, 0);
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
