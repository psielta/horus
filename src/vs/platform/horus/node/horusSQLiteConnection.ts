import { mkdir, copyFile, rm } from 'fs/promises';
import { dirname } from '../../../base/common/path.js';

type SQLite3Module = typeof import('@vscode/sqlite3');
type SQLiteDatabase = import('@vscode/sqlite3').Database;
type SQLite3Import = SQLite3Module & { readonly default?: SQLite3Module };

export type HorusSQLiteRow = Record<string, unknown>;

interface SQLiteBackup {
	step(pages: number, callback: (error: Error | null) => void): void;
	finish(callback: (error: Error | null) => void): void;
}

interface SQLiteDatabaseWithBackup {
	backup(filename: string, callback?: (error: Error | null) => void): SQLiteBackup;
}

export class HorusSQLiteConnection {

	private sqlite3: SQLite3Module | undefined;
	private writeDb: SQLiteDatabase | undefined;
	private readDb: SQLiteDatabase | undefined;

	constructor(readonly databasePath: string) { }

	async open(): Promise<void> {
		await mkdir(dirname(this.databasePath), { recursive: true });

		const sqlite3 = await this.getSQLite3();
		this.writeDb = await this.openDatabase(this.databasePath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
		await this.configureConnection(this.writeDb, true);

		this.readDb = await this.openDatabase(this.databasePath, sqlite3.OPEN_READONLY);
		await this.configureConnection(this.readDb, false);
	}

	async reopen(): Promise<void> {
		await this.close();
		await this.open();
	}

	async close(): Promise<void> {
		const readDb = this.readDb;
		const writeDb = this.writeDb;
		this.readDb = undefined;
		this.writeDb = undefined;

		await Promise.all([
			readDb ? this.closeDatabase(readDb) : undefined,
			writeDb ? this.closeDatabase(writeDb) : undefined
		]);
	}

	async exec(sql: string, target: 'read' | 'write' = 'write'): Promise<void> {
		const db = this.getConnection(target);
		return new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
	}

	async run(sql: string, params: readonly unknown[] = []): Promise<void> {
		const db = this.getConnection('write');
		return new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
	}

	async get<T extends object = HorusSQLiteRow>(sql: string, params: readonly unknown[] = [], target: 'read' | 'write' = 'read'): Promise<T | undefined> {
		const db = this.getConnection(target);
		return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row as T | undefined)));
	}

	async all<T extends object = HorusSQLiteRow>(sql: string, params: readonly unknown[] = [], target: 'read' | 'write' = 'read'): Promise<T[]> {
		const db = this.getConnection(target);
		return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows as T[])));
	}

	async transaction<T>(operation: () => Promise<T>): Promise<T> {
		await this.exec('BEGIN IMMEDIATE;', 'write');
		try {
			const result = await operation();
			await this.exec('COMMIT;', 'write');
			return result;
		} catch (error) {
			await this.exec('ROLLBACK;', 'write').catch(() => undefined);
			throw error;
		}
	}

	async checkpointTruncate(): Promise<void> {
		await this.exec('PRAGMA wal_checkpoint(TRUNCATE);', 'write');
	}

	async backupTo(destinationPath: string): Promise<void> {
		const db = this.getConnection('write') as SQLiteDatabase & SQLiteDatabaseWithBackup;
		await mkdir(dirname(destinationPath), { recursive: true });

		await new Promise<void>((resolve, reject) => {
			const backup = db.backup(destinationPath);
			backup.step(-1, stepError => {
				if (stepError) {
					backup.finish(() => reject(stepError));
				} else {
					backup.finish(finishError => finishError ? reject(finishError) : resolve());
				}
			});
		});
	}

	async replaceDatabaseFromBackup(backupPath: string): Promise<void> {
		await this.close();
		await rm(`${this.databasePath}-wal`, { force: true }).catch(() => undefined);
		await rm(`${this.databasePath}-shm`, { force: true }).catch(() => undefined);
		await copyFile(backupPath, this.databasePath);
		await this.open();
	}

	private async getSQLite3(): Promise<SQLite3Module> {
		if (!this.sqlite3) {
			const sqlite3 = await import('@vscode/sqlite3') as SQLite3Import;
			this.sqlite3 = sqlite3.default ?? sqlite3;
		}

		return this.sqlite3;
	}

	private async openDatabase(path: string, mode: number): Promise<SQLiteDatabase> {
		const sqlite3 = await this.getSQLite3();
		return new Promise((resolve, reject) => {
			const db = new sqlite3.Database(path, mode, error => error ? reject(error) : resolve(db));
		});
	}

	private async configureConnection(db: SQLiteDatabase, writeConnection: boolean): Promise<void> {
		const pragmas = [
			'PRAGMA busy_timeout = 5000;',
			'PRAGMA foreign_keys = ON;',
			'PRAGMA synchronous = NORMAL;',
			'PRAGMA cache_size = -8000;',
			'PRAGMA wal_autocheckpoint = 1000;'
		];

		if (writeConnection) {
			pragmas.unshift('PRAGMA journal_mode = WAL;');
		}

		await new Promise<void>((resolve, reject) => db.exec(pragmas.join('\n'), error => error ? reject(error) : resolve()));
	}

	private closeDatabase(db: SQLiteDatabase): Promise<void> {
		return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
	}

	private getConnection(target: 'read' | 'write'): SQLiteDatabase {
		const db = target === 'read' ? this.readDb : this.writeDb;
		if (!db) {
			throw new Error(`Horus SQLite ${target} connection is not open`);
		}

		return db;
	}
}
