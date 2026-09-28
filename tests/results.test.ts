import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { runMigrations } from '../src/lib/server/migrate';
import {
	closeFixtureNeutrally,
	createAward,
	createSeason,
	openRound,
	orderedPair
} from '../src/lib/server/league';
import { computeStandings } from '../src/lib/server/standings';
import type { ResultFormValues } from '../src/lib/result-entry';
import {
	ResultNeedsConfirmationError,
	ResultPermissionError,
	ResultValidationError,
	correctResult,
	loadAwaitingReview,
	loadResultActivity,
	loadResultAudit,
	loadResultRecord,
	resultPermissions,
	reviewResult,
	submitResult
} from '../src/lib/server/results';

const migrations = path.resolve(process.cwd(), 'migrations');
const openDbs: Db[] = [];

/** Inside the round window, and not in the future. */
const NOW = new Date('2026-09-28T12:00:00.000Z');
const PLAYED = '2026-09-20';
/** After the round deadline (2026-10-15) plus seven days' grace. */
const AFTER_GRACE = new Date('2026-10-30T12:00:00.000Z');

function freshDb(): Db {
	const file = path.join(os.tmpdir(), `minsnooks-results-${Date.now()}-${Math.random()}.db`);
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

interface TestLeague {
	seasonId: number;
	roundId: number;
	/** Maya v Priya: the fixture every journey in this file runs through. */
	fixtureId: number;
	/** A second fixture, used for award sourcing. */
	otherFixtureId: number;
	ids: Record<string, number>;
}

/**
 * Three players in a round (so a non-participant exists), plus an admin and a
 * super-admin who are not in it — the permission matrix needs all five.
 */
function resultLeague(db: Db): TestLeague {
	const ids: Record<string, number> = {};
	const insert = db.prepare(
		`INSERT INTO players (email, display_name, initials, avatar_tone, role)
		 VALUES (?, ?, ?, 'maya', ?)`
	);
	const roster: Array<[string, string]> = [
		['maya', 'player'],
		['priya', 'player'],
		['leon', 'player'],
		['ada', 'admin'],
		['root', 'super_admin']
	];
	for (const [key, role] of roster) {
		ids[key] = Number(
			insert
				.run(
					`${key}@example.test`,
					`${key.slice(0, 1).toUpperCase()}${key.slice(1)} Test`,
					key.slice(0, 2).toUpperCase(),
					role
				)
				.lastInsertRowid
		);
	}
	const seasonId = createSeason(db, {
		label: 'phase6',
		framesPerMatch: 3,
		pointsPerFrame: 1,
		matchWinBonus: 0,
		timezone: 'UTC'
	});
	const roundId = openRound(db, {
		seasonId,
		number: 1,
		playerIds: [ids.maya, ids.priya, ids.leon],
		deadlineAt: '2026-10-15T22:59:59.000Z',
		graceDays: 7,
		openedAt: '2026-09-01T00:00:00.000Z'
	});
	return {
		seasonId,
		roundId,
		fixtureId: fixtureBetween(db, roundId, ids.maya, ids.priya),
		otherFixtureId: fixtureBetween(db, roundId, ids.maya, ids.leon),
		ids
	};
}

function fixtureBetween(db: Db, roundId: number, a: number, b: number): number {
	const [low, high] = orderedPair(a, b);
	const row = db
		.prepare('SELECT id FROM fixtures WHERE round_id = ? AND player_low_id = ? AND player_high_id = ?')
		.get(roundId, low, high) as { id: number };
	return row.id;
}

/** Which side of the stored pair each player sits on (fixtures are ordered). */
function sides(league: TestLeague): { maya: 'low' | 'high'; priya: 'low' | 'high' } {
	const [low] = orderedPair(league.ids.maya, league.ids.priya);
	return low === league.ids.maya
		? { maya: 'low', priya: 'high' }
		: { maya: 'high', priya: 'low' };
}

function winnersFor(league: TestLeague, picks: Array<'maya' | 'priya'>): Array<'low' | 'high'> {
	const side = sides(league);
	return picks.map((pick) => side[pick]);
}

/**
 * Point scores are written here in (Maya, Priya) order and converted to the
 * stored low/high order, because fixtures keep their players ordered by id and
 * the form only ever knows "low" and "high".
 */
function scoresFor(league: TestLeague, scores: Array<[number, number]>): Array<[number, number]> {
	const side = sides(league);
	return scores.map(([maya, priya]) => (side.maya === 'low' ? [maya, priya] : [priya, maya]));
}

/** Highest breaks, likewise written per player and stored per side. */
function breaksFor(
	league: TestLeague,
	breaks: { maya?: number | ''; priya?: number | '' }
): { low: number | ''; high: number | '' } {
	const side = sides(league);
	const value = (player: 'maya' | 'priya') => breaks[player] ?? '';
	return side.maya === 'low'
		? { low: value('maya'), high: value('priya') }
		: { low: value('priya'), high: value('maya') };
}

interface EntryExtras {
	date?: string;
	/** Per-frame point scores, low seed first, exactly three frames. */
	points?: Array<[number, number]>;
	breaks?: { low?: number | ''; high?: number | '' };
}

/** Entry-form values exactly as the browser posts them (strings, blanks kept). */
function entry(league: TestLeague, picks: Array<'maya' | 'priya' | ''>, extras: EntryExtras = {}): ResultFormValues {
	const side = sides(league);
	return {
		actualPlayedDate: extras.date ?? PLAYED,
		frameWinners: picks.map((pick) => (pick === '' ? '' : side[pick])),
		framePoints: extras.points
			? extras.points.map(([low, high]) => ({ low: String(low), high: String(high) }))
			: [
					{ low: '', high: '' },
					{ low: '', high: '' },
					{ low: '', high: '' }
				],
		breaks: {
			low: extras.breaks?.low === undefined || extras.breaks.low === '' ? '' : String(extras.breaks.low),
			high: extras.breaks?.high === undefined || extras.breaks.high === '' ? '' : String(extras.breaks.high)
		}
	};
}

/**
 * Maya 2–1 Priya with a full, internally consistent score sheet: frame points
 * agree with the frame winners, and neither highest break exceeds that player's
 * best recorded frame score (Maya 68 in a 68–38 frame, Priya 52 in a 65–41 one).
 */
function playedSheet(league: TestLeague): ResultFormValues {
	return entry(league, ['maya', 'maya', 'priya'], {
		points: scoresFor(league, [
			[68, 38],
			[65, 41],
			[38, 65]
		]),
		breaks: breaksFor(league, { maya: 68, priya: 52 })
	});
}

function submit(db: Db, league: TestLeague, actor: string, values?: ResultFormValues) {
	return submitResult(
		db,
		{
			fixtureId: league.fixtureId,
			actorPlayerId: league.ids[actor],
			values: values ?? playedSheet(league)
		},
		{ now: NOW }
	);
}

/** Collect whatever the write path complained about, as plain strings. */
function complaints(fn: () => unknown): string[] {
	try {
		fn();
	} catch (cause) {
		if (cause instanceof ResultValidationError) return cause.errors;
		if (cause instanceof ResultNeedsConfirmationError) return cause.warnings;
		if (cause instanceof Error) return [cause.message];
		throw cause;
	}
	return [];
}

function fixtureState(db: Db, fixtureId: number): string {
	return (db.prepare('SELECT state FROM fixtures WHERE id = ?').get(fixtureId) as { state: string }).state;
}

function pointsFor(db: Db, seasonId: number, playerId: number) {
	const row = computeStandings(db, { seasonId }).find((entry) => entry.playerId === playerId);
	return row ?? { played: 0, points: 0, frameDiff: 0, wins: 0 };
}

function auditActions(db: Db, resultId: number): string[] {
	return loadResultAudit(db, resultId).map((row) => row.action);
}

describe('result entry validation', () => {
	it('requires every frame winner: a league match plays all three frames', () => {
		const db = freshDb();
		const league = resultLeague(db);
		const messages = complaints(() => submit(db, league, 'maya', entry(league, ['maya', 'maya', ''])));
		expect(messages.join(' ')).toMatch(/Choose the winner of frame 3/);
		expect(loadResultRecord(db, league.fixtureId)).toBeNull();
	});

	it('cannot be drawn, and frame winners must add up to the match score', () => {
		const db = freshDb();
		const league = resultLeague(db);
		// Two frames each is impossible in a best of three, but the point detail
		// disagreeing with the selected winners is the rule under test.
		const messages = complaints(() =>
			submit(db, league, 'maya', entry(league, ['maya', 'maya', 'priya'], { points: scoresFor(league, [[38, 65], [65, 38], [38, 65]]) }))
		);
		expect(messages.join(' ')).toMatch(/the point scores say .* won, but the frame winner selected was/);
	});

	it('requires an actual date played, and refuses one in the future', () => {
		const db = freshDb();
		const league = resultLeague(db);
		expect(complaints(() => submit(db, league, 'maya', entry(league, ['maya', 'maya', 'priya'], { date: '' }))).join(' ')).toMatch(
			/actual date played \(YYYY-MM-DD\) is required/
		);
		expect(
			complaints(() =>
				submit(db, league, 'maya', entry(league, ['maya', 'maya', 'priya'], { date: '2026-10-05' }))
			).join(' ')
		).toMatch(/cannot be in the future/);
	});

	it('refuses a played date outside the round window — a planned date is never a played date', () => {
		const db = freshDb();
		const league = resultLeague(db);
		expect(
			complaints(() =>
				submit(db, league, 'maya', entry(league, ['maya', 'maya', 'priya'], { date: '2026-08-20' }))
			).join(' ')
		).toMatch(/within this round’s deadline and grace period/);
	});

	it('refuses a break higher than the player’s best recorded frame score', () => {
		const db = freshDb();
		const league = resultLeague(db);
		const messages = complaints(() =>
			submit(db, league, 'maya', entry(league, ['maya', 'maya', 'priya'], {
				points: scoresFor(league, [[65, 38], [65, 41], [30, 65]]),
				breaks: breaksFor(league, { maya: 92 })
			}))
		);
		expect(messages.join(' ')).toMatch(/higher than the best recorded frame score \(65\)/);
	});

	it('accepts a break equal to the best frame score, even in a frame the player lost', () => {
		const db = freshDb();
		const league = resultLeague(db);
		const outcome = submit(db, league, 'maya', entry(league, ['maya', 'maya', 'priya'], {
			points: scoresFor(league, [[65, 38], [65, 41], [60, 65]]),
			breaks: breaksFor(league, { maya: 60, priya: 65 })
		}));
		expect(outcome.status).toBe('submitted');
		expect(loadResultRecord(db, league.fixtureId)?.breaks.map((row) => row.breakPoints).sort()).toEqual([60, 65]);
	});

	it('asks “is this correct?” about a foul-inflated frame instead of rejecting it', () => {
		const db = freshDb();
		const league = resultLeague(db);
		const surprising = entry(league, ['maya', 'maya', 'priya'], {
			points: scoresFor(league, [[130, 40], [65, 38], [38, 65]])
		});
		const error = (() => {
			try {
				submit(db, league, 'maya', surprising);
			} catch (cause) {
				return cause;
			}
			return null;
		})();
		expect(error).toBeInstanceOf(ResultNeedsConfirmationError);
		expect((error as ResultNeedsConfirmationError).warnings.join(' ')).toMatch(/unusually high/);
		// Nothing was written while the check was outstanding.
		expect(loadResultRecord(db, league.fixtureId)).toBeNull();

		const outcome = submitResult(
			db,
			{
				fixtureId: league.fixtureId,
				actorPlayerId: league.ids.maya,
				values: surprising,
				ackWarnings: true
			},
			{ now: NOW }
		);
		expect(outcome.status).toBe('submitted');
		expect(outcome.warnings.join(' ')).toMatch(/unusually high/);
	});

	it('flags a century, and a break above 147, as checks rather than refusals', () => {
		const db = freshDb();
		const league = resultLeague(db);
		const century = complaints(() =>
			submitResult(
				db,
				{
					fixtureId: league.fixtureId,
					actorPlayerId: league.ids.maya,
					values: entry(league, ['maya', 'maya', 'priya'], {
						points: scoresFor(league, [[140, 0], [65, 38], [38, 65]]),
						breaks: breaksFor(league, { maya: 140 })
					})
				},
				{ now: NOW }
			)
		);
		expect(century.join(' ')).toMatch(/is a century/);

		const freeBall = complaints(() =>
			submitResult(
				db,
				{
					fixtureId: league.fixtureId,
					actorPlayerId: league.ids.maya,
					values: entry(league, ['maya', 'maya', 'priya'], {
						points: scoresFor(league, [[152, 0], [65, 38], [38, 65]]),
						breaks: breaksFor(league, { maya: 152 })
					})
				},
				{ now: NOW }
			)
		);
		expect(freeBall.join(' ')).toMatch(/above a maximum 147/);
	});

	it('stores the frame winners it was given, frame by frame', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');
		const record = loadResultRecord(db, league.fixtureId);
		expect(record?.frameWinners.map((frame) => frame.playerName)).toEqual([
			'Maya Test',
			'Maya Test',
			'Priya Test'
		]);
		expect(record?.frameWinners.map((frame) => frame.frameNumber)).toEqual([1, 2, 3]);
		expect(record?.frames.map((frame) => [frame.lowPoints, frame.highPoints])).toEqual(
			scoresFor(league, [
				[68, 38],
				[65, 41],
				[38, 65]
			])
		);
	});
});

