import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { runMigrations } from '../src/lib/server/migrate';
import { loadHomePageData } from '../src/lib/server/home-page';
import { seedAll } from '../src/lib/server/seed';

const databases: Db[] = [];

function freshDb(): Db {
	const file = path.join(os.tmpdir(), `minsnooks-home-${Date.now()}-${Math.random()}.db`);
	const db = openDb(file);
	databases.push(db);
	runMigrations(db, path.resolve(process.cwd(), 'migrations'));
	return db;
}

afterEach(() => {
	while (databases.length) {
		const db = databases.pop()!;
		const file = db.name;
		db.close();
		for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true });
	}
});

describe('league home page data', () => {
	it('loads the current round, season table, roster and progress from the seeded database', () => {
		const db = freshDb();
		seedAll(db);

		const data = loadHomePageData(db);

		expect(data.season?.label).toBe('2026');
		expect(data.currentRound?.number).toBe(6);
		expect(data.currentRound?.status).toBe('open');
		expect(data.roundRows).toHaveLength(8);
		expect(data.seasonRows).toHaveLength(8);
		expect(data.roundPlayers).toHaveLength(8);
		expect(data.roundPlayers.map((player) => player.name)).toContain('Maya Chen');
		expect(data.roundProgress).toMatchObject({ confirmed: 22, awarded: 2, unplayed: 4, total: 28 });
		expect(data.seasonProgress).toMatchObject({ confirmed: 138, awarded: 2, total: 168 });
		expect(data.roundRows[0]).toMatchObject({ name: 'Maya Chen', position: 1 });
		expect(data.seasonRows[0]).toMatchObject({ name: 'Maya Chen', position: 1 });
		expect(data.roundRows[0].playerId).toBe(
			data.roundPlayers.find((player) => player.name === 'Maya Chen')?.playerId
		);
		expect(new Set(data.roundRows.map((row) => row.playerId)).size).toBe(8);
	});

	it('returns a clear empty state when no season has been seeded', () => {
		const data = loadHomePageData(freshDb());

		expect(data.season).toBeNull();
		expect(data.currentRound).toBeNull();
		expect(data.roundRows).toEqual([]);
		expect(data.seasonRows).toEqual([]);
		expect(data.roundPlayers).toEqual([]);
		expect(data.seasonProgress.total).toBe(0);
	});
});
