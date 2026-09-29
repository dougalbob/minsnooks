import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { runMigrations } from '../src/lib/server/migrate';
import { createSeason, openRound, orderedPair, saveLeagueResult } from '../src/lib/server/league';
import { computeStandings } from '../src/lib/server/standings';
import { loadStatsPageData } from '../src/lib/server/stats-page';
import { runRoundLifecycle } from '../src/lib/server/lifecycle';
import {
	assessFriendlyForm,
	friendlyFormValuesFrom,
	validateFriendlyResult,
	type FriendlyFormValues
} from '../src/lib/friendly-entry';
import {
	FriendlyNeedsConfirmationError,
	FriendlyPermissionError,
	FriendlyValidationError,
	cancelScheduledFriendly,
	correctFriendlyResult,
	expireStaleFriendlies,
	friendlyExpiryDate,
	friendlyPermissions,
	friendlyScheduleGate,
	loadFriendlyDetail,
	loadFriendlyList,
	loadFriendlyOpponents,
	recordFriendlyResult,
	rescheduleFriendly,
	scheduleFriendly,
	shiftIsoDate
} from '../src/lib/server/friendlies';

const migrations = path.resolve(process.cwd(), 'migrations');
const openDbs: Db[] = [];

/** London "today" is 2026-09-29 (BST). */
const NOW = new Date('2026-09-29T12:00:00.000Z');
const TODAY = '2026-09-29';
const PLAYED = '2026-09-20';

function freshDb(): Db {
	const file = path.join(os.tmpdir(), `minsnooks-friendlies-${Date.now()}-${Math.random()}.db`);
	const db = openDb(file);
	openDbs.push(db);
	runMigrations(db, migrations);
	return db;
}

afterEach(() => {
	while (openDbs.length) {
		const db = openDbs.pop()!;
		try {
			const file = db.name;
			db.close();
			for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true });
		} catch {
			/* best effort */
		}
	}
});

let playerCounter = 0;

function addPlayer(
	db: Db,
	name: string,
	role: 'player' | 'admin' | 'super_admin' = 'player',
	active = true
): number {
	playerCounter += 1;
	const info = db
		.prepare(
			`INSERT INTO players (email, display_name, initials, avatar_tone, role, is_active)
			 VALUES (?, ?, ?, 'maya', ?, ?)`
		)
		.run(
			`${name.toLowerCase().replace(/[^a-z]+/g, '.')}.${playerCounter}@example.test`,
			name,
			name
				.split(' ')
				.map((part) => part[0])
				.join('')
				.toUpperCase(),
			role,
			active ? 1 : 0
		);
	return Number(info.lastInsertRowid);
}

function addSeason(db: Db): number {
	return createSeason(db, {
		label: `friendly-season-${Date.now()}-${Math.random()}`,
		framesPerMatch: 3,
		pointsPerFrame: 1,
		matchWinBonus: 0,
		timezone: 'Europe/London'
	});
}

interface FriendlyCast {
	a: number;
	b: number;
	outsider: number;
	admin: number;
}

function cast(db: Db): FriendlyCast {
	return {
		a: addPlayer(db, 'Avery Player'),
		b: addPlayer(db, 'Blake Player'),
		outsider: addPlayer(db, 'Casey Outsider'),
		admin: addPlayer(db, 'Dana Admin', 'admin')
	};
}

function values(overrides: Partial<FriendlyFormValues> = {}): FriendlyFormValues {
	return {
		actualPlayedDate: PLAYED,
		lowFrames: '3',
		highFrames: '2',
		framePoints: [],
		breaks: { low: '', high: '' },
		...overrides
	};
}

/** Frame-point detail whose winners produce the given totals (low wins first). */
function pointsFor(lowWins: number, highWins: number): Array<{ low: string; high: string }> {
	const rows: Array<{ low: string; high: string }> = [];
	for (let i = 0; i < lowWins; i++) rows.push({ low: '62', high: '41' });
	for (let i = 0; i < highWins; i++) rows.push({ low: '23', high: '71' });
	return rows;
}