describe('the review state machine', () => {
	it('a player submission lands as submitted, revision 1, fixture awaiting confirmation', () => {
		const db = freshDb();
		const league = resultLeague(db);
		const outcome = submit(db, league, 'maya');
		expect(outcome).toMatchObject({ status: 'submitted', revision: 1, mode: 'submitted' });
		expect(fixtureState(db, league.fixtureId)).toBe('awaiting_confirmation');
		const record = loadResultRecord(db, league.fixtureId);
		expect(record?.status).toBe('submitted');
		expect(record?.submittedByName).toBe('Maya Test');
		expect(record?.confirmedByName).toBeNull();
	});

	it('the opponent confirms the scoreline and the actual date together', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');
		const outcome = reviewResult(
			db,
			{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'confirm' },
			{ now: NOW }
		);
		expect(outcome).toMatchObject({ status: 'confirmed', mode: 'confirmed' });
		expect(fixtureState(db, league.fixtureId)).toBe('confirmed');
		const record = loadResultRecord(db, league.fixtureId);
		expect(record?.confirmedByName).toBe('Priya Test');
		expect(record?.confirmedAt).not.toBeNull();
		expect(record?.actualPlayedDate).toBe(PLAYED);
	});

	it('the submitter can never confirm their own result, not even an admin who submitted one', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');
		expect(() =>
			reviewResult(
				db,
				{ fixtureId: league.fixtureId, actorPlayerId: league.ids.maya, decision: 'confirm' },
				{ now: NOW }
			)
		).toThrow(ResultPermissionError);

		// An admin submitting for the players still cannot approve it themselves.
		const other = league.otherFixtureId;
		submitResult(
			db,
			{
				fixtureId: other,
				actorPlayerId: league.ids.ada,
				values: entry(league, ['maya', 'maya', 'priya'])
			},
			{ now: NOW }
		);
		expect(() =>
			reviewResult(db, { fixtureId: other, actorPlayerId: league.ids.ada, decision: 'confirm' }, { now: NOW })
		).toThrow(ResultPermissionError);
		expect(loadResultRecord(db, other)?.status).toBe('submitted');
	});

	it('sending it back leaves the fixture outstanding and records who asked and why', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');
		const outcome = reviewResult(
			db,
			{
				fixtureId: league.fixtureId,
				actorPlayerId: league.ids.priya,
				decision: 'send_back',
				reason: 'Frame 2 was 65–47, and we played on the Friday'
			},
			{ now: NOW }
		);
		expect(outcome).toMatchObject({ status: 'sent_back', mode: 'sent_back' });
		expect(fixtureState(db, league.fixtureId)).toBe('unplayed');
		const record = loadResultRecord(db, league.fixtureId);
		expect(record?.sentBackByName).toBe('Priya Test');
		expect(record?.sendBackReason).toMatch(/Friday/);
		expect(record?.confirmedAt).toBeNull();
	});

	it('the submitter corrects and resubmits: revision rises, the send-back clears', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');
		reviewResult(
			db,
			{
				fixtureId: league.fixtureId,
				actorPlayerId: league.ids.priya,
				decision: 'send_back',
				reason: 'Frame 2 was 65–47'
			},
			{ now: NOW }
		);
		const corrected = entry(league, ['maya', 'priya', 'maya'], {
			points: scoresFor(league, [[65, 38], [47, 65], [76, 29]])
		});
		const outcome = submit(db, league, 'maya', corrected);
		expect(outcome).toMatchObject({ status: 'submitted', revision: 2, mode: 'resubmitted' });
		expect(fixtureState(db, league.fixtureId)).toBe('awaiting_confirmation');
		const record = loadResultRecord(db, league.fixtureId);
		expect(record?.sentBackByName).toBeNull();
		expect(record?.sendBackReason).toBeNull();
		expect(record?.frameWinners.map((frame) => frame.playerName)).toEqual([
			'Maya Test',
			'Priya Test',
			'Maya Test'
		]);
		expect(record?.frames.map((frame) => [frame.lowPoints, frame.highPoints])).toContainEqual(
			scoresFor(league, [[47, 65]])[0]
		);
	});

	it('only the submitter (or an admin) can resubmit a sent-back result', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');
		reviewResult(
			db,
			{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'send_back', reason: 'check frame 3' },
			{ now: NOW }
		);
		expect(() => submit(db, league, 'priya')).toThrow(ResultPermissionError);
		expect(() => submit(db, league, 'leon')).toThrow(ResultPermissionError);
		// The reviewer who sent it back can fix it as an admin override only if
		// they are an admin; Priya is not, so the correction stays with Maya.
		expect(loadResultRecord(db, league.fixtureId)?.status).toBe('sent_back');
	});

	it('a confirmed result cannot be confirmed or sent back again', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');
		reviewResult(
			db,
			{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'confirm' },
			{ now: NOW }
		);
		expect(
			complaints(() =>
				reviewResult(
					db,
					{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'confirm' },
					{ now: NOW }
				)
			).join(' ')
		).toMatch(/already confirmed/);
		expect(
			complaints(() =>
				reviewResult(
					db,
					{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'send_back' },
					{ now: NOW }
				)
			).join(' ')
		).toMatch(/already confirmed/);
	});

	it('a sent-back result cannot be reviewed until it is resubmitted', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');
		reviewResult(
			db,
			{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'send_back', reason: 'wrong date' },
			{ now: NOW }
		);
		expect(
			complaints(() =>
				reviewResult(
					db,
					{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'confirm' },
					{ now: NOW }
				)
			).join(' ')
		).toMatch(/waiting for a corrected submission/);
	});
});

