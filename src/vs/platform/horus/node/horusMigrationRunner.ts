import { createHash } from 'crypto';
import { HorusMigration } from '../common/horusMigration.js';
import { HorusBackupService } from './horusBackupService.js';
import { HorusSQLiteConnection } from './horusSQLiteConnection.js';

interface UserVersionRow {
	readonly user_version: number;
}

export class HorusMigrationRunner {

	constructor(
		private readonly connection: HorusSQLiteConnection,
		private readonly backupService: HorusBackupService,
		private readonly migrations: readonly HorusMigration[]
	) { }

	async migrate(): Promise<void> {
		await this.ensureMigrationTable();

		const currentVersion = await this.getUserVersion();
		const pending = this.migrations.filter(migration => migration.version > currentVersion);
		if (!pending.length) {
			return;
		}

		let backupPath: string | undefined;
		try {
			backupPath = await this.backupService.createPreMigrationBackup();
			for (const migration of pending) {
				await this.applyMigration(migration);
			}
		} catch (error) {
			if (backupPath) {
				await this.backupService.restore(backupPath).catch(() => undefined);
			}
			throw error;
		} finally {
			this.backupService.resumeWrites();
		}
	}

	private async ensureMigrationTable(): Promise<void> {
		await this.connection.exec(`
			CREATE TABLE IF NOT EXISTS _horus_migrations (
				version INTEGER PRIMARY KEY,
				description TEXT NOT NULL,
				checksum TEXT NOT NULL,
				applied_at TEXT NOT NULL
			);
		`);
	}

	private async getUserVersion(): Promise<number> {
		const row = await this.connection.get<UserVersionRow>('PRAGMA user_version;', [], 'write');
		return row?.user_version ?? 0;
	}

	private async applyMigration(migration: HorusMigration): Promise<void> {
		const checksum = createHash('sha256').update(migration.statements.join('\n')).digest('hex');
		const appliedAt = new Date().toISOString();

		await this.connection.transaction(async () => {
			for (const statement of migration.statements) {
				await this.connection.exec(statement, 'write');
			}

			await this.connection.run(
				'INSERT INTO _horus_migrations (version, description, checksum, applied_at) VALUES (?, ?, ?, ?);',
				[migration.version, migration.description, checksum, appliedAt]
			);
			await this.connection.exec(`PRAGMA user_version = ${migration.version};`, 'write');
		});
	}
}