describe('friendly validation (pure rules)', () => {
	it('accepts flexible counts and drawn matches, and rejects a 0–0', () => {
		const base = { actualPlayedDate: PLAYED, lowPlayerId: 1, highPlayerId: 2 };
		expect(validateFriendlyResult({ ...base, lowFrames: 5, highFrames: 3 }).ok).toBe(true);
		expect(validateFriendlyResult({ ...base, lowFrames: 2, highFrames: 2 }).ok).toBe(true);
		expect(validateFriendlyResult({ ...base, lowFrames: 1, highFrames: 0 }).ok).toBe(true);
		const zero = validateFriendlyResult({ ...base, lowFrames: 0, highFrames: 0 });
		expect(zero.ok).toBe(false);
		expect(zero.errors.join(' ')).toMatch(/0–0 is not a result/);
	});

	it('requires an actual played date that is not in the future', () => {
		const base = { lowFrames: 3, highFrames: 2, lowPlayerId: 1, highPlayerId: 2 };
		expect(validateFriendlyResult({ ...base, actualPlayedDate: '' }).ok).toBe(false);
		const future = validateFriendlyResult(
			{ ...base, actualPlayedDate: '2026-10-01' },
			{ today: TODAY }
		);
		expect(future.ok).toBe(false);
		expect(future.errors.join(' ')).toMatch(/cannot be in the future/);
		expect(
			validateFriendlyResult({ ...base, actualPlayedDate: PLAYED }, { today: TODAY }).ok
		).toBe(true);
	});

	it('treats frame-point detail as all-or-nothing and checks it against the totals', () => {
		const base = {
			lowFrames: 3,
			highFrames: 2,
			actualPlayedDate: PLAYED,
			lowPlayerId: 1,
			highPlayerId: 2
		};
		const full = [62, 58, 70].map((low, index) => ({
			frameNumber: index + 1,
			lowPoints: low,
			highPoints: 40
		}));
		full.push(
			{ frameNumber: 4, lowPoints: 20, highPoints: 65 },
			{ frameNumber: 5, lowPoints: 33, highPoints: 59 }
		);
		expect(validateFriendlyResult({ ...base, frames: full }).ok).toBe(true);
		const partial = validateFriendlyResult({ ...base, frames: full.slice(0, 3) });
		expect(partial.ok).toBe(false);
		expect(partial.errors.join(' ')).toMatch(/all 5 played frames/);
		const mismatch = validateFriendlyResult({
			...base,
			lowFrames: 4,
			highFrames: 1,
			frames: full
		});
		expect(mismatch.ok).toBe(false);
		expect(mismatch.errors.join(' ')).toMatch(/do not match the match score/);
		const drawn = validateFriendlyResult({
			...base,
			frames: full.map((frame, index) =>
				index === 0 ? { ...frame, highPoints: frame.lowPoints } : frame
			)
		});
		expect(drawn.ok).toBe(false);
		expect(drawn.errors.join(' ')).toMatch(/cannot be drawn on points/);
	});

	it('lets breaks stand alone but bounds them by recorded frame scores', () => {
		const base = {
			lowFrames: 3,
			highFrames: 2,
			actualPlayedDate: PLAYED,
			lowPlayerId: 1,
			highPlayerId: 2
		};
		expect(validateFriendlyResult({ ...base, breaks: [{ playerId: 1, breakPoints: 45 }] }).ok).toBe(
			true
		);
		const frames = [1, 2, 3, 4, 5].map((frameNumber) => ({
			frameNumber,
			lowPoints: frameNumber <= 3 ? 60 : 20,
			highPoints: frameNumber <= 3 ? 40 : 65
		}));
		const tooHigh = validateFriendlyResult({
			...base,
			frames,
			breaks: [{ playerId: 1, breakPoints: 61 }]
		});
		expect(tooHigh.ok).toBe(false);
		expect(tooHigh.errors.join(' ')).toMatch(/higher than the best recorded frame score/);
		const outsider = validateFriendlyResult({
			...base,
			breaks: [{ playerId: 99, breakPoints: 30 }]
		});
		expect(outsider.ok).toBe(false);
		expect(outsider.errors.join(' ')).toMatch(/not in this friendly/);
	});

	it('warns — never rejects — on very unusual tallies and breaks', () => {
		const base = { actualPlayedDate: PLAYED, lowPlayerId: 1, highPlayerId: 2 };
		const wild = validateFriendlyResult({ ...base, lowFrames: 34, highFrames: 3 });
		expect(wild.ok).toBe(true);
		expect(wild.warnings.join(' ')).toMatch(/lot for one friendly/);
		const margin = validateFriendlyResult({ ...base, lowFrames: 12, highFrames: 0 });
		expect(margin.ok).toBe(true);
		expect(margin.warnings.join(' ')).toMatch(/winning margin/);
		expect(validateFriendlyResult({ ...base, lowFrames: 3, highFrames: 2 }).warnings).toEqual([]);
		expect(validateFriendlyResult({ ...base, lowFrames: 2, highFrames: 2 }).warnings).toEqual([]);
		const century = validateFriendlyResult({
			...base,
			lowFrames: 3,
			highFrames: 2,
			breaks: [{ playerId: 1, breakPoints: 102 }]
		});
		expect(century.ok).toBe(true);
		expect(century.warnings.join(' ')).toMatch(/century/);
		const maximum = validateFriendlyResult({
			...base,
			lowFrames: 3,
			highFrames: 2,
			breaks: [{ playerId: 2, breakPoints: 148 }]
		});
		expect(maximum.ok).toBe(true);
		expect(maximum.warnings.join(' ')).toMatch(/free ball/);
	});

	it('assesses the entry form: totals first, then all-or-nothing point scores', () => {
		const context = { lowPlayerId: 1, highPlayerId: 2, lowPlayerName: 'A', highPlayerName: 'B', today: TODAY };
		const good = assessFriendlyForm(values({ framePoints: pointsFor(3, 2) }), context);
		expect(good.ok).toBe(true);
		expect(good.lowFrames).toBe(3);
		expect(good.highFrames).toBe(2);
		expect(good.frames).toHaveLength(5);
		const partial = assessFriendlyForm(values({ framePoints: pointsFor(3, 2).slice(0, 2) }), context);
		expect(partial.ok).toBe(false);
		expect(partial.errors.join(' ')).toMatch(/all 5 played frames/);
		const noTotals = assessFriendlyForm(
			values({ lowFrames: '', highFrames: '', framePoints: [{ low: '10', high: '20' }] }),
			context
		);
		expect(noTotals.ok).toBe(false);
	});

	it('reads the form defensively: a mistyped total cannot pull an unbounded form', () => {
		const form = new FormData();
		form.set('actualDate', PLAYED);
		form.set('lowFrames', '500');
		form.set('highFrames', '0');
		form.set('frame1Low', '10');
		form.set('frame1High', '20');
		const parsed = friendlyFormValuesFrom(form);
		expect(parsed.lowFrames).toBe('500');
		expect(parsed.framePoints).toHaveLength(200);
	});
});