describe('standings only move on confirmation', () => {
	it('a submission changes nothing in the table', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');
		expect(pointsFor(db, league.seasonId, league.ids.maya)).toMatchObject({ played: 0, points: 0, wins: 0 });
		expect(pointsFor(db, league.seasonId, league.ids.priya)).toMatchObject({ played: 0, points: 0 });
		expect(fixtureState(db, league.fixtureId)).toBe('awaiting_confirmation');
	});

	it('confirmation puts one point per frame into the table', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');
		reviewResult(
			db,
			{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'confirm' },
			{ now: NOW }
		);
		expect(pointsFor(db, league.seasonId, league.ids.maya)).toMatchObject({
			played: 1,
			points: 2,
			frameDiff: 1,
			wins: 1
		});
		expect(pointsFor(db, league.seasonId, league.ids.priya)).toMatchObject({
			played: 1,
			points: 1,
			frameDiff: -1,
			wins: 0
		});
	});

	it('a send-back and a resubmission still leave the table untouched', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');
		reviewResult(
			db,
			{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'send_back', reason: 'check it' },
			{ now: NOW }
		);
		submit(db, league, 'maya', entry(league, ['priya', 'priya', 'maya']));
		expect(pointsFor(db, league.seasonId, league.ids.maya)).toMatchObject({ played: 0, points: 0 });
		expect(pointsFor(db, league.seasonId, league.ids.priya)).toMatchObject({ played: 0, points: 0 });
	});

	it('an admin correction recalculates the table from the corrected result', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');
		reviewResult(
			db,
			{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'confirm' },
			{ now: NOW }
		);
		correctResult(
			db,
			{
				fixtureId: league.fixtureId,
				actorPlayerId: league.ids.ada,
				values: entry(league, ['priya', 'priya', 'maya']),
				reason: 'Both players checked the score sheet: Priya took frame 2 on the pink.'
			},
			{ now: NOW }
		);
		expect(pointsFor(db, league.seasonId, league.ids.priya)).toMatchObject({ points: 2, wins: 1 });
		expect(pointsFor(db, league.seasonId, league.ids.maya)).toMatchObject({ points: 1, wins: 0 });
	});
});

