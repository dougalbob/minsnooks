import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { runMigrations } from './migrate';

export type Db = Database.Database;

let singleton: Db | null = null;

export function databasePath(env: NodeJS.ProcessEnv = process.env): string {
	return env.DATABASE_PATH ?? path.join('data', 'minsnooks.db');
}

/**
 * Open the SQLite database with the pragmas required by HANDOFF §9:
 * foreign keys enforced, WAL journaling, and a busy timeout so concurrent
 * reads/writes wait instead of failing immediately.
 */
export function openDb(filePath: string): Db {
	fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
	const db = new Database(filePath);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	db.pragma('busy_timeout = 5000');
	return db;
}

/** App-wide database handle. Migrations run on first open (idempotent). */
export function getDb(): Db {
	if (!singleton) {
		const db = openDb(databasePath());
		runMigrations(db, migrationsDir());
		singleton = db;
	}
	return singleton;
}

export function migrationsDir(): string {
	return path.resolve(process.cwd(), 'migrations');
}

/** Test helper: drop the cached handle (does not close the file elsewhere). */
export function closeDb(): void {
	if (singleton) {
		singleton.close();
		singleton = null;
	}
}