describe('friendly scheduling, rescheduling and cancellation', () => {
	it('schedules between registered players and audits the plan', () => {
		const db = freshDb();
		addSeason(db);
		const ids = cast(db);
		const outcome = scheduleFriendly(
			db,
			{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, date: '2026-10-04', time: '15:00', note: 'Sunday knockabout' },
			{ now: NOW }
		);
		expect(outcome.mode).toBe('scheduled');
		expect(outcome.adminOverride).toBe(false);
		const detail = loadFriendlyDetail(db, outcome.friendlyId)!;
		expect(detail.status).toBe('scheduled');
		expect(detail.scheduledDate).toBe('2026-10-04');
		expect(detail.hasResult).toBe(false);
		expect(detail.expiryDate).toBe('2026-10-10');
		const audit = db
			.prepare("SELECT action, actor_player_id FROM audit_log WHERE entity_type = 'friendly' ORDER BY id")
			.all();
		expect(audit).toEqual([{ action: 'scheduled', actor_player_id: ids.a }]);
	});

	it('rejects self-play, unknown players and past dates', () => {
		const db = freshDb();
		addSeason(db);
		const ids = cast(db);
		const inactive = addPlayer(db, 'Ina Ctive', 'player', false);
		expect(() =>
			scheduleFriendly(db, { actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.a, date: '2026-10-04' }, { now: NOW })
		).toThrow(/two different players/);
		expect(() =>
			scheduleFriendly(db, { actorPlayerId: ids.a, playerAId: ids.a, playerBId: 9999, date: '2026-10-04' }, { now: NOW })
		).toThrow(/only between registered league players/);
		expect(() =>
			scheduleFriendly(db, { actorPlayerId: ids.a, playerAId: ids.a, playerBId: inactive, date: '2026-10-04' }, { now: NOW })
		).toThrow(/only between registered league players/);
		expect(() =>
			scheduleFriendly(db, { actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, date: '2026-09-28' }, { now: NOW })
		).toThrow(/cannot be in the past/);
		expect(() =>
			scheduleFriendly(db, { actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, date: 'next friday' }, { now: NOW })
		).toThrow(/valid scheduled date/);
	});

	it('lets an admin arrange for support, but never an uninvolved player', () => {
		const db = freshDb();
		addSeason(db);
		const ids = cast(db);
		expect(() =>
			scheduleFriendly(
				db,
				{ actorPlayerId: ids.outsider, playerAId: ids.a, playerBId: ids.b, date: '2026-10-04' },
				{ now: NOW }
			)
		).toThrow(FriendlyPermissionError);
		const outcome = scheduleFriendly(
			db,
			{ actorPlayerId: ids.admin, playerAId: ids.a, playerBId: ids.b, date: '2026-10-04' },
			{ now: NOW }
		);
		expect(outcome.adminOverride).toBe(true);
		const detail = JSON.parse(
			(db.prepare("SELECT detail FROM audit_log WHERE entity_type = 'friendly'").get() as { detail: string }).detail
		) as { adminOverride: boolean };
		expect(detail.adminOverride).toBe(true);
	});

	it('reschedules to a newer date and refuses once a result exists', () => {
		const db = freshDb();
		addSeason(db);
		const ids = cast(db);
		const { friendlyId } = scheduleFriendly(
			db,
			{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, date: '2026-10-04' },
			{ now: NOW }
		);
		const moved = rescheduleFriendly(
			db,
			{ friendlyId, actorPlayerId: ids.b, date: '2026-10-11', time: '18:30' },
			{ now: NOW }
		);
		expect(moved.mode).toBe('rescheduled');
		expect(loadFriendlyDetail(db, friendlyId)!.scheduledDate).toBe('2026-10-11');
		expect(loadFriendlyDetail(db, friendlyId)!.expiryDate).toBe('2026-10-17');
		recordFriendlyResult(db, { actorPlayerId: ids.a, friendlyId, values: values() }, { now: NOW });
		expect(() =>
			rescheduleFriendly(db, { friendlyId, actorPlayerId: ids.a, date: '2026-10-18' }, { now: NOW })
		).toThrow(/cannot be rescheduled/);
	});

	it('cancels an unsaved plan but never a saved result', () => {
		const db = freshDb();
		addSeason(db);
		const ids = cast(db);
		const { friendlyId } = scheduleFriendly(
			db,
			{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, date: '2026-10-04' },
			{ now: NOW }
		);
		expect(() =>
			cancelScheduledFriendly(db, { friendlyId, actorPlayerId: ids.outsider }, { now: NOW })
		).toThrow(FriendlyPermissionError);
		const cancelled = cancelScheduledFriendly(db, { friendlyId, actorPlayerId: ids.b }, { now: NOW });
		expect(cancelled.cancelled).toBe(true);
		expect(loadFriendlyDetail(db, friendlyId)).toBeNull();
		// The audit trail keeps the story even though the empty entry is gone.
		const actions = (
			db.prepare("SELECT action FROM audit_log WHERE entity_type = 'friendly' ORDER BY id").all() as Array<{ action: string }>
		).map((row) => row.action);
		expect(actions).toEqual(['scheduled', 'cancelled']);

		const played = scheduleFriendly(
			db,
			{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, date: '2026-10-04' },
			{ now: NOW }
		);
		recordFriendlyResult(db, { actorPlayerId: ids.a, friendlyId: played.friendlyId, values: values() }, { now: NOW });
		expect(() =>
			cancelScheduledFriendly(db, { friendlyId: played.friendlyId, actorPlayerId: ids.a }, { now: NOW })
		).toThrow(/never removed/);
	});
});