describe('the audit trail', () => {
	it('records who did what, in order, for the whole journey', () => {
		const db = freshDb();
		const league = resultLeague(db);
		const submitted = submit(db, league, 'maya');
		reviewResult(
			db,
			{
				fixtureId: league.fixtureId,
				actorPlayerId: league.ids.priya,
				decision: 'send_back',
				reason: 'Frame 2 was 65–47'
			},
			{ now: NOW }
		);
		submit(db, league, 'maya');
		reviewResult(
			db,
			{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'confirm' },
			{ now: NOW }
		);
		const audit = loadResultAudit(db, submitted.resultId);
		expect(audit.map((row) => row.action)).toEqual(['submitted', 'sent_back', 'resubmitted', 'confirmed']);
		expect(audit.map((row) => row.actorName)).toEqual([
			'Maya Test',
			'Priya Test',
			'Maya Test',
			'Priya Test'
		]);
		expect(audit.find((row) => row.action === 'sent_back')?.reason).toMatch(/65–47/);
	});

	it('keeps the reason with a post-approval correction, alongside before and after', () => {
		const db = freshDb();
		const league = resultLeague(db);
		const submitted = submit(db, league, 'maya');
		reviewResult(
			db,
			{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'confirm' },
			{ now: NOW }
		);
		correctResult(
			db,
			{
				fixtureId: league.fixtureId,
				actorPlayerId: league.ids.root,
				values: entry(league, ['priya', 'priya', 'maya'], { date: '2026-09-21' }),
				reason: 'Score sheet photograph: Priya won 2–1 on the 21st.'
			},
			{ now: NOW }
		);
		const correction = loadResultAudit(db, submitted.resultId).find((row) => row.action === 'corrected');
		expect(correction?.actorName).toBe('Root Test');
		expect(correction?.reason).toMatch(/Score sheet photograph/);
		const detail = correction?.detail as {
			before: { actualPlayedDate: string; frames: number[] };
			after: { actualPlayedDate: string; frames: number[] };
		};
		expect(detail.before).toMatchObject({ actualPlayedDate: PLAYED });
		expect(detail.after).toMatchObject({ actualPlayedDate: '2026-09-21' });
		expect(detail.before.frames).not.toEqual(detail.after.frames);
	});

	it('preserves the original confirmation when an admin corrects a result', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');
		reviewResult(
			db,
			{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'confirm' },
			{ now: NOW }
		);
		const outcome = correctResult(
			db,
			{
				fixtureId: league.fixtureId,
				actorPlayerId: league.ids.ada,
				values: entry(league, ['maya', 'priya', 'maya']),
				reason: 'Frame order was recorded the wrong way round.'
			},
			{ now: NOW }
		);
		expect(outcome.revision).toBe(2);
		const record = loadResultRecord(db, league.fixtureId);
		expect(record?.confirmedByName).toBe('Priya Test');
		expect(record?.correctedByName).toBe('Ada Test');
		expect(record?.correctionReason).toMatch(/wrong way round/);
		expect(record?.submittedByName).toBe('Maya Test');
	});

	it('makes a correction reason mandatory after approval', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');
		reviewResult(
			db,
			{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'confirm' },
			{ now: NOW }
		);
		for (const reason of [null, '', '   ', 'no']) {
			expect(
				complaints(() =>
					correctResult(
						db,
						{
							fixtureId: league.fixtureId,
							actorPlayerId: league.ids.ada,
							values: entry(league, ['maya', 'priya', 'maya']),
							reason
						},
						{ now: NOW }
					)
				).join(' ')
			).toMatch(/reason is required/);
		}
		expect(loadResultRecord(db, league.fixtureId)?.revision).toBe(1);
	});

	it('flags an award that takes its value from a corrected result', () => {
		const db = freshDb();
		const league = resultLeague(db);
		const submitted = submit(db, league, 'maya');
		reviewResult(
			db,
			{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'confirm' },
			{ now: NOW }
		);
		createAward(db, {
			fixtureId: league.otherFixtureId,
			playerId: league.ids.leon,
			tablePoints: 2,
			sourceType: 'previous_round_result',
			sourceResultId: submitted.resultId,
			createdByPlayerId: league.ids.ada,
			reason: 'Highest aggregate from the previous round.'
		});
		const outcome = correctResult(
			db,
			{
				fixtureId: league.fixtureId,
				actorPlayerId: league.ids.ada,
				values: entry(league, ['priya', 'priya', 'maya']),
				reason: 'Priya actually won 2–1; the award was calculated from the wrong scoreline.'
			},
			{ now: NOW }
		);
		expect(outcome.awardReviewNeeded).toBe(true);
		expect(auditActions(db, submitted.resultId)).toContain('award_review_needed');
	});

	it('does not flag awards when the corrected result is not a source', () => {
		const db = freshDb();
		const league = resultLeague(db);
		const submitted = submit(db, league, 'maya');
		reviewResult(
			db,
			{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'confirm' },
			{ now: NOW }
		);
		const outcome = correctResult(
			db,
			{
				fixtureId: league.fixtureId,
				actorPlayerId: league.ids.ada,
				values: entry(league, ['maya', 'priya', 'maya']),
				reason: 'Frame order corrected.'
			},
			{ now: NOW }
		);
		expect(outcome.awardReviewNeeded).toBe(false);
		expect(auditActions(db, submitted.resultId)).not.toContain('award_review_needed');
	});
});

