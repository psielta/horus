import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { HorusMigration } from '../../common/horusMigration.js';
import { HorusBackupService } from '../../node/horusBackupService.js';
import { HorusMigrationRunner } from '../../node/horusMigrationRunner.js';
import { HorusSQLiteConnection } from '../../node/horusSQLiteConnection.js';
import { HorusWriteQueue } from '../../node/horusWriteQueue.js';
import { createHorusTestStore, HorusTestStore } from './horusTestUtils.js';

interface CountRow {
	readonly count: number;
}

interface UserVersionRow {
	readonly user_version: number;
}

suite('HorusMigrationRunner', () => {

	let store: HorusTestStore | undefined;

	teardown(async () => {
		await store?.dispose();
		store = undefined;
	});

	test('applies pending migrations once and records user_version', async () => {
		store = await createHorusTestStore('migration-runner');

		const migration: HorusMigration = {
			version: 2,
			description: 'test migration',
			statements: [
				'CREATE TABLE migration_test (id INTEGER PRIMARY KEY, value TEXT NOT NULL);',
				'INSERT INTO migration_test (value) VALUES (\'created\');'
			]
		};
		const runner = createRunner(store.connection, [migration]);

		await runner.migrate();
		await runner.migrate();

		const userVersion = await store.connection.get<UserVersionRow>('PRAGMA user_version;', [], 'write');
		const rows = await store.connection.get<CountRow>('SELECT COUNT(*) AS count FROM migration_test;', [], 'read');
		const applied = await store.connection.get<CountRow>('SELECT COUNT(*) AS count FROM _horus_migrations WHERE version = 2;', [], 'read');

		assert.strictEqual(userVersion?.user_version, 2);
		assert.strictEqual(rows?.count, 1);
		assert.strictEqual(applied?.count, 1);
	});

	test('restores from pre-migration backup when a migration fails', async () => {
		store = await createHorusTestStore('migration-restore');

		const runner = createRunner(store.connection, [{
			version: 2,
			description: 'failing migration',
			statements: [
				'CREATE TABLE before_failure (id INTEGER PRIMARY KEY);',
				'INSERT INTO missing_table VALUES (1);'
			]
		}]);

		await assert.rejects(runner.migrate());

		const userVersion = await store.connection.get<UserVersionRow>('PRAGMA user_version;', [], 'write');
		const table = await store.connection.get<{ readonly name: string }>('SELECT name FROM sqlite_master WHERE type = \'table\' AND name = \'before_failure\';', [], 'read');

		assert.strictEqual(userVersion?.user_version, 1);
		assert.strictEqual(table, undefined);
	});

	function createRunner(connection: HorusSQLiteConnection, migrations: readonly HorusMigration[]): HorusMigrationRunner {
		const writeQueue = new HorusWriteQueue();
		const backupService = new HorusBackupService(connection, writeQueue);
		return new HorusMigrationRunner(connection, backupService, migrations);
	}

	ensureNoDisposablesAreLeakedInTestSuite();
});