describe('friendly results without opponent approval', () => {
	it('records against a scheduled plan and keeps the plan as history', () => {
		const db = freshDb();
		addSeason(db);
		const ids = cast(db);
		const [low, high] = orderedPair(ids.a, ids.b);
		const { friendlyId } = scheduleFriendly(
			db,
			{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, date: '2026-10-04' },
			{ now: NOW }
		);
		const outcome = recordFriendlyResult(
			db,
			{
				actorPlayerId: ids.b,
				friendlyId,
				values: values({
					lowFrames: low === ids.a ? '4' : '2',
					highFrames: low === ids.a ? '2' : '4',
					breaks: { low: '38', high: '' }
				})
			},
			{ now: NOW }
		);
		expect(outcome.mode).toBe('recorded');
		expect(outcome.revision).toBe(1);
		// No approval step: the result is final the moment it is written.
		const detail = loadFriendlyDetail(db, friendlyId)!;
		expect(detail.status).toBe('played');
		expect(detail.hasResult).toBe(true);
		expect(detail.scheduledDate).toBe('2026-10-04');
		expect(detail.actualPlayedDate).toBe(PLAYED);
		expect(detail.hasBreaks).toBe(true);
		expect(detail.winner?.playerId).toBe(ids.a);
	});

	it('records a played friendly directly between two players', () => {
		const db = freshDb();
		addSeason(db);
		const ids = cast(db);
		const [low, high] = orderedPair(ids.a, ids.b);
		expect(low).not.toBe(high);
		const outcome = recordFriendlyResult(
			db,
			{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, values: values({ lowFrames: '2', highFrames: '2' }) },
			{ now: NOW }
		);
		const detail = loadFriendlyDetail(db, outcome.friendlyId)!;
		expect(detail.hasResult).toBe(true);
		expect(detail.isDraw).toBe(true);
		expect(detail.winner).toBeNull();
		expect(detail.scheduledDate).toBeNull();
	});

	it('rejects a 0–0 in the write path and at the database CHECK', () => {
		const db = freshDb();
		addSeason(db);
		const ids = cast(db);
		expect(() =>
			recordFriendlyResult(
				db,
				{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, values: values({ lowFrames: '0', highFrames: '0' }) },
				{ now: NOW }
			)
		).toThrow(/0–0 is not a result/);
		const { friendlyId } = scheduleFriendly(
			db,
			{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, date: '2026-10-04' },
			{ now: NOW }
		);
		expect(() =>
			db
				.prepare(
					`INSERT INTO friendly_results (friendly_id, player_low_frames, player_high_frames, actual_played_date, submitted_by_player_id)
					 VALUES (?, 0, 0, ?, ?)`
				)
				.run(friendlyId, PLAYED, ids.a)
		).toThrow(/CHECK constraint failed/);
	});

	it('requires the actual played date and never defaults it from the plan', () => {
		const db = freshDb();
		addSeason(db);
		const ids = cast(db);
		const { friendlyId } = scheduleFriendly(
			db,
			{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, date: '2026-10-04' },
			{ now: NOW }
		);
		expect(() =>
			recordFriendlyResult(
				db,
				{ actorPlayerId: ids.a, friendlyId, values: values({ actualPlayedDate: '' }) },
				{ now: NOW }
			)
		).toThrow(/actual date played/);
		expect(() =>
			recordFriendlyResult(
				db,
				{ actorPlayerId: ids.a, friendlyId, values: values({ actualPlayedDate: '2026-10-05' }) },
				{ now: NOW }
			)
		).toThrow(/cannot be in the future/);
		// A plan is not proof of play: the recorded date stands on its own.
		const outcome = recordFriendlyResult(
			db,
			{ actorPlayerId: ids.a, friendlyId, values: values({ actualPlayedDate: '2026-09-25' }) },
			{ now: NOW }
		);
		expect(outcome.mode).toBe('recorded');
		expect(loadFriendlyDetail(db, friendlyId)!.actualPlayedDate).toBe('2026-09-25');
	});

	it('asks “is this correct?” for a 34–3 and saves once acknowledged', () => {
		const db = freshDb();
		addSeason(db);
		const ids = cast(db);
		const wild = values({ lowFrames: '34', highFrames: '3' });
		const refused = recordFriendlyResult;
		expect(() =>
			refused(db, { actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, values: wild }, { now: NOW })
		).toThrow(FriendlyNeedsConfirmationError);
		try {
			recordFriendlyResult(
				db,
				{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, values: wild },
				{ now: NOW }
			);
			expect.unreachable('a 34–3 must ask for confirmation first');
		} catch (cause) {
			expect(cause).toBeInstanceOf(FriendlyNeedsConfirmationError);
			expect((cause as FriendlyNeedsConfirmationError).warnings.join(' ')).toMatch(/lot for one friendly/);
		}
		const outcome = recordFriendlyResult(
			db,
			{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, values: wild, ackWarnings: true },
			{ now: NOW }
		);
		expect(outcome.mode).toBe('recorded');
		expect(outcome.warnings.length).toBeGreaterThan(0);
	});

	it('lets either participant correct, with an audited admin override', () => {
		const db = freshDb();
		addSeason(db);
		const ids = cast(db);
		const [low, high] = orderedPair(ids.a, ids.b);
		const outcome = recordFriendlyResult(
			db,
			{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, values: values() },
			{ now: NOW }
		);
		expect([low, high]).toContain(ids.a);
		// The other participant corrects without needing a reason.
		const first = correctFriendlyResult(
			db,
			{ friendlyId: outcome.friendlyId, actorPlayerId: ids.b, values: values({ lowFrames: '1', highFrames: '4' }) },
			{ now: NOW }
		);
		expect(first.mode).toBe('corrected');
		expect(first.revision).toBe(2);
		expect(first.adminOverride).toBe(false);
		// An outsider cannot correct.
		expect(() =>
			correctFriendlyResult(
				db,
				{ friendlyId: outcome.friendlyId, actorPlayerId: ids.outsider, values: values() },
				{ now: NOW }
			)
		).toThrow(FriendlyPermissionError);
		// An admin override corrects with a mandatory reason.
		expect(() =>
			correctFriendlyResult(
				db,
				{ friendlyId: outcome.friendlyId, actorPlayerId: ids.admin, values: values({ lowFrames: '2', highFrames: '2' }) },
				{ now: NOW }
			)
		).toThrow(/reason is required/);
		const override = correctFriendlyResult(
			db,
			{
				friendlyId: outcome.friendlyId,
				actorPlayerId: ids.admin,
				values: values({ lowFrames: '2', highFrames: '2' }),
				reason: 'Both players agreed the score was 2–2.'
			},
			{ now: NOW }
		);
		expect(override.revision).toBe(3);
		expect(override.adminOverride).toBe(true);
		const detail = loadFriendlyDetail(db, outcome.friendlyId)!;
		expect(detail.isDraw).toBe(true);
		expect(detail.correctionReason).toBe('Both players agreed the score was 2–2.');
		const correction = db
			.prepare("SELECT reason, detail FROM audit_log WHERE entity_type = 'friendly' AND action = 'result_corrected' ORDER BY id DESC LIMIT 1")
			.get() as { reason: string; detail: string };
		expect(correction.reason).toBe('Both players agreed the score was 2–2.');
		expect(JSON.parse(correction.detail)).toMatchObject({ revision: 3, adminOverride: true });
	});

	it('exposes the permission matrix with reasons, not just refusals', () => {
		const db = freshDb();
		addSeason(db);
		const ids = cast(db);
		expect(friendlyScheduleGate(db, null).allowed).toBe(false);
		expect(friendlyScheduleGate(db, ids.a).allowed).toBe(true);
		const { friendlyId } = scheduleFriendly(
			db,
			{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, date: '2026-10-04' },
			{ now: NOW }
		);
		const signedOut = friendlyPermissions(db, friendlyId, null);
		expect(signedOut.canRecord).toBe(false);
		expect(signedOut.recordReason).toMatch(/Sign in/);
		const outsider = friendlyPermissions(db, friendlyId, ids.outsider);
		expect(outsider.canRecord).toBe(false);
		expect(outsider.canReschedule).toBe(false);
		expect(outsider.canCancel).toBe(false);
		expect(outsider.recordReason).toMatch(/Only the two players/);
		const participant = friendlyPermissions(db, friendlyId, ids.b);
		expect(participant.canRecord).toBe(true);
		expect(participant.canReschedule).toBe(true);
		expect(participant.canCancel).toBe(true);
		expect(participant.canCorrect).toBe(false);
		const admin = friendlyPermissions(db, friendlyId, ids.admin);
		expect(admin.canRecord).toBe(true);
		expect(admin.adminOverride).toBe(true);

		recordFriendlyResult(db, { actorPlayerId: ids.a, friendlyId, values: values() }, { now: NOW });
		const played = friendlyPermissions(db, friendlyId, ids.a);
		expect(played.canCorrect).toBe(true);
		expect(played.canRecord).toBe(false);
		expect(played.canCancel).toBe(false);
		expect(played.cancelReason).toMatch(/never removed/);
	});
});