describe('the permission matrix', () => {
	it('a participant may submit, the opponent may review, an outsider may do neither', () => {
		const db = freshDb();
		const league = resultLeague(db);
		const maya = resultPermissions(db, league.fixtureId, league.ids.maya);
		const priya = resultPermissions(db, league.fixtureId, league.ids.priya);
		const leon = resultPermissions(db, league.fixtureId, league.ids.leon);
		const nobody = resultPermissions(db, league.fixtureId, null);

		expect(maya).toMatchObject({ isParticipant: true, canSubmit: true, canReview: false });
		expect(priya).toMatchObject({ isParticipant: true, canSubmit: true });
		expect(leon).toMatchObject({ isParticipant: false, canSubmit: false, canReview: false, canCorrect: false });
		expect(leon.submitReason).toMatch(/Only the two players/);
		expect(nobody.canSubmit).toBe(false);
		expect(nobody.submitReason).toMatch(/Sign in/);
	});

	it('once submitted, only the other player can review it', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');
		const maya = resultPermissions(db, league.fixtureId, league.ids.maya);
		const priya = resultPermissions(db, league.fixtureId, league.ids.priya);
		const leon = resultPermissions(db, league.fixtureId, league.ids.leon);
		expect(maya).toMatchObject({ isSubmitter: true, canReview: false, canSubmit: false });
		expect(priya).toMatchObject({ isReviewingOpponent: true, canReview: true });
		expect(leon.canReview).toBe(false);
		expect(() => submit(db, league, 'priya')).toThrow(ResultPermissionError);
	});

	it('after approval only an admin can change the result', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');
		reviewResult(
			db,
			{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'confirm' },
			{ now: NOW }
		);
		const maya = resultPermissions(db, league.fixtureId, league.ids.maya);
		const priya = resultPermissions(db, league.fixtureId, league.ids.priya);
		const ada = resultPermissions(db, league.fixtureId, league.ids.ada);
		expect(maya).toMatchObject({ canSubmit: false, canCorrect: false, canResubmit: false });
		expect(maya.submitReason).toMatch(/Only an admin can change it/);
		expect(priya.canCorrect).toBe(false);
		expect(ada).toMatchObject({ canCorrect: true, canSubmit: false, adminOverride: true });
		expect(() =>
			correctResult(
				db,
				{
					fixtureId: league.fixtureId,
					actorPlayerId: league.ids.maya,
					values: entry(league, ['priya', 'priya', 'maya']),
					reason: 'I would like to change my own confirmed result.'
				},
				{ now: NOW }
			)
		).toThrow(ResultPermissionError);
	});

	it('refuses an ordinary admin direct entry: only a super-admin skips approval', () => {
		const db = freshDb();
		const league = resultLeague(db);
		const ada = resultPermissions(db, league.fixtureId, league.ids.ada);
		const root = resultPermissions(db, league.fixtureId, league.ids.root);
		expect(ada.canEnterDirectly).toBe(false);
		expect(root.canEnterDirectly).toBe(true);
		expect(() =>
			submitResult(
				db,
				{
					fixtureId: league.fixtureId,
					actorPlayerId: league.ids.ada,
					values: entry(league, ['maya', 'maya', 'priya']),
					direct: true,
					reason: 'Admin convenience.'
				},
				{ now: NOW }
			)
		).toThrow(ResultPermissionError);
	});

	it('a super-admin direct entry is confirmed at once and audited with its reason', () => {
		const db = freshDb();
		const league = resultLeague(db);
		const outcome = submitResult(
			db,
			{
				fixtureId: league.fixtureId,
				actorPlayerId: league.ids.root,
				values: entry(league, ['maya', 'maya', 'priya']),
				direct: true,
				reason: 'Both players confirmed the sheet by message; neither can sign in yet.'
			},
			{ now: NOW }
		);
		expect(outcome).toMatchObject({ status: 'confirmed', mode: 'direct' });
		const record = loadResultRecord(db, league.fixtureId);
		expect(record?.entrySource).toBe('admin_direct');
		expect(record?.confirmedByName).toBe('Root Test');
		expect(auditActions(db, outcome.resultId)).toEqual(['direct_entry']);
		expect(loadResultAudit(db, outcome.resultId)[0]?.reason).toMatch(/neither can sign in/);
		// A direct entry counts immediately: no opponent confirmation exists.
		expect(pointsFor(db, league.seasonId, league.ids.maya)).toMatchObject({ played: 1, points: 2 });
	});

	it('a direct entry without a reason is refused', () => {
		const db = freshDb();
		const league = resultLeague(db);
		expect(
			complaints(() =>
				submitResult(
					db,
					{
						fixtureId: league.fixtureId,
						actorPlayerId: league.ids.root,
						values: entry(league, ['maya', 'maya', 'priya']),
						direct: true
					},
					{ now: NOW }
				)
			).join(' ')
		).toMatch(/reason is required/);
		expect(loadResultRecord(db, league.fixtureId)).toBeNull();
	});
});

