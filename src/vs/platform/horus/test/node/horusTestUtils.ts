import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { HorusBackupService } from '../../node/horusBackupService.js';
import { HorusMigrationRunner } from '../../node/horusMigrationRunner.js';
import { HorusSQLiteConnection } from '../../node/horusSQLiteConnection.js';
import { HorusWriteQueue } from '../../node/horusWriteQueue.js';
import { horusMigrations } from '../../node/migrations/v001_initial.js';

export interface HorusTestStore {
	readonly root: string;
	readonly databasePath: string;
	readonly connection: HorusSQLiteConnection;
	dispose(): Promise<void>;
}

export async function createHorusTestStore(name: string): Promise<HorusTestStore> {
	const root = join(tmpdir(), 'horus-tests', `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	const databasePath = join(root, 'horus.db');
	const connection = new HorusSQLiteConnection(databasePath);
	await connection.open();

	const writeQueue = new HorusWriteQueue();
	const backupService = new HorusBackupService(connection, writeQueue);
	const migrationRunner = new HorusMigrationRunner(connection, backupService, horusMigrations);
	await migrationRunner.migrate();

	return {
		root,
		databasePath,
		connection,
		async dispose(): Promise<void> {
			await connection.close().catch(() => undefined);
			await rm(root, { recursive: true, force: true });
		}
	};
}