describe('friendly expiry', () => {
	it('computes the five-day window on calendar dates', () => {
		expect(shiftIsoDate('2026-10-03', -5)).toBe('2026-09-28');
		expect(shiftIsoDate('2026-10-03', 6)).toBe('2026-10-09');
		expect(friendlyExpiryDate('2026-10-03')).toBe('2026-10-09');
	});

	it('removes only unsaved plans more than five days past their scheduled date', () => {
		const db = freshDb();
		addSeason(db);
		const ids = cast(db);
		const scheduleOn = (date: string) =>
			scheduleFriendly(
				db,
				{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, date },
				{ now: new Date(`${date}T12:00:00.000Z`) }
			).friendlyId;
		// Evaluated 2026-10-09 in London: Oct 2 and Oct 3 are more than five
		// days past (gone); Oct 4 is exactly five days past (survives — removal
		// starts once five days have passed).
		const staleEarly = scheduleOn('2026-10-02');
		const stale = scheduleOn('2026-10-03');
		const boundary = scheduleOn('2026-10-04');
		const fresh = scheduleOn('2026-10-08');
		const evaluation = new Date('2026-10-09T12:00:00.000Z');
		const outcome = expireStaleFriendlies(db, { now: evaluation });
		expect(outcome.expiredIds).toEqual([staleEarly, stale]);
		expect(loadFriendlyDetail(db, staleEarly)).toBeNull();
		expect(loadFriendlyDetail(db, stale)).toBeNull();
		expect(loadFriendlyDetail(db, boundary)).not.toBeNull();
		expect(loadFriendlyDetail(db, fresh)).not.toBeNull();
		// Re-running is a no-op: expiry is idempotent.
		expect(expireStaleFriendlies(db, { now: evaluation }).count).toBe(0);
		const expired = db
			.prepare("SELECT entity_id, actor_player_id FROM audit_log WHERE entity_type = 'friendly' AND action = 'expired'")
			.all();
		expect(expired).toEqual([
			{ entity_id: staleEarly, actor_player_id: null },
			{ entity_id: stale, actor_player_id: null }
		]);
	});

	it('never auto-deletes a saved result, however old its scheduled date', () => {
		const db = freshDb();
		addSeason(db);
		const ids = cast(db);
		const { friendlyId } = scheduleFriendly(
			db,
			{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, date: '2026-09-01' },
			{ now: new Date('2026-09-01T12:00:00.000Z') }
		);
		recordFriendlyResult(
			db,
			{ actorPlayerId: ids.a, friendlyId, values: values({ actualPlayedDate: '2026-09-01' }) },
			{ now: new Date('2026-09-02T12:00:00.000Z') }
		);
		const outcome = expireStaleFriendlies(db, { now: new Date('2026-11-01T12:00:00.000Z') });
		expect(outcome.count).toBe(0);
		expect(loadFriendlyDetail(db, friendlyId)!.hasResult).toBe(true);
	});

	it('follows the newest scheduled date after a reschedule', () => {
		const db = freshDb();
		addSeason(db);
		const ids = cast(db);
		const { friendlyId } = scheduleFriendly(
			db,
			{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, date: '2026-10-02' },
			{ now: new Date('2026-10-02T12:00:00.000Z') }
		);
		rescheduleFriendly(
			db,
			{ friendlyId, actorPlayerId: ids.a, date: '2026-10-20' },
			{ now: new Date('2026-10-03T12:00:00.000Z') }
		);
		const outcome = expireStaleFriendlies(db, { now: new Date('2026-10-09T12:00:00.000Z') });
		expect(outcome.count).toBe(0);
		expect(loadFriendlyDetail(db, friendlyId)!.scheduledDate).toBe('2026-10-20');
	});

	it('runs inside the scheduler with a summary event for the run log', () => {
		const db = freshDb();
		addSeason(db);
		const ids = cast(db);
		const { friendlyId } = scheduleFriendly(
			db,
			{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, date: '2026-10-02' },
			{ now: new Date('2026-10-02T12:00:00.000Z') }
		);
		const run = runRoundLifecycle(db, { now: new Date('2026-10-09T12:00:00.000Z'), trigger: 'admin' });
		expect(loadFriendlyDetail(db, friendlyId)).toBeNull();
		expect(run.events.map((event) => event.kind)).toContain('friendlies_expired');
		expect(run.events.find((event) => event.kind === 'friendlies_expired')!.message).toMatch(
			/1 scheduled friendly/
		);
	});
});

