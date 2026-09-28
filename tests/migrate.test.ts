import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { runMigrations } from '../src/lib/server/migrate';

const dir = path.resolve(process.cwd(), 'migrations');
const tempDbs: Db[] = [];

function freshDb(): Db {
	const file = path.join(os.tmpdir(), `minsnooks-test-${Date.now()}-${Math.random()}.db`);
	const db = openDb(file);
	tempDbs.push(db);
	return db;
}

afterEach(() => {
	while (tempDbs.length) {
		const db = tempDbs.pop();
		try {
			const file = db!.name;
			db!.close();
			fs.rmSync(file, { force: true });
			fs.rmSync(`${file}-wal`, { force: true });
			fs.rmSync(`${file}-shm`, { force: true });
		} catch {
			/* best effort cleanup */
		}
	}
});

describe('runMigrations', () => {
	it('applies migrations to a fresh database and records them', () => {
		const db = freshDb();
		const applied = runMigrations(db, dir);
		expect(applied.length).toBeGreaterThan(0);
		expect(applied).toContain('0001_init.sql');

		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
			.all()
			.map((r) => (r as { name: string }).name);
		expect(tables).toContain('players');
		expect(tables).toContain('app_settings');
		expect(tables).toContain('_migrations');
	});

	it('is idempotent: re-running applies nothing', () => {
		const db = freshDb();
		runMigrations(db, dir);
		expect(runMigrations(db, dir)).toEqual([]);
	});

	it('rejects an edited migration that was already applied', () => {
		const db = freshDb();
		runMigrations(db, dir);
		db.prepare("UPDATE _migrations SET checksum = 'tampered' WHERE name = '0001_init.sql'").run();
		expect(() => runMigrations(db, dir)).toThrow(/has changed since it was applied/);
	});

	it('opens with foreign keys and WAL enabled', () => {
		const db = freshDb();
		expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
		expect(String(db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');
	});
});
