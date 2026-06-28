import { readdir, rm } from 'fs/promises';
import { basename, dirname, join } from '../../../base/common/path.js';
import { HorusSQLiteConnection } from './horusSQLiteConnection.js';
import { HorusWriteQueue } from './horusWriteQueue.js';

export class HorusBackupService {

	constructor(
		private readonly connection: HorusSQLiteConnection,
		private readonly writeQueue: HorusWriteQueue
	) { }

	async createPreMigrationBackup(): Promise<string> {
		this.writeQueue.pause();
		await this.writeQueue.whenIdle();

		await this.connection.checkpointTruncate();

		const backupPath = `${this.connection.databasePath}.backup.${new Date().toISOString().replace(/[:.]/g, '-')}`;
		await this.connection.backupTo(backupPath);
		await this.rotateBackups();

		return backupPath;
	}

	async restore(backupPath: string): Promise<void> {
		await this.connection.replaceDatabaseFromBackup(backupPath);
	}

	resumeWrites(): void {
		this.writeQueue.resume();
	}

	private async rotateBackups(): Promise<void> {
		const dir = dirname(this.connection.databasePath);
		const prefix = `${basename(this.connection.databasePath)}.backup.`;
		const entries = await readdir(dir);
		const backups = entries
			.filter(entry => entry.startsWith(prefix))
			.sort()
			.reverse();

		for (const backup of backups.slice(3)) {
			await rm(join(dir, backup), { force: true }).catch(() => undefined);
		}
	}
}