describe('friendly separation from league data', () => {
	it('keeps friendlies out of standings, stats and highlights', () => {
		const db = freshDb();
		const seasonId = addSeason(db);
		const ids = cast(db);
		const roundId = openRound(db, {
			seasonId,
			number: 1,
			playerIds: [ids.a, ids.b, ids.outsider],
			openedAt: '2026-09-01T12:00:00.000Z'
		});
		const fixture = (low: number, high: number) =>
			(
				db
					.prepare('SELECT id FROM fixtures WHERE round_id = ? AND player_low_id = ? AND player_high_id = ?')
					.get(roundId, ...orderedPair(low, high)) as { id: number }
			).id;
		const [lowAB, highAB] = orderedPair(ids.a, ids.b);
		saveLeagueResult(db, {
			fixtureId: fixture(ids.a, ids.b),
			submittedByPlayerId: lowAB,
			lowFrames: 2,
			highFrames: 1,
			actualPlayedDate: '2026-09-10',
			entrySource: 'admin_direct'
		});
		saveLeagueResult(db, {
			fixtureId: fixture(ids.a, ids.outsider),
			submittedByPlayerId: ids.a,
			lowFrames: 3,
			highFrames: 0,
			actualPlayedDate: '2026-09-12',
			entrySource: 'admin_direct'
		});

		const standingsBefore = computeStandings(db, { seasonId });
		const roundBefore = computeStandings(db, { seasonId, roundId });
		const statsBefore = loadStatsPageData(db, ids.a);

		// A scheduled plan plus loud played friendlies: a 34–3 with a 140 break
		// and full frame-point detail, and a draw. None of it may leak.
		scheduleFriendly(
			db,
			{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, date: '2026-10-04' },
			{ now: NOW }
		);
		const [low, high] = orderedPair(ids.a, ids.b);
		const wildFrames: Array<{ low: string; high: string }> = [];
		for (let i = 0; i < 34; i++) wildFrames.push({ low: '70', high: '12' });
		for (let i = 0; i < 3; i++) wildFrames.push({ low: '9', high: '66' });
		recordFriendlyResult(
			db,
			{
				actorPlayerId: ids.a,
				playerAId: ids.a,
				playerBId: ids.b,
				values: values({
					actualPlayedDate: '2026-09-15',
					lowFrames: low === ids.a ? '34' : '3',
					highFrames: low === ids.a ? '3' : '34',
					framePoints: low === ids.a ? wildFrames : wildFrames.map((row) => ({ low: row.high, high: row.low })),
					breaks: low === ids.a ? { low: '68', high: '55' } : { low: '55', high: '68' }
				}),
				ackWarnings: true
			},
			{ now: NOW }
		);
		recordFriendlyResult(
			db,
			{
				actorPlayerId: ids.b,
				playerAId: ids.a,
				playerBId: ids.b,
				values: values({ actualPlayedDate: '2026-09-16', lowFrames: '2', highFrames: '2' })
			},
			{ now: NOW }
		);
		expect(
			(db.prepare('SELECT COUNT(*) AS n FROM friendly_results').get() as { n: number }).n
		).toBe(2);

		expect(computeStandings(db, { seasonId })).toEqual(standingsBefore);
		expect(computeStandings(db, { seasonId, roundId })).toEqual(roundBefore);
		expect(loadStatsPageData(db, ids.a)).toEqual(statsBefore);
	});
});

