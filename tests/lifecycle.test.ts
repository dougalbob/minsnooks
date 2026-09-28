import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { runMigrations } from '../src/lib/server/migrate';
import { closeFixtureNeutrally, createSeason, confirmResult, openRound, orderedPair, saveLeagueResult } from '../src/lib/server/league';
import {
	loadLifecycleDefaults,
	runRoundLifecycle,
	setRoundFinal,
	withdrawPlayerFromFutureRounds
} from '../src/lib/server/lifecycle';
import {
	deadlineAtForLocalDate,
	gracePeriodEndsAt,
	parseLocalDateTimeInput
} from '../src/lib/server/league-time';
import { computeStandings, loadSeason, roundProgress } from '../src/lib/server/standings';

const dbs: Db[] = [];

function freshDb(): Db {
	const file = path.join(os.tmpdir(), `minsnooks-lifecycle-${Date.now()}-${Math.random()}.db`);
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

function demoLeague(db: Db, count = 3) {
	const playerIds: number[] = [];
	const insertPlayer = db.prepare(
		'INSERT INTO players (email, display_name, initials, avatar_tone, role) VALUES (?, ?, ?, ?, ?)'
	);
	for (let index = 0; index < count; index++) {
		playerIds.push(
			Number(
				insertPlayer.run(
					`player-${index}@example.test`,
					`Player ${String.fromCharCode(65 + index)}`,
					`P${index}`,
					'maya',
					index === 0 ? 'admin' : 'player'
				).lastInsertRowid
			)
		);
	}
	const seasonId = createSeason(db, {
		label: 'Lifecycle test',
		framesPerMatch: 3,
		pointsPerFrame: 1,
		matchWinBonus: 0,
		timezone: 'Europe/London'
	});
	const deadlineAt = deadlineAtForLocalDate('2026-04-01', 'Europe/London');
	const roundId = openRound(db, {
		seasonId,
		number: 1,
		playerIds,
		deadlineAt,
		graceDays: 2,
		openedAt: '2026-03-15T12:00:00.000Z'
	});
	return { seasonId, roundId, playerIds, deadlineAt };
}

function fixtureBetween(db: Db, roundId: number, first: number, second: number): number {
	const [low, high] = orderedPair(first, second);
	return (
		db.prepare('SELECT id FROM fixtures WHERE round_id = ? AND player_low_id = ? AND player_high_id = ?').get(
			roundId,
			low,
			high
		) as { id: number }
	).id;
}

describe('league-local deadline handling', () => {
	it('stores the end of a local date and adds grace as calendar days across DST', () => {
		const beforeClockChange = deadlineAtForLocalDate('2026-03-28', 'Europe/London');
		const graceEnd = gracePeriodEndsAt(beforeClockChange, 1, 'Europe/London');

		expect(beforeClockChange).toBe('2026-03-28T23:59:59.000Z');
		expect(graceEnd.toISOString()).toBe('2026-03-29T22:59:59.000Z');
		expect(graceEnd.getTime() - new Date(beforeClockChange).getTime()).toBe(23 * 60 * 60 * 1000);
		expect(parseLocalDateTimeInput('2026-03-29T01:30', 'Europe/London')).toBeNull();
	});

	it('keeps a round snapshot immutable and enforces a single globally open round', () => {
		const db = freshDb();
		const { seasonId, roundId, playerIds, deadlineAt } = demoLeague(db);
		expect(openRound(db, { seasonId, number: 1, playerIds, deadlineAt, graceDays: 2 })).toBe(roundId);
		expect(() => openRound(db, { seasonId, number: 1, playerIds: playerIds.slice(0, 2), deadlineAt, graceDays: 2 })).toThrow(/snapshot cannot be changed/);
		expect(() => openRound(db, { seasonId, number: 2, playerIds, deadlineAt, graceDays: 2 })).toThrow(/still open/);

		db.prepare("UPDATE app_settings SET value = '14' WHERE key = 'round_duration_days'").run();
		db.prepare("UPDATE app_settings SET value = '0' WHERE key = 'round_grace_days'").run();
		const snapshot = loadSeason(db, seasonId)!.rounds[0];
		expect(snapshot.deadlineAt).toBe(deadlineAt);
		expect(snapshot.graceDays).toBe(2);
	});

	it('does not close awaiting-confirmation fixtures and advances only after confirmation', () => {
		const db = freshDb();
		const { seasonId, roundId, playerIds, deadlineAt } = demoLeague(db);
		const submittedFixture = fixtureBetween(db, roundId, playerIds[0], playerIds[1]);
		const { resultId } = saveLeagueResult(db, {
			fixtureId: submittedFixture,
			submittedByPlayerId: playerIds[0],
			lowFrames: 2,
			highFrames: 1,
			actualPlayedDate: '2026-03-20'
		}, { now: new Date('2026-03-25T12:00:00.000Z') });
		const closeAt = gracePeriodEndsAt(deadlineAt, 2, 'Europe/London');

		const atCutoff = runRoundLifecycle(db, { now: closeAt, trigger: 'admin' });
		expect(atCutoff.events).toEqual([]);
		expect(roundProgress(db, roundId)).toMatchObject({ awaitingConfirmation: 1, unplayed: 2, closedUnplayed: 0 });

		const afterGrace = new Date(closeAt.getTime() + 1);
		const firstRun = runRoundLifecycle(db, { now: afterGrace, trigger: 'admin' });
		expect(firstRun.events.filter((event) => event.kind === 'fixture_closed_neutrally')).toHaveLength(2);
		expect(roundProgress(db, roundId)).toMatchObject({ awaitingConfirmation: 1, unplayed: 0, closedUnplayed: 2 });
		expect((db.prepare('SELECT status FROM rounds WHERE id = ?').get(roundId) as { status: string }).status).toBe('open');
		expect(db.prepare('SELECT COUNT(*) AS count FROM results').get()).toEqual({ count: 1 });

		confirmResult(db, resultId, playerIds[1]);
		const confirmedRun = runRoundLifecycle(db, { now: afterGrace, trigger: 'admin' });
		expect(confirmedRun.events.map((event) => event.kind)).toContain('round_closed');
		expect(confirmedRun.events.map((event) => event.kind)).toContain('round_auto_opened');
		const season = loadSeason(db, seasonId)!;
		expect(season.rounds).toHaveLength(2);
		expect(season.rounds[0].status).toBe('closed');
		expect(season.rounds[1]).toMatchObject({ number: 2, status: 'open', graceDays: 7, playerCount: 3 });
		expect(season.rounds[1].deadlineAt).toBe('2026-05-01T22:59:59.000Z');

		const repeated = runRoundLifecycle(db, { now: afterGrace, trigger: 'admin' });
		expect(repeated.events).toEqual([]);
		expect(loadSeason(db, seasonId)!.rounds).toHaveLength(2);
	});


	it('rejects new play submissions after grace, even before the timer closes the fixture', () => {
		const db = freshDb();
		const { roundId, playerIds, deadlineAt } = demoLeague(db, 2);
		const fixtureId = fixtureBetween(db, roundId, playerIds[0], playerIds[1]);
		const cutoff = gracePeriodEndsAt(deadlineAt, 2, 'Europe/London');
		expect(() => saveLeagueResult(db, {
			fixtureId,
			submittedByPlayerId: playerIds[0],
			lowFrames: 2,
			highFrames: 1,
			actualPlayedDate: '2026-03-25'
		}, { now: new Date(cutoff.getTime() + 1) })).toThrow(/past its deadline and grace period/);
		expect(roundProgress(db, roundId).unplayed).toBe(1);
	});

	it('closes unplayed fixtures neutrally without creating a played 0–0', () => {
		const db = freshDb();
		const { roundId, deadlineAt } = demoLeague(db, 2);
		const fixtureId = fixtureBetween(db, roundId, 1, 2);
		const cutoff = gracePeriodEndsAt(deadlineAt, 2, 'Europe/London');
		expect(() => closeFixtureNeutrally(db, fixtureId, new Date(cutoff.getTime() - 1))).toThrow(/have not elapsed/);

		runRoundLifecycle(db, { now: new Date(cutoff.getTime() + 1), trigger: 'admin' });
		expect(db.prepare('SELECT COUNT(*) AS count FROM results').get()).toEqual({ count: 0 });
		expect(roundProgress(db, roundId)).toMatchObject({ closedUnplayed: 1, unplayed: 0, total: 1 });
		expect((db.prepare('SELECT state FROM fixtures WHERE id = ?').get(fixtureId) as { state: string }).state).toBe('closed_unplayed');
	});

	it('allows only an in-window admin retrospective result without reopening its round', () => {
		const db = freshDb();
		const { seasonId, roundId, playerIds, deadlineAt } = demoLeague(db, 2);
		const fixtureId = fixtureBetween(db, roundId, playerIds[0], playerIds[1]);
		const cutoff = gracePeriodEndsAt(deadlineAt, 2, 'Europe/London');
		runRoundLifecycle(db, { now: new Date(cutoff.getTime() + 1), trigger: 'admin' });

		expect(() => saveLeagueResult(db, {
			fixtureId,
			submittedByPlayerId: playerIds[0],
			lowFrames: 2,
			highFrames: 1,
			actualPlayedDate: '2026-04-04',
			entrySource: 'admin_retrospective'
		})).toThrow(/deadline and grace period/);
		expect(() => saveLeagueResult(db, {
			fixtureId,
			submittedByPlayerId: playerIds[0],
			lowFrames: 2,
			highFrames: 1,
			actualPlayedDate: '2026-03-25',
			entrySource: 'player'
		})).toThrow(/only accepts an admin retrospective/);

		const saved = saveLeagueResult(db, {
			fixtureId,
			submittedByPlayerId: playerIds[0],
			lowFrames: 2,
			highFrames: 1,
			actualPlayedDate: '2026-03-25',
			entrySource: 'admin_retrospective'
		});
		expect(saved.status).toBe('confirmed');
		expect((db.prepare('SELECT status FROM rounds WHERE id = ?').get(roundId) as { status: string }).status).toBe('closed');
		expect((db.prepare('SELECT state FROM fixtures WHERE id = ?').get(fixtureId) as { state: string }).state).toBe('confirmed');
		expect(computeStandings(db, { seasonId }).reduce((total, row) => total + row.played, 0)).toBe(2);
		expect(db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'retrospective_recorded'").get()).toEqual({ count: 1 });
	});

	it('marks a player withdrawn for future rounds while retaining the current snapshot', () => {
		const db = freshDb();
		const { seasonId, roundId, playerIds, deadlineAt } = demoLeague(db);
		const withdrawn = withdrawPlayerFromFutureRounds(db, {
			seasonId,
			playerId: playerIds[2],
			actorPlayerId: playerIds[0],
			reason: 'Fictional player withdrew'
		});
		expect(withdrawn).toMatchObject({ effectiveFromRound: 2, alreadyWithdrawn: false });
		expect(db.prepare('SELECT COUNT(*) AS count FROM round_players WHERE round_id = ?').get(roundId)).toEqual({ count: 3 });
		expect(db.prepare('SELECT withdrawn FROM round_players WHERE round_id = ? AND player_id = ?').get(roundId, playerIds[2])).toEqual({ withdrawn: 1 });
		expect(withdrawPlayerFromFutureRounds(db, {
			seasonId,
			playerId: playerIds[2],
			actorPlayerId: playerIds[0],
			reason: 'Repeat request'
		})).toMatchObject({ effectiveFromRound: 2, alreadyWithdrawn: true });

		const cutoff = gracePeriodEndsAt(deadlineAt, 2, 'Europe/London');
		runRoundLifecycle(db, { now: new Date(cutoff.getTime() + 1), trigger: 'admin' });
		const season = loadSeason(db, seasonId)!;
		expect(season.rounds[0].playerCount).toBe(3);
		expect(season.rounds[1].playerCount).toBe(2);
		expect(db.prepare('SELECT COUNT(*) AS count FROM fixtures WHERE round_id = ?').get(season.rounds[1].roundId)).toEqual({ count: 1 });
		expect(db.prepare('SELECT COUNT(*) AS count FROM fixtures WHERE round_id = ? AND (player_low_id = ? OR player_high_id = ?)').get(season.rounds[1].roundId, playerIds[2], playerIds[2])).toEqual({ count: 0 });
	});

	it('does not open another round or season after a final round resolves', () => {
		const db = freshDb();
		const { seasonId, roundId, playerIds, deadlineAt } = demoLeague(db, 2);
		setRoundFinal(db, roundId, true, playerIds[0]);
		const cutoff = gracePeriodEndsAt(deadlineAt, 2, 'Europe/London');
		const run = runRoundLifecycle(db, { now: new Date(cutoff.getTime() + 1), trigger: 'admin' });
		expect(run.events.map((event) => event.kind)).toContain('final_round_resolved');
		expect(loadSeason(db, seasonId)!.rounds).toHaveLength(1);
		expect(db.prepare('SELECT COUNT(*) AS count FROM seasons').get()).toEqual({ count: 1 });
		expect(db.prepare("SELECT COUNT(*) AS count FROM rounds WHERE status = 'open'").get()).toEqual({ count: 0 });
	});

	it('uses the snapshotted defaults when it automatically opens the next round', () => {
		const db = freshDb();
		const { seasonId, roundId, playerIds, deadlineAt } = demoLeague(db, 2);
		db.prepare("UPDATE app_settings SET value = '10' WHERE key = 'round_duration_days'").run();
		db.prepare("UPDATE app_settings SET value = '4' WHERE key = 'round_grace_days'").run();
		const cutoff = gracePeriodEndsAt(deadlineAt, 2, 'Europe/London');
		runRoundLifecycle(db, { now: new Date(cutoff.getTime() + 1), trigger: 'admin' });
		const next = loadSeason(db, seasonId)!.rounds[1];
		expect(next.graceDays).toBe(4);
		expect(next.deadlineAt).toBe('2026-04-13T22:59:59.000Z');
		expect(loadLifecycleDefaults(db)).toEqual({ roundDurationDays: 10, graceDays: 4 });
		expect(next.playerCount).toBe(playerIds.length);
	});
});