describe('retrospective entry for a neutrally closed fixture', () => {
	it('refuses a player, and refuses a date outside the deadline and grace window', () => {
		const db = freshDb();
		const league = resultLeague(db);
		closeFixtureNeutrally(db, league.fixtureId, AFTER_GRACE);
		expect(fixtureState(db, league.fixtureId)).toBe('closed_unplayed');

		expect(() => submitResult(
			db,
			{
				fixtureId: league.fixtureId,
				actorPlayerId: league.ids.maya,
				values: entry(league, ['maya', 'maya', 'priya'], { date: '2026-10-10' })
			},
			{ now: AFTER_GRACE }
		)).toThrow(ResultPermissionError);

		expect(
			complaints(() =>
				submitResult(
					db,
					{
						fixtureId: league.fixtureId,
						actorPlayerId: league.ids.ada,
						values: entry(league, ['maya', 'maya', 'priya'], { date: '2026-10-28' }),
						reason: 'Played after the grace period, recorded anyway.'
					},
					{ now: AFTER_GRACE }
				)
			).join(' ')
		).toMatch(/within this round’s deadline and grace period/);
	});

	it('records a genuine match played inside the window, confirmed, with a mandatory reason', () => {
		const db = freshDb();
		const league = resultLeague(db);
		closeFixtureNeutrally(db, league.fixtureId, AFTER_GRACE);
		expect(
			complaints(() =>
				submitResult(
					db,
					{
						fixtureId: league.fixtureId,
						actorPlayerId: league.ids.ada,
						values: entry(league, ['maya', 'maya', 'priya'], { date: '2026-10-10' })
					},
					{ now: AFTER_GRACE }
				)
			).join(' ')
		).toMatch(/reason is required/);

		const outcome = submitResult(
			db,
			{
				fixtureId: league.fixtureId,
				actorPlayerId: league.ids.ada,
				values: entry(league, ['maya', 'maya', 'priya'], { date: '2026-10-10' }),
				reason: 'Match genuinely played on 10 October; both players confirmed by message.'
			},
			{ now: AFTER_GRACE }
		);
		expect(outcome).toMatchObject({ status: 'confirmed', mode: 'retrospective' });
		const record = loadResultRecord(db, league.fixtureId);
		expect(record?.entrySource).toBe('admin_retrospective');
		expect(record?.actualPlayedDate).toBe('2026-10-10');
		expect(auditActions(db, outcome.resultId)).toEqual(['retrospective_recorded']);
		expect(pointsFor(db, league.seasonId, league.ids.maya)).toMatchObject({ played: 1, points: 2 });
	});
});

