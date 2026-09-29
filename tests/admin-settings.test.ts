import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { runMigrations } from '../src/lib/server/migrate';
import { loadAdminSettings, saveAdminSettings, validateAdminSettings } from '../src/lib/server/admin-settings';
import { loadLifecycleDefaults } from '../src/lib/server/lifecycle';
import { createSeason, openRound } from '../src/lib/server/league';
import { applySecurityHeaders, consumeWriteRateLimit } from '../src/lib/server/security';

const dbs: Db[] = [];
function freshDb(): Db {
	const file = path.join(os.tmpdir(), `minsnooks-admin-settings-${Date.now()}-${Math.random()}.db`);
	const db = openDb(file);
	dbs.push(db);
	runMigrations(db, path.resolve(process.cwd(), 'migrations'));
	return db;
}
afterEach(() => {
	while (dbs.length) {
		const db = dbs.pop()!;
		const file = db.name;
		db.close();
		for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true });
	}
});

function valid(overrides: Partial<ReturnType<typeof loadAdminSettings>> = {}) {
	return validateAdminSettings({
		roundDurationDays: 28,
		graceDays: 7,
		timezone: 'Europe/London',
		contactVisibilityDefault: true,
		...overrides
	});
}

describe('Phase 15 settings', () => {
	it('loads safe migrated defaults and persists validated values with an audit entry', () => {
		const db = freshDb();
		const actor = Number(db.prepare("INSERT INTO players(email,display_name,initials,role) VALUES('admin@test','Admin','AD','admin')").run().lastInsertRowid);
		expect(loadAdminSettings(db)).toEqual({ roundDurationDays: 28, graceDays: 7, timezone: 'Europe/London', contactVisibilityDefault: true });
		saveAdminSettings(db, valid({ roundDurationDays: 35, graceDays: 4, timezone: 'Europe/Paris', contactVisibilityDefault: false }), actor);
		expect(loadAdminSettings(db)).toEqual({ roundDurationDays: 35, graceDays: 4, timezone: 'Europe/Paris', contactVisibilityDefault: false });
		expect(loadLifecycleDefaults(db)).toEqual({ roundDurationDays: 35, graceDays: 4 });
		const audit = db.prepare("SELECT action, actor_player_id, detail FROM audit_log WHERE entity_type = 'app_settings'").get() as { action: string; actor_player_id: number; detail: string };
		expect(audit.action).toBe('updated');
		expect(audit.actor_player_id).toBe(actor);
		expect(JSON.parse(audit.detail).timezone).toBe('Europe/Paris');
	});

	it('rejects invalid ranges and invalid timezone names', () => {
		expect(() => valid({ roundDurationDays: 0 })).toThrow(/1 to 180/);
		expect(() => valid({ graceDays: 91 })).toThrow(/0 to 90/);
		expect(() => valid({ timezone: 'Mars/Olympus' })).toThrow(/IANA timezone/);
	});

	it('uses changed defaults for newly opened rounds without rewriting existing snapshots', () => {
		const db = freshDb();
		const players = [
			Number(db.prepare("INSERT INTO players(email,display_name,initials) VALUES('a@test','A','A')").run().lastInsertRowid),
			Number(db.prepare("INSERT INTO players(email,display_name,initials) VALUES('b@test','B','B')").run().lastInsertRowid)
		];
		const seasonId = createSeason(db, { label: '2026', framesPerMatch: 3, pointsPerFrame: 1, matchWinBonus: 0 });
		expect(createSeason(db, { label: '2026', framesPerMatch: 3, pointsPerFrame: 1, matchWinBonus: 0 })).toBe(seasonId);
		expect(() => createSeason(db, { label: '2026', framesPerMatch: 5, pointsPerFrame: 2, matchWinBonus: 1 })).toThrow(/frozen/);
		const first = openRound(db, { seasonId, number: 1, playerIds: players, deadlineAt: '2026-04-01T23:59:59.000Z', graceDays: 7 });
		saveAdminSettings(db, valid({ roundDurationDays: 42, graceDays: 3, timezone: 'Europe/Paris' }), 1);
		const original = db.prepare('SELECT deadline_at, grace_days FROM rounds WHERE id = ?').get(first) as { deadline_at: string; grace_days: number };
		expect(original).toEqual({ deadline_at: '2026-04-01T23:59:59.000Z', grace_days: 7 });
		expect(loadLifecycleDefaults(db)).toEqual({ roundDurationDays: 42, graceDays: 3 });
		expect((db.prepare('SELECT timezone FROM seasons WHERE id = ?').get(seasonId) as { timezone: string }).timezone).toBe('Europe/London');
	});

	it('applies hardening headers and a production CSP without caching responses', () => {
		const response = applySecurityHeaders(new Response('ok'), true);
		expect(response.headers.get('Cache-Control')).toBe('private, no-store');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(response.headers.get('X-Frame-Options')).toBe('DENY');
		expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
		expect(response.headers.get('Content-Security-Policy')).toContain("object-src 'none'");
		expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
	});

	it('enforces shared per-identity write ceilings and resets the fixed window', () => {
		const db = freshDb();
		for (let i = 0; i < 3; i++) expect(consumeWriteRateLimit(db, 'PLAYER@example.test', '/admin/settings', { now: 1_000, limit: 3, windowMs: 1_000 })).toBe(true);
		expect(consumeWriteRateLimit(db, 'player@example.test', '/admin/settings', { now: 1_000, limit: 3, windowMs: 1_000 })).toBe(false);
		expect(consumeWriteRateLimit(db, 'player@example.test', '/admin/settings', { now: 2_000, limit: 3, windowMs: 1_000 })).toBe(true);
		expect(consumeWriteRateLimit(db, 'player@example.test', '/admin/reports', { now: 1_000, limit: 3, windowMs: 1_000 })).toBe(true);
	});

	it('rate-limits rapid settings edits and leaves values unchanged when rejected', () => {
		const db = freshDb();
		const actor = Number(db.prepare("INSERT INTO players(email,display_name,initials,role) VALUES('admin@test','Admin','AD','admin')").run().lastInsertRowid);
		for (let i = 0; i < 10; i++) saveAdminSettings(db, valid({ roundDurationDays: 30 + i }), actor);
		expect(() => saveAdminSettings(db, valid({ roundDurationDays: 90 }), actor)).toThrow(/too quickly/);
		expect(loadAdminSettings(db).roundDurationDays).toBe(39);
		expect((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'app_settings'").get() as { n: number }).n).toBe(10);
	});
});
