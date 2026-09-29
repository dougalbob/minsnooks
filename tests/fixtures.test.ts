import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { runMigrations } from '../src/lib/server/migrate';
import { createSeason, openRound, orderedPair, saveLeagueResult } from '../src/lib/server/league';
import {
	BookingPermissionError,
	canManageBooking,
	cancelBooking,
	loadActiveBooking,
	loadBookingHistory,
	proposeBooking
} from '../src/lib/server/bookings';
import {
	loadFixtureDetailData,
	loadFixturesPageData,
	loadResultsArchive,
	roundPlayableWindowEnd
} from '../src/lib/server/fixtures-page';
import { computeStandings, loadSeason } from '../src/lib/server/standings';
import { seedAll } from '../src/lib/server/seed';
import { loadViewerPlayer } from '../src/lib/server/viewer';

const migrations = path.resolve(process.cwd(), 'migrations');
const databases: Db[] = [];

function freshDb(): Db {
	const file = path.join(os.tmpdir(), `minsnooks-fixtures-${Date.now()}-${Math.random()}.db`);
	const db = openDb(file);
	databases.push(db);
	runMigrations(db, migrations);
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

interface TinyLeague {
	seasonId: number;
	roundId: number;
	ids: Record<'alpha' | 'bravo' | 'charlie' | 'delta', number>;
}

/** Four-player league. `alpha` is an admin, the rest are ordinary players. */
function tinyLeague(db: Db): TinyLeague {
	const ids = {} as TinyLeague['ids'];
	const insert = db.prepare(
		'INSERT INTO players (email, display_name, initials, avatar_tone, role) VALUES (?, ?, ?, ?, ?)'
	);
	for (const key of ['alpha', 'bravo', 'charlie', 'delta'] as const) {
		ids[key] = Number(
			insert.run(
				`${key}@example.test`,
				key[0].toUpperCase() + key.slice(1),
				key.slice(0, 2).toUpperCase(),
				'maya',
				key === 'alpha' ? 'admin' : 'player'
			).lastInsertRowid
		);
	}
	const seasonId = createSeason(db, {
		label: 'fixtures test',
		framesPerMatch: 3,
		pointsPerFrame: 1,
		matchWinBonus: 0
	});
	const roundId = openRound(db, {
		seasonId,
		number: 1,
		playerIds: Object.values(ids),
		deadlineAt: '2026-10-15T22:59:59.000Z',
		graceDays: 7,
		openedAt: '2026-04-01T00:00:00.000Z'
	});
	return { seasonId, roundId, ids };
}

function fixtureBetween(db: Db, roundId: number, a: number, b: number): number {
	const [low, high] = orderedPair(a, b);
	const row = db
		.prepare('SELECT id FROM fixtures WHERE round_id = ? AND player_low_id = ? AND player_high_id = ?')
		.get(roundId, low, high) as { id: number };
	return row.id;
}

function countRows(db: Db, table: string): number {
	return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe('planned dates (bookings)', () => {
	it('saves a plan without creating a result, moving the table or resolving the fixture', () => {
		const db = freshDb();
		const { seasonId, roundId, ids } = tinyLeague(db);
		const fixtureId = fixtureBetween(db, roundId, ids.bravo, ids.charlie);
		const before = computeStandings(db, { seasonId, roundId });

		const result = proposeBooking(
			db,
			{
				fixtureId,
				actorPlayerId: ids.bravo,
				date: '2026-04-18',
				time: '19:30',
				note: 'Club, table 2'
			},
			{ now: new Date('2026-04-10T09:00:00Z') }
		);

		expect(result.replaced).toBe(false);
		expect(result.afterWindow).toBe(false);
		// No result of any kind: a plan is not a played match.
		expect(countRows(db, 'results')).toBe(0);
		expect(countRows(db, 'result_frames')).toBe(0);
		expect(db.prepare('SELECT state FROM fixtures WHERE id = ?').get(fixtureId)).toEqual({
			state: 'unplayed'
		});
		// The fixture's planned-date mirror is set; the standings are untouched.
		expect(db.prepare('SELECT booked_date FROM fixtures WHERE id = ?').get(fixtureId)).toEqual({
			booked_date: '2026-04-18'
		});
		expect(computeStandings(db, { seasonId, roundId })).toEqual(before);

		const active = loadActiveBooking(db, fixtureId);
		expect(active).toMatchObject({
			proposedDate: '2026-04-18',
			proposedTime: '19:30',
			note: 'Club, table 2',
			proposedByPlayerId: ids.bravo,
			status: 'proposed'
		});
		// The write is auditable.
		const audit = db
			.prepare("SELECT action, actor_player_id FROM audit_log WHERE entity_type = 'booking' ORDER BY id")
			.all() as Array<{ action: string; actor_player_id: number }>;
		expect(audit).toEqual([{ action: 'proposed', actor_player_id: ids.bravo }]);
	});

	it('never treats the planned date as the actual date played', () => {
		const db = freshDb();
		const { roundId, seasonId, ids } = tinyLeague(db);
		const fixtureId = fixtureBetween(db, roundId, ids.bravo, ids.delta);
		proposeBooking(
			db,
			{ fixtureId, actorPlayerId: ids.bravo, date: '2026-04-18', time: '19:30' },
			{ now: new Date('2026-04-10T09:00:00Z') }
		);
		// The match is actually played two days later than planned.
		saveLeagueResult(db, {
			fixtureId,
			submittedByPlayerId: ids.bravo,
			lowFrames: 2,
			highFrames: 1,
			actualPlayedDate: '2026-04-20',
			entrySource: 'admin_direct'
		});

		const stored = db
			.prepare('SELECT actual_played_date FROM results WHERE fixture_id = ?')
			.get(fixtureId) as { actual_played_date: string };
		expect(stored.actual_played_date).toBe('2026-04-20');

		const season = loadSeason(db, seasonId)!;
		const detail = loadFixtureDetailData(db, { fixtureId, viewer: null })!;
		expect(detail.frames).toEqual([]);
		expect(detail.fixture.plannedDate).toBeNull(); // private pending plan is hidden from visitors
        expect((db.prepare('SELECT proposed_date FROM bookings WHERE fixture_id=?').get(fixtureId) as {proposed_date:string}).proposed_date).toBe('2026-04-18');
		expect(detail.fixture.result?.actualPlayedDate).toBe('2026-04-20');
		expect(detail.fixture.state).toBe('confirmed');
		expect(season.rounds).toHaveLength(1);
	});

	it('keeps history when a plan is changed, and clears the plan when cancelled', () => {
		const db = freshDb();
		const { roundId, ids } = tinyLeague(db);
		const fixtureId = fixtureBetween(db, roundId, ids.bravo, ids.charlie);
		const now = new Date('2026-04-10T09:00:00Z');

		proposeBooking(db, { fixtureId, actorPlayerId: ids.bravo, date: '2026-04-18' }, { now });
		const changed = proposeBooking(
			db,
			{
				fixtureId,
				actorPlayerId: ids.charlie,
				date: '2026-04-25',
				time: '14:00'
			},
			{ now }
		);
		expect(changed.replaced).toBe(true);

		const history = loadBookingHistory(db, fixtureId);
		expect(history).toHaveLength(2);
		expect(history[0]).toMatchObject({ proposedDate: '2026-04-25', status: 'proposed' });
		expect(history[1]).toMatchObject({
			proposedDate: '2026-04-18',
			status: 'cancelled',
			cancelReason: 'Replaced by a newer planned date'
		});
		expect(
			db
				.prepare("SELECT COUNT(*) AS n FROM bookings WHERE fixture_id = ? AND status = 'proposed'")
				.get(fixtureId)
		).toEqual({ n: 1 });
		expect(loadActiveBooking(db, fixtureId)?.proposedDate).toBe('2026-04-25');
		expect(db.prepare('SELECT booked_date FROM fixtures WHERE id = ?').get(fixtureId)).toEqual({
			booked_date: '2026-04-25'
		});

		expect(cancelBooking(db, { fixtureId, actorPlayerId: ids.charlie, reason: 'Rail strike' }, { now })).toEqual(
			{ cancelled: true }
		);
		expect(loadActiveBooking(db, fixtureId)).toBeNull();
		expect(db.prepare('SELECT booked_date FROM fixtures WHERE id = ?').get(fixtureId)).toEqual({
			booked_date: null
		});
		expect(loadBookingHistory(db, fixtureId)[0]).toMatchObject({
			status: 'cancelled',
			cancelReason: 'Rail strike',
			cancelledByPlayerId: ids.charlie
		});
		// Nothing left to cancel.
		expect(cancelBooking(db, { fixtureId, actorPlayerId: ids.charlie }, { now })).toEqual({
			cancelled: false
		});
	});

	it('only allows the two players in the fixture, or an admin override', () => {
		const db = freshDb();
		const { roundId, ids } = tinyLeague(db);
		const fixtureId = fixtureBetween(db, roundId, ids.bravo, ids.charlie);
		const now = new Date('2026-04-10T09:00:00Z');

		// A player outside the fixture cannot touch its plan. The error type is
		// distinguishable so the route can answer 403 rather than 400.
		expect(() =>
			proposeBooking(db, { fixtureId, actorPlayerId: ids.delta, date: '2026-04-18' }, { now })
		).toThrow(BookingPermissionError);
		expect(() =>
			cancelBooking(db, { fixtureId, actorPlayerId: ids.delta }, { now })
		).toThrow(/Only the two players in this fixture/);
		expect(canManageBooking(db, fixtureId, ids.delta)).toMatchObject({
			allowed: false,
			participant: false,
			adminOverride: false
		});
		// No identity at all: nothing to act as.
		expect(canManageBooking(db, fixtureId, null).reason).toMatch(/Sign in/);

		// Either participant may do it.
		expect(canManageBooking(db, fixtureId, ids.bravo)).toMatchObject({ allowed: true, participant: true });
		proposeBooking(db, { fixtureId, actorPlayerId: ids.charlie, date: '2026-04-18' }, { now });
		expect(loadActiveBooking(db, fixtureId)?.proposedByPlayerId).toBe(ids.charlie);

		// An admin who is not in the fixture may manage it as an override, and the
		// audit entry records that it was an override.
		expect(canManageBooking(db, fixtureId, ids.alpha)).toMatchObject({
			allowed: true,
			adminOverride: true
		});
		proposeBooking(
			db,
			{ fixtureId, actorPlayerId: ids.alpha, date: '2026-04-19', time: '20:00' },
			{ now }
		);
		const lastAudit = db
			.prepare("SELECT detail FROM audit_log WHERE entity_type = 'booking' ORDER BY id DESC LIMIT 1")
			.get() as { detail: string };
		expect(JSON.parse(lastAudit.detail).adminOverride).toBe(true);
	});

	it('refuses to arrange a date for a resolved fixture or a closed round', () => {
		const db = freshDb();
		const { roundId, ids } = tinyLeague(db);
		const now = new Date('2026-04-10T09:00:00Z');
		const playedFixture = fixtureBetween(db, roundId, ids.bravo, ids.delta);
		saveLeagueResult(db, {
			fixtureId: playedFixture,
			submittedByPlayerId: ids.bravo,
			lowFrames: 2,
			highFrames: 1,
			actualPlayedDate: '2026-04-09',
			entrySource: 'admin_direct'
		});
		expect(() =>
			proposeBooking(db, { fixtureId: playedFixture, actorPlayerId: ids.bravo, date: '2026-04-30' }, { now })
		).toThrow(/already resolved/);

		db.prepare("UPDATE rounds SET status = 'closed' WHERE id = ?").run(roundId);
		const openFixture = fixtureBetween(db, roundId, ids.bravo, ids.charlie);
		expect(() =>
			proposeBooking(db, { fixtureId: openFixture, actorPlayerId: ids.bravo, date: '2026-04-30' }, { now })
		).toThrow(/is closed; its fixtures no longer take new dates/);
	});

	it('validates the planned date and flags a plan outside the round window', () => {
		const db = freshDb();
		const { roundId, ids } = tinyLeague(db);
		const fixtureId = fixtureBetween(db, roundId, ids.bravo, ids.charlie);
		const now = new Date('2026-04-10T09:00:00Z');

		expect(() =>
			proposeBooking(db, { fixtureId, actorPlayerId: ids.bravo, date: '18/04/2026' }, { now })
		).toThrow(/valid planned date/);
		expect(() =>
			proposeBooking(db, { fixtureId, actorPlayerId: ids.bravo, date: '2026-02-30' }, { now })
		).toThrow(/valid planned date/);
		expect(() =>
			proposeBooking(db, { fixtureId, actorPlayerId: ids.bravo, date: '2026-04-18', time: '7pm' }, { now })
		).toThrow(/valid time/);
		// Before the round opened, and in the past, are both refused.
		expect(() =>
			proposeBooking(db, { fixtureId, actorPlayerId: ids.bravo, date: '2026-03-10' }, { now })
		).toThrow(/cannot be before Round 1 opened/);
		expect(() =>
			proposeBooking(db, { fixtureId, actorPlayerId: ids.bravo, date: '2026-04-05' }, { now })
		).toThrow(/cannot be in the past/);

		// Deadline 2026-10-15 + 7 days' grace = playable to 2026-10-22. A plan after
		// that is still saved, but flagged so the players are warned.
		const late = proposeBooking(
			db,
			{ fixtureId, actorPlayerId: ids.bravo, date: '2026-11-05' },
			{ now }
		);
		expect(late.afterWindow).toBe(true);
		expect(loadActiveBooking(db, fixtureId)?.proposedDate).toBe('2026-11-05');
	});

	it('allows exactly one active plan per fixture at the database level', () => {
		const db = freshDb();
		const { roundId, ids } = tinyLeague(db);
		const fixtureId = fixtureBetween(db, roundId, ids.bravo, ids.charlie);
		proposeBooking(
			db,
			{ fixtureId, actorPlayerId: ids.bravo, date: '2026-04-18' },
			{ now: new Date('2026-04-10T09:00:00Z') }
		);
		expect(() =>
			db
				.prepare(
					"INSERT INTO bookings (fixture_id, proposed_date, proposed_by_player_id) VALUES (?, ?, ?)"
				)
				.run(fixtureId, '2026-04-19', ids.charlie)
		).toThrow(/UNIQUE/);
		// A cancelled plan is fine alongside the active one — that is the history.
		expect(() =>
			db
				.prepare(
					"INSERT INTO bookings (fixture_id, proposed_date, proposed_by_player_id, status) VALUES (?, ?, ?, 'cancelled')"
				)
				.run(fixtureId, '2026-04-20', ids.charlie)
		).not.toThrow();
	});
});

describe('fixtures page data', () => {
	function seeded() {
		const db = freshDb();
		seedAll(db);
		const seasonRow = db.prepare('SELECT id FROM seasons ORDER BY id DESC LIMIT 1').get() as { id: number };
		const season = loadSeason(db, seasonRow.id)!;
		return { db, season };
	}

	it('loads the current round, its outstanding fixtures and the seeded plan', () => {
		const { db, season } = seeded();
		const maya = loadViewerPlayer(db, 'maya.chen@example.test')!;
		const page = loadFixturesPageData(db, { viewer: maya });

		expect(page.tab).toBe('fixtures');
		expect(page.currentRound?.number).toBe(6);
		expect(page.fixtures).toHaveLength(28);
		expect(page.outstanding).toBe(4);
		expect(page.currentRound?.progress).toMatchObject({ confirmed: 22, awarded: 2, unplayed: 4, total: 28 });

		// The seeded plan matches the approved prototype: one arranged Round 6
		// fixture, Leon Park vs Owen Brooks, Saturday 3 October at 4:00 pm.
		const arranged = page.fixtures.filter((fixture) => fixture.plannedDate);
		expect(arranged).toHaveLength(1);
		expect(arranged[0].plannedDate).toMatchObject({
			date: '2026-10-03',
			time: '16:00',
			proposedByName: 'Owen Brooks',
			afterWindow: false
		});
		expect([arranged[0].low.name, arranged[0].high.name]).toEqual(['Leon Park', 'Owen Brooks']);

		// The viewer's own fixtures come first: Maya plays all seven opponents in
		// the round, so all seven of her fixtures are flagged as hers.
		expect(page.fixtures[0].isMine).toBe(true);
		expect(page.fixtures.filter((fixture) => fixture.isMine)).toHaveLength(7);
		expect(
			page.fixtures
				.filter((fixture) => fixture.isMine)
				.map((fixture) => [fixture.low.name, fixture.high.name])
				.every((pair) => pair.includes('Maya Chen'))
		).toBe(true);
		expect([page.fixtures[0].low.name, page.fixtures[0].high.name]).toEqual([
			'Maya Chen',
			'Priya Desai'
		]);
		expect(page.fixtures[0].canManage).toBe(true);

		// Awarded fixtures carry their award and no result; closed fixtures are
		// explicitly "not played", never a 0–0.
		const awarded = page.fixtures.filter((fixture) => fixture.state === 'awarded');
		expect(awarded).toHaveLength(2);
		expect(awarded.map((fixture) => fixture.award?.playerName).sort()).toEqual([
			'Jules Rivera',
			'Noah Kim'
		]);
		expect(awarded.every((fixture) => fixture.result === null)).toBe(true);
		expect(page.fixtures.every((fixture) => fixture.result?.lowFrames !== 0 || fixture.result?.highFrames !== 0)).toBe(true);
		expect(season.rounds).toHaveLength(6);
	});

	it('builds the results archive from confirmed results only, newest first', () => {
		const { db, season } = seeded();
		const maya = loadViewerPlayer(db, 'maya.chen@example.test')!;
		const page = loadFixturesPageData(db, { viewer: maya, tab: 'results' });
		const archive = page.archive!;

		expect(archive.roundNumber).toBe(6);
		expect(archive.isCurrentRound).toBe(true);
		expect(archive.results).toHaveLength(22);
		expect(archive.results.every((result) => result.status === 'confirmed')).toBe(true);
		expect(archive.awaitingConfirmation).toBe(0);
		// Newest actual date first, and each row's winner holds the higher score.
		expect(archive.results[0].actualPlayedDate).toBe('2026-09-26');
		for (let index = 1; index < archive.results.length; index++) {
			expect(archive.results[index - 1].actualPlayedDate >= archive.results[index].actualPlayedDate).toBe(
				true
			);
		}
		expect(archive.results.every((result) => result.winnerFrames > result.loserFrames)).toBe(true);
		expect(archive.viewerPlayedCount).toBe(6);
		// Round 6 is the last round, so there is no "next".
		expect(archive.nextRoundNumber).toBeNull();
		expect(archive.previousRoundNumber).toBe(5);

		// Earlier rounds archive their own confirmed results, with navigation.
		const roundOne = loadResultsArchive(db, season, season.rounds[0], {
			viewerPlayerId: maya.playerId,
			currentRoundId: page.currentRound!.roundId
		});
		expect(roundOne.results.length).toBeGreaterThan(0);
		expect(roundOne.isCurrentRound).toBe(false);
		expect(roundOne.previousRoundNumber).toBeNull();
		expect(roundOne.nextRoundNumber).toBe(2);
		expect(roundOne.results.every((result) => result.status === 'confirmed')).toBe(true);

		// Requesting a round that does not exist falls back to the current round.
		const fallback = loadFixturesPageData(db, { viewer: maya, tab: 'results', roundNumber: 99 });
		expect(fallback.archive?.roundNumber).toBe(6);
	});

	it('keeps a submitted-but-unconfirmed result out of the archive and the table', () => {
		const { db, season } = seeded();
		const maya = loadViewerPlayer(db, 'maya.chen@example.test')!;
		const current = season.rounds.at(-1)!;
		const page = loadFixturesPageData(db, { viewer: maya });
		const mine = page.fixtures.find((fixture) => fixture.isMine && fixture.state === 'unplayed')!;
		saveLeagueResult(db, {
			fixtureId: mine.fixtureId,
			submittedByPlayerId: maya.playerId,
			lowFrames: 2,
			highFrames: 1,
			actualPlayedDate: '2026-09-27'
		});

		const roundProgressAfter = (
			db.prepare('SELECT state, COUNT(*) AS n FROM fixtures WHERE round_id = ? GROUP BY state').all(
				current.roundId
			) as Array<{ state: string; n: number }>
		).reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.state]: row.n }), {});

		expect(roundProgressAfter.confirmed).toBe(22);
		expect(roundProgressAfter.awaiting_confirmation).toBe(1);

		const archive = loadFixturesPageData(db, { viewer: maya, tab: 'results' }).archive!;
		expect(archive.results).toHaveLength(22);
		expect(archive.awaitingConfirmation).toBe(1);
		expect(archive.results.some((result) => result.actualPlayedDate === '2026-09-27')).toBe(false);
	});

	it('loads a fixture detail with its plan history, frames and breaks', () => {
		const { db } = seeded();
		const maya = loadViewerPlayer(db, 'maya.chen@example.test')!;
		const page = loadFixturesPageData(db, { viewer: maya });
		const arranged = page.fixtures.find((fixture) => fixture.plannedDate)!;
		const leon = loadViewerPlayer(db, 'leon.park@example.test')!;
        const detail = loadFixtureDetailData(db, { fixtureId: arranged.fixtureId, viewer: leon })!;

		expect(detail.history).toHaveLength(1);
		expect(detail.history[0].proposedByName).toBe('Owen Brooks');
		expect(detail.roundWindowEnd).toBe('2026-10-10');
		expect(detail.frames).toEqual([]);

		const played = page.fixtures.find((fixture) => fixture.result && fixture.result.frameDetailCount > 0)!;
		const playedDetail = loadFixtureDetailData(db, { fixtureId: played.fixtureId, viewer: maya })!;
		expect(playedDetail.frames).toHaveLength(3);
		expect(playedDetail.frames.map((frame) => frame.frameNumber)).toEqual([1, 2, 3]);
		expect(playedDetail.fixture.result?.actualPlayedDate).toBe(played.result?.actualPlayedDate);

		// Optional highest breaks are surfaced when the fictional result recorded
		// them, and never invented when it did not.
		const withBreak = db
			.prepare('SELECT fixture_id FROM results WHERE id IN (SELECT result_id FROM result_breaks) LIMIT 1')
			.get() as { fixture_id: number };
		const breakDetail = loadFixtureDetailData(db, { fixtureId: withBreak.fixture_id, viewer: maya })!;
		expect(breakDetail.breaks.length).toBeGreaterThan(0);
		expect(breakDetail.breaks[0].breakPoints).toBeGreaterThan(0);
		expect(
			page.fixtures.find((fixture) => fixture.result && fixture.result.frameDetailCount === 0)
		).toBeTruthy();
	});

	it('resolves the viewer identity to an existing player only', () => {
		const { db } = seeded();
		expect(loadViewerPlayer(db, 'maya.chen@example.test')).toMatchObject({
			name: 'Maya Chen',
			role: 'super_admin'
		});
		// Case-insensitive, and never invented for an unknown address.
		expect(loadViewerPlayer(db, 'MAYA.CHEN@example.test')?.name).toBe('Maya Chen');
		expect(loadViewerPlayer(db, 'stranger@example.test')).toBeNull();
		expect(loadViewerPlayer(db, null)).toBeNull();
		// A viewer who is not in the fixture gets no manage rights, and no
		// identity at all means no manage rights either.
		const noah = loadViewerPlayer(db, 'noah.kim@example.test')!;
		const page = loadFixturesPageData(db, { viewer: noah });
		const notMine = page.fixtures.find((fixture) => !fixture.isMine && fixture.state === 'unplayed')!;
		expect(notMine.canManage).toBe(false);
		expect(notMine.manageReason).toMatch(/Only the two players/);
		const anonymous = loadFixturesPageData(db, { viewer: null });
		expect(anonymous.fixtures.every((fixture) => !fixture.isMine)).toBe(true);
		expect(anonymous.fixtures.every((fixture) => !fixture.canManage)).toBe(true);
	});

	it('returns clear empty states without a seeded season', () => {
		const db = freshDb();
		const page = loadFixturesPageData(db, { viewer: null });
		expect(page.season).toBeNull();
		expect(page.currentRound).toBeNull();
		expect(page.fixtures).toEqual([]);
		expect(page.archive).toBeNull();
		expect(loadFixtureDetailData(db, { fixtureId: 1, viewer: null })).toBeNull();
	});

	it('derives the playable window from the round snapshot, not from settings', () => {
		const db = freshDb();
		const { roundId } = tinyLeague(db);
		const seasonRow = db.prepare('SELECT id FROM seasons').get() as { id: number };
		const round = loadSeason(db, seasonRow.id)!.rounds.find((entry) => entry.roundId === roundId)!;
		expect(roundPlayableWindowEnd(round, 'Europe/London')).toBe('2026-10-22');
	});
});