describe('friendly loaders', () => {
	it('lists scheduled plans and recent results with opponent choices', () => {
		const db = freshDb();
		addSeason(db);
		const ids = cast(db);
		const scheduled = scheduleFriendly(
			db,
			{ actorPlayerId: ids.a, playerAId: ids.a, playerBId: ids.b, date: '2026-10-04' },
			{ now: NOW }
		);
		const played = recordFriendlyResult(
			db,
			{
				actorPlayerId: ids.a,
				playerAId: ids.a,
				playerBId: ids.outsider,
				values: values({ lowFrames: '3', highFrames: '1' })
			},
			{ now: NOW }
		);
		const list = loadFriendlyList(db, { viewerPlayerId: ids.a, now: NOW });
		expect(list.timezone).toBe('Europe/London');
		expect(list.today).toBe(TODAY);
		expect(list.scheduled.map((item) => item.friendlyId)).toEqual([scheduled.friendlyId]);
		expect(list.played.map((item) => item.friendlyId)).toEqual([played.friendlyId]);
		expect(list.scheduled[0].isParticipant).toBe(true);
		expect(list.played[0].isParticipant).toBe(true);
		const strangerList = loadFriendlyList(db, { viewerPlayerId: ids.admin, now: NOW });
		expect(strangerList.scheduled[0].isParticipant).toBe(false);
		const opponents = loadFriendlyOpponents(db, ids.a);
		expect(opponents.map((player) => player.playerId).sort()).toEqual(
			[ids.b, ids.outsider, ids.admin].sort()
		);
		expect(opponents.find((player) => player.playerId === ids.a)).toBeUndefined();
	});
});