describe('optional details are locked after submission', () => {
	it('a player resubmission may fix values but not add frame points or breaks', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya', entry(league, ['maya', 'maya', 'priya']));
		reviewResult(
			db,
			{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'send_back', reason: 'date was wrong' },
			{ now: NOW }
		);
		const messages = complaints(() =>
			submit(db, league, 'maya', entry(league, ['maya', 'maya', 'priya'], { points: scoresFor(league, [[65, 38], [65, 41], [38, 65]]) }))
		);
		expect(messages.join(' ')).toMatch(/cannot be added after submission/);

		const withBreaks = complaints(() =>
			submit(db, league, 'maya', entry(league, ['maya', 'maya', 'priya'], { breaks: breaksFor(league, { maya: 68 }) }))
		);
		expect(withBreaks.join(' ')).toMatch(/highest break cannot be added after submission/);
		expect(loadResultRecord(db, league.fixtureId)?.status).toBe('sent_back');
	});

	it('an admin resubmission may add the missing detail, with a reason', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya', entry(league, ['maya', 'maya', 'priya']));
		reviewResult(
			db,
			{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'send_back', reason: 'date was wrong' },
			{ now: NOW }
		);
		expect(() =>
			submitResult(
				db,
				{
					fixtureId: league.fixtureId,
					actorPlayerId: league.ids.ada,
					values: entry(league, ['maya', 'maya', 'priya'], { points: scoresFor(league, [[65, 38], [65, 41], [38, 65]]) })
				},
				{ now: NOW }
			)
		).toThrow(ResultValidationError);

		const outcome = submitResult(
			db,
			{
				fixtureId: league.fixtureId,
				actorPlayerId: league.ids.ada,
				values: entry(league, ['maya', 'maya', 'priya'], {
					points: scoresFor(league, [[65, 38], [65, 41], [38, 65]]),
					breaks: breaksFor(league, { maya: 65 })
				}),
				reason: 'Both players sent the score sheet; recording the detail they provided.'
			},
			{ now: NOW }
		);
		expect(outcome.mode).toBe('resubmitted');
		const record = loadResultRecord(db, league.fixtureId);
		expect(record?.hasFramePoints).toBe(true);
		expect(record?.hasBreaks).toBe(true);
		expect(record?.submittedByName).toBe('Maya Test');
	});

	it('a first submission with partial frame detail is refused outright', () => {
		const db = freshDb();
		const league = resultLeague(db);
		const values = entry(league, ['maya', 'maya', 'priya']);
		values.framePoints = [
			{ low: '65', high: '38' },
			{ low: '', high: '' },
			{ low: '', high: '' }
		];
		expect(complaints(() => submit(db, league, 'maya', values)).join(' ')).toMatch(
			/Enter the point scores for all 3 frames, or leave them all blank/
		);
	});
});

