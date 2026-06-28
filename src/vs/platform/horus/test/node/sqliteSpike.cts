'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { performance } = require('perf_hooks');

const ROW_COUNT = 1000;
const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const dbDir = path.join(appData, '.horus');

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

function cleanDatabase(dbPath) {
	for (const suffix of ['', '-wal', '-shm']) {
		try {
			fs.rmSync(`${dbPath}${suffix}`, { force: true });
		} catch {
			// Ignore cleanup failures during spike setup.
		}
	}
}

function readChild(kind, dbPath) {
	const child = spawnSync(process.execPath, [...process.execArgv, __filename, '--child-read', kind, dbPath], {
		encoding: 'utf8',
		env: process.env
	});

	if (child.status !== 0) {
		throw new Error(`${kind} child read failed: ${child.stderr || child.stdout}`);
	}

	return JSON.parse(child.stdout);
}

function getSQLite3Module() {
	const sqlite3 = require('@vscode/sqlite3');
	return sqlite3.default ?? sqlite3;
}

function hasModule(name) {
	try {
		require.resolve(name);
		return true;
	} catch {
		return false;
	}
}

function openSQLite3(dbPath, mode) {
	const sqlite3 = getSQLite3Module();
	return new Promise((resolve, reject) => {
		const callback = error => {
			if (error) {
				reject(error);
			} else {
				resolve(db);
			}
		};
		const db = mode === undefined
			? new sqlite3.Database(dbPath, callback)
			: new sqlite3.Database(dbPath, mode, callback);
	});
}

function execSQLite3(db, sql) {
	return new Promise((resolve, reject) => {
		db.exec(sql, error => error ? reject(error) : resolve());
	});
}

function runSQLite3(db, sql, params = []) {
	return new Promise((resolve, reject) => {
		db.run(sql, params, function (error) {
			error ? reject(error) : resolve(this);
		});
	});
}

function getSQLite3(db, sql, params = []) {
	return new Promise((resolve, reject) => {
		db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
	});
}

function closeSQLite3(db) {
	return new Promise((resolve, reject) => {
		db.close(error => error ? reject(error) : resolve());
	});
}

async function runSQLite3Spike() {
	const sqlite3 = getSQLite3Module();
	const dbPath = path.join(dbDir, 'spike-vscode-sqlite3.db');
	cleanDatabase(dbPath);

	const writeDb = await openSQLite3(dbPath);
	const pragmas = await getSQLite3(writeDb, 'PRAGMA journal_mode = WAL;');
	await execSQLite3(writeDb, [
		'PRAGMA busy_timeout = 5000;',
		'PRAGMA foreign_keys = ON;',
		'PRAGMA synchronous = NORMAL;',
		'PRAGMA cache_size = -8000;',
		'PRAGMA wal_autocheckpoint = 1000;',
		'CREATE TABLE IF NOT EXISTS spike_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL);',
		'DELETE FROM spike_items;'
	].join('\n'));

	const started = performance.now();
	await execSQLite3(writeDb, 'BEGIN IMMEDIATE;');

	let readDuringWrite;
	for (let i = 1; i <= ROW_COUNT; i++) {
		await runSQLite3(writeDb, 'INSERT INTO spike_items (id, value) VALUES (?, ?);', [i, `value-${i}`]);
		if (i === Math.floor(ROW_COUNT / 2)) {
			readDuringWrite = readChild('sqlite3', dbPath);
		}
	}

	await execSQLite3(writeDb, 'COMMIT;');
	const elapsedMs = performance.now() - started;
	const finalRow = await getSQLite3(writeDb, 'SELECT COUNT(*) AS count FROM spike_items;');
	const foreignKeys = await getSQLite3(writeDb, 'PRAGMA foreign_keys;');
	await execSQLite3(writeDb, 'PRAGMA wal_checkpoint(TRUNCATE);');
	await closeSQLite3(writeDb);

	return {
		name: '@vscode/sqlite3',
		version: require('@vscode/sqlite3/package.json').version,
		journalMode: pragmas.journal_mode,
		foreignKeys: foreignKeys.foreign_keys,
		readDuringWrite,
		insertedRows: finalRow.count,
		elapsedMs: Math.round(elapsedMs)
	};
}

function runBetterSQLite3Spike() {
	const Database = require('better-sqlite3');
	const dbPath = path.join(dbDir, 'spike-better-sqlite3.db');
	cleanDatabase(dbPath);

	const db = new Database(dbPath);
	const journalMode = db.pragma('journal_mode = WAL', { simple: true });
	db.pragma('busy_timeout = 5000');
	db.pragma('foreign_keys = ON');
	db.pragma('synchronous = NORMAL');
	db.pragma('cache_size = -8000');
	db.pragma('wal_autocheckpoint = 1000');
	db.exec('CREATE TABLE IF NOT EXISTS spike_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL); DELETE FROM spike_items;');

	const insert = db.prepare('INSERT INTO spike_items (id, value) VALUES (?, ?);');
	let readDuringWrite;
	const started = performance.now();
	const transaction = db.transaction(() => {
		for (let i = 1; i <= ROW_COUNT; i++) {
			insert.run(i, `value-${i}`);
			if (i === Math.floor(ROW_COUNT / 2)) {
				readDuringWrite = readChild('better-sqlite3', dbPath);
			}
		}
	});
	transaction();

	const elapsedMs = performance.now() - started;
	const insertedRows = db.prepare('SELECT COUNT(*) AS count FROM spike_items;').get().count;
	const foreignKeys = db.pragma('foreign_keys', { simple: true });
	db.pragma('wal_checkpoint(TRUNCATE)');
	db.close();

	return {
		name: 'better-sqlite3',
		version: require('better-sqlite3/package.json').version,
		journalMode,
		foreignKeys,
		readDuringWrite,
		insertedRows,
		elapsedMs: Math.round(elapsedMs)
	};
}

async function childRead(kind, dbPath) {
	const started = performance.now();

	if (kind === 'sqlite3') {
		const sqlite3 = getSQLite3Module();
		const db = await openSQLite3(dbPath, sqlite3.OPEN_READONLY);
		await execSQLite3(db, 'PRAGMA busy_timeout = 5000;');
		const row = await getSQLite3(db, 'SELECT COUNT(*) AS count FROM spike_items;');
		await closeSQLite3(db);
		console.log(JSON.stringify({ count: row.count, elapsedMs: Math.round(performance.now() - started) }));
		return;
	}

	if (kind === 'better-sqlite3') {
		const Database = require('better-sqlite3');
		const db = new Database(dbPath, { readonly: true, fileMustExist: true });
		db.pragma('busy_timeout = 5000');
		const count = db.prepare('SELECT COUNT(*) AS count FROM spike_items;').get().count;
		db.close();
		console.log(JSON.stringify({ count, elapsedMs: Math.round(performance.now() - started) }));
		return;
	}

	throw new Error(`Unknown child read kind: ${kind}`);
}

async function main() {
	if (process.argv[2] === '--child-read') {
		await childRead(process.argv[3], process.argv[4]);
		return;
	}

	ensureDir(dbDir);

	const results = [];
	results.push(await runSQLite3Spike());
	if (hasModule('better-sqlite3')) {
		results.push(runBetterSQLite3Spike());
	} else {
		results.push({
			name: 'better-sqlite3',
			skipped: true,
			reason: 'Dependency is not installed in the final tree. Re-run `npm install --no-save better-sqlite3` to repeat the spike.'
		});
	}

	console.log(JSON.stringify({
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		dbDir,
		rows: ROW_COUNT,
		results
	}, null, 2));
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