describe('review queue and activity surfaces', () => {
	it('lists unconfirmed results and flags the ones waiting on the viewer', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');

		const forPriya = loadAwaitingReview(db, { viewerPlayerId: league.ids.priya });
		expect(forPriya).toHaveLength(1);
		expect(forPriya[0]).toMatchObject({
			fixtureId: league.fixtureId,
			needsMyReview: true,
			canReview: true,
			actualPlayedDate: PLAYED,
			submittedByName: 'Maya Test',
			reviewerName: 'Priya Test'
		});

		const forMaya = loadAwaitingReview(db, { viewerPlayerId: league.ids.maya });
		expect(forMaya[0]).toMatchObject({ needsMyReview: false, canReview: false });

		const forLeon = loadAwaitingReview(db, { viewerPlayerId: league.ids.leon });
		expect(forLeon[0]).toMatchObject({ needsMyReview: false, canReview: false });

		const anonymous = loadAwaitingReview(db, { viewerPlayerId: null });
		expect(anonymous[0]).toMatchObject({ needsMyReview: false, canReview: false });
	});

	it('drops confirmed results out of the queue', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');
		expect(loadAwaitingReview(db, { viewerPlayerId: league.ids.priya })).toHaveLength(1);
		reviewResult(
			db,
			{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'confirm' },
			{ now: NOW }
		);
		expect(loadAwaitingReview(db, { viewerPlayerId: league.ids.priya })).toHaveLength(0);
	});

	it('feeds the league-wide activity log newest first', () => {
		const db = freshDb();
		const league = resultLeague(db);
		submit(db, league, 'maya');
		reviewResult(
			db,
			{ fixtureId: league.fixtureId, actorPlayerId: league.ids.priya, decision: 'confirm' },
			{ now: NOW }
		);
		const activity = loadResultActivity(db, 10);
		expect(activity.map((row) => row.action)).toEqual(['confirmed', 'submitted']);
		expect(activity[0]).toMatchObject({
			fixtureId: league.fixtureId,
			roundNumber: 1,
			players: 'Maya Test v Priya Test',
			actualPlayedDate: PLAYED
		});
	});
});
