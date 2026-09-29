import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { runMigrations } from '../src/lib/server/migrate';
import { seedAll } from '../src/lib/server/seed';
import { computeStandings } from '../src/lib/server/standings';
import {
	drawKnockoutOpeningStage,
	finaliseKnockoutEntry,
	KnockoutPermissionError,
	KnockoutValidationError,
	loadKnockoutCompetitions,
	respondToKnockoutInvitation
} from '../src/lib/server/knockout';
import {
	correctKnockoutResult,
	cancelKnockoutArrangement,
	drawKnockoutNextStage,
	livePlayerIds,
	nudgeKnockoutOpponent,
	proposeKnockoutArrangement,
	recordKnockoutDropout,
	recordKnockoutResult
} from '../src/lib/server/knockout-progression';
import {
	assessKnockoutResultForm,
	knockoutStageLabel,
	planStageFromOrder,
	validateKnockoutFrames
} from '../src/lib/knockout-progression';

const migrations = path.resolve(process.cwd(), 'migrations');
const databases: Db[] = [];
const openingTime = new Date('2026-04-01T12:00:00.000Z');
const deadline = new Date('2026-04-05T12:00:00.000Z');
const drawTime = new Date('2026-04-05T12:10:00.000Z');
const playDay = '2026-04-08';

function freshDb(): Db {
	const file = path.join(os.tmpdir(), `minsnooks-ko-prog-${Date.now()}-${Math.random()}.db`);
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

interface TestPeople {
	adminId: number;
	playerIds: number[];
}

function addPeople(db: Db, count = 10): TestPeople {
	const insert = db.prepare(
		`INSERT INTO players (email, display_name, initials, avatar_tone, role, is_active)
		 VALUES (?, ?, ?, 'maya', ?, ?)`
	);
	const adminId = Number(
		insert.run('admin@example.test', 'Admin', 'AD', 'admin', 1).lastInsertRowid
	);
	const playerIds = Array.from({ length: count }, (_, index) =>
		Number(
			insert
				.run(`player${index + 1}@example.test`, `Player ${index + 1}`, `P${index + 1}`, 'player', 1)
				.lastInsertRowid
		)
	);
	return { adminId, playerIds };
}

function seededRandom(seed: number): (maxExclusive: number) => number {
	let state = seed >>> 0;
	return (maxExclusive) => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state % maxExclusive;
	};
}

function count(db: Db, table: string): number {
	return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function auditActions(db: Db, competitionId: number): string[] {
	return (
		db
			.prepare(
				`SELECT action FROM audit_log WHERE entity_type = 'knockout_competition' AND entity_id = ? ORDER BY id`
			)
			.all(competitionId) as Array<{ action: string }>
	).map((row) => row.action);
}

interface StartedCompetition {
	competitionId: number;
	openingStageId: number;
	matchupCount: number;
	byeCount: number;
	tieIds: number[];
}

/** Invitation → six/eight entrants → selection → opening draw, all server paths. */
function startCompetition(
	db: Db,
	people: TestPeople,
	options: { entrants: number; framesToWin?: number; seed?: number } = { entrants: 8 }
): StartedCompetition {
	const framesToWin = options.framesToWin ?? 3;
	const rng = seededRandom(options.seed ?? 31);
	const competitionId = Number(
		db
			.prepare(
				`INSERT INTO knockout_competitions (
					title, announcement, created_by_player_id, created_at, reply_deadline_at, frames_to_win, status
				) VALUES ('Progression Cup', '', ?, ?, ?, ?, 'inviting')`
			)
			.run(people.adminId, openingTime.toISOString(), deadline.toISOString(), framesToWin).lastInsertRowid
	);
	for (const playerId of people.playerIds.slice(0, options.entrants)) {
		respondToKnockoutInvitation(db, { competitionId, actorPlayerId: playerId, optedIn: true }, { now: openingTime });
	}
	finaliseKnockoutEntry(db, { competitionId, actorPlayerId: people.adminId }, { now: deadline, randomInt: rng });
	const draw = drawKnockoutOpeningStage(
		db,
		{ competitionId, actorPlayerId: people.adminId },
		{ now: drawTime, randomInt: rng }
	);
	const ties = db
		.prepare(
			`SELECT id FROM knockout_ties WHERE stage_id = ? AND tie_type = 'match' ORDER BY tie_number`
		)
		.all(draw.stageId) as Array<{ id: number }>;
	return {
		competitionId,
		openingStageId: draw.stageId,
		matchupCount: draw.matchups.length,
		byeCount: draw.byePlayerIds.length,
		tieIds: ties.map((row) => row.id)
	};
}

/** Winner frames for a first-to-N result won by `winnerId` over `loserId`. */
function framesFor(winnerId: number, loserId: number, winnerFrames: number, loserFrames: number) {
	const pattern: Array<{ frameNumber: number; winnerPlayerId: number }> = [];
	for (let index = 0; index < winnerFrames + loserFrames; index++) {
		// Interleave so the loser's frames come before the winner's last one.
		const winnerStillToPlay = winnerFrames - pattern.filter((f) => f.winnerPlayerId === winnerId).length;
		const framesLeft = winnerFrames + loserFrames - index;
		const pickWinner = winnerStillToPlay === framesLeft || (index % 2 === 0 && winnerStillToPlay > 0);
		pattern.push({ frameNumber: index + 1, winnerPlayerId: pickWinner ? winnerId : loserId });
	}
	return pattern;
}

function tieWinner(db: Db, tieId: number): number | null {
	return (
		db.prepare('SELECT winner_player_id AS w FROM knockout_ties WHERE id = ?').get(tieId) as {
			w: number | null;
		}
	).w;
}

function latestStageId(db: Db, competitionId: number): number {
	return (
		db
			.prepare('SELECT id FROM knockout_stages WHERE competition_id = ? ORDER BY stage_number DESC LIMIT 1')
			.get(competitionId) as { id: number }
	).id;
}

function stageTieIds(db: Db, stageId: number): number[] {
	return (
		db
			.prepare(`SELECT id FROM knockout_ties WHERE stage_id = ? AND tie_type = 'match' ORDER BY tie_number`)
			.all(stageId) as Array<{ id: number }>
	).map((row) => row.id);
}

describe('Phase 12 pure progression rules', () => {
	it('plans opening stages with the Phase 11 bye arithmetic', () => {
		expect(planStageFromOrder([1, 2, 3, 4, 5, 6], 'opening')).toEqual({
			matchups: [
				[3, 4],
				[5, 6]
			],
			byePlayerIds: [1, 2]
		});
		expect(planStageFromOrder([1, 2, 3, 4, 5, 6, 7], 'opening').byePlayerIds).toEqual([1]);
		expect(planStageFromOrder([1, 2, 3, 4, 5, 6, 7, 8], 'opening')).toEqual({
			matchups: [
				[1, 2],
				[3, 4],
				[5, 6],
				[7, 8]
			],
			byePlayerIds: []
		});
		// Pairs are canonical low–high regardless of order.
		const plan = planStageFromOrder([9, 4, 7, 2, 5, 8], 'opening');
		for (const [low, high] of plan.matchups) expect(low).toBeLessThan(high);
		expect(() => planStageFromOrder([1, 2, 3, 4, 5], 'opening')).toThrow(/six, seven, or eight/);
	});

	it('pairs later stages and gives a bye only for an odd field', () => {
		expect(planStageFromOrder([1, 2, 3, 4], 'later').matchups).toHaveLength(2);
		const three = planStageFromOrder([1, 2, 3], 'later');
		expect(three).toEqual({ matchups: [[2, 3]], byePlayerIds: [1] });
		expect(planStageFromOrder([1, 2], 'later')).toEqual({ matchups: [[1, 2]], byePlayerIds: [] });
		expect(planStageFromOrder([1, 2, 3, 4, 5], 'later').byePlayerIds).toEqual([1]);
		expect(() => planStageFromOrder([1], 'later')).toThrow(/at least two/);
	});

	it('labels stages by the players entering them', () => {
		expect(knockoutStageLabel(8)).toBe('Opening round');
		expect(knockoutStageLabel(6)).toBe('Opening round');
		expect(knockoutStageLabel(4)).toBe('Semi-finals');
		expect(knockoutStageLabel(3)).toBe('Play-in round');
		expect(knockoutStageLabel(2)).toBe('Final');
	});

	it('enforces first-to-N with play stopping at the target', () => {
		const facts = { playerLowId: 1, playerHighId: 2, framesToWin: 3 };
		const fine = validateKnockoutFrames({
			...facts,
			frames: [
				{ frameNumber: 1, winnerPlayerId: 1 },
				{ frameNumber: 2, winnerPlayerId: 2 },
				{ frameNumber: 3, winnerPlayerId: 1 },
				{ frameNumber: 4, winnerPlayerId: 1 }
			]
		});
		expect(fine.ok).toBe(true);
		expect(fine.winnerPlayerId).toBe(1);
		expect(fine.lowFrames).toBe(3);
		expect(fine.highFrames).toBe(1);

		const longest = validateKnockoutFrames({
			...facts,
			frames: [
				{ frameNumber: 1, winnerPlayerId: 1 },
				{ frameNumber: 2, winnerPlayerId: 2 },
				{ frameNumber: 3, winnerPlayerId: 1 },
				{ frameNumber: 4, winnerPlayerId: 2 },
				{ frameNumber: 5, winnerPlayerId: 1 }
			]
		});
		expect(longest.ok).toBe(true);
		expect(longest.winnerPlayerId).toBe(1);

		const afterTarget = validateKnockoutFrames({
			...facts,
			frames: [
				{ frameNumber: 1, winnerPlayerId: 1 },
				{ frameNumber: 2, winnerPlayerId: 1 },
				{ frameNumber: 3, winnerPlayerId: 1 },
				{ frameNumber: 4, winnerPlayerId: 2 }
			]
		});
		expect(afterTarget.ok).toBe(false);
		expect(afterTarget.errors.join(' ')).toMatch(/stops once a player reaches 3/);

		const unfinished = validateKnockoutFrames({
			...facts,
			frames: [
				{ frameNumber: 1, winnerPlayerId: 1 },
				{ frameNumber: 2, winnerPlayerId: 2 }
			]
		});
		expect(unfinished.ok).toBe(false);
		expect(unfinished.errors.join(' ')).toMatch(/must stop when a player reaches 3/);

		const outsider = validateKnockoutFrames({
			...facts,
			frames: [{ frameNumber: 1, winnerPlayerId: 9 }]
		});
		expect(outsider.ok).toBe(false);
		expect(outsider.errors.join(' ')).toMatch(/not in this tie/);

		const gapped = validateKnockoutFrames({
			...facts,
			frames: [
				{ frameNumber: 1, winnerPlayerId: 1 },
				{ frameNumber: 3, winnerPlayerId: 1 }
			]
		});
		expect(gapped.ok).toBe(false);
		expect(gapped.errors.join(' ')).toMatch(/consecutively/);
	});

	it('assesses the record form: gaps fail, blanks after the decider are fine, dates bound to today', () => {
		const context = {
			playerLowId: 1,
			playerHighId: 2,
			lowPlayerName: 'Low',
			highPlayerName: 'High',
			framesToWin: 2,
			today: '2026-04-08'
		};
		const clean = assessKnockoutResultForm(
			{ actualPlayedDate: '2026-04-08', frameWinners: ['low', 'high', 'low'] },
			context
		);
		expect(clean.ok).toBe(true);
		expect(clean.winnerPlayerId).toBe(1);
		expect(clean.lowFrames).toBe(2);

		const gapped = assessKnockoutResultForm(
			{ actualPlayedDate: '2026-04-08', frameWinners: ['low', '', 'low'] },
			context
		);
		expect(gapped.ok).toBe(false);
		expect(gapped.errors.join(' ')).toMatch(/in order/);

		const future = assessKnockoutResultForm(
			{ actualPlayedDate: '2026-04-09', frameWinners: ['low', 'low'] },
			context
		);
		expect(future.ok).toBe(false);
		expect(future.errors.join(' ')).toMatch(/future/);
	});
});

describe('Phase 12 knockout progression', () => {
	it('plays an eight-player knockout through to a completed final without touching league data', () => {
		const db = freshDb();
		const league = seedAll(db); // league snapshot baseline
		const before = computeStandings(db, { seasonId: league.league.seasonId });
		const people = addPeople(db);
		const started = startCompetition(db, people, { entrants: 8, framesToWin: 3, seed: 5 });
		expect(started.matchupCount).toBe(4);

		// freshDb() includes the seeded preview knockouts; count results
		// relative to that baseline so this test only asserts its own writes.
		const resultsAtStart = count(db, 'knockout_tie_results');

		// Opening round: four played results.
		started.tieIds.forEach((tieId, index) => {
			const low = (
				db.prepare('SELECT player_low_id AS l, player_high_id AS h FROM knockout_ties WHERE id = ?').get(tieId) as {
					l: number;
					h: number;
				}
			);
			const winnerId = index % 2 === 0 ? low.l : low.h;
			const outcome = recordKnockoutResult(
				db,
				{
					tieId,
					actorPlayerId: winnerId,
					frames: framesFor(winnerId, winnerId === low.l ? low.h : low.l, 3, index % 2),
					actualPlayedDate: playDay
				},
				{ now: new Date('2026-04-08T15:00:00Z'), today: playDay }
			);
			expect(outcome.winnerPlayerId).toBe(winnerId);
		});

		// Semi-finals drawn fresh: two ties, no byes.
		const semis = drawKnockoutNextStage(
			db,
			{ competitionId: started.competitionId, actorPlayerId: people.adminId },
			{ now: new Date('2026-04-09T12:00:00Z'), randomInt: seededRandom(77) }
		);
		expect(semis.stageNumber).toBe(2);
		expect(semis.matchups).toHaveLength(2);
		const semiTieIds = stageTieIds(db, latestStageId(db, started.competitionId));
		let lastSemiOutcome: { stageResolved: boolean } | undefined;
		semiTieIds.forEach((tieId) => {
			const row = db
				.prepare('SELECT player_low_id AS l, player_high_id AS h FROM knockout_ties WHERE id = ?')
				.get(tieId) as { l: number; h: number };
			lastSemiOutcome = recordKnockoutResult(
				db,
				{
					tieId,
					actorPlayerId: row.l,
					frames: framesFor(row.l, row.h, 3, 1),
					actualPlayedDate: '2026-04-11'
				},
				{ now: new Date('2026-04-11T15:00:00Z'), today: '2026-04-11' }
			);
		});
		// Only the tie that completes the stage reports the stage as resolved.
		expect(lastSemiOutcome?.stageResolved).toBe(true);

		// The final, played to completion.
		const finalStage = drawKnockoutNextStage(
			db,
			{ competitionId: started.competitionId, actorPlayerId: people.adminId },
			{ now: new Date('2026-04-12T12:00:00Z'), randomInt: seededRandom(78) }
		);
		expect(finalStage.stageNumber).toBe(3);
		const finalTieId = stageTieIds(db, latestStageId(db, started.competitionId))[0];
		const finalRow = db
			.prepare('SELECT player_low_id AS l, player_high_id AS h FROM knockout_ties WHERE id = ?')
			.get(finalTieId) as { l: number; h: number };
		const finalOutcome = recordKnockoutResult(
			db,
			{
				tieId: finalTieId,
				actorPlayerId: finalRow.l,
				frames: framesFor(finalRow.l, finalRow.h, 3, 2),
				actualPlayedDate: '2026-04-14'
			},
			{ now: new Date('2026-04-14T15:00:00Z'), today: '2026-04-14' }
		);
		expect(finalOutcome.competitionComplete).toBe(true);
		expect(finalOutcome.competitionWinnerPlayerId).toBe(finalRow.l);
		expect((db.prepare('SELECT winner_player_id AS w, completed_at FROM knockout_competitions WHERE id = ?').get(started.competitionId) as { w: number; completed_at: string }).w).toBe(finalRow.l);

		const view = loadKnockoutCompetitions(db, finalRow.l).find(
			(item) => item.competitionId === started.competitionId
		)!;
		expect(view.winner?.playerId).toBe(finalRow.l);
		expect(view.completedAt).not.toBeNull();
		expect(view.stages).toHaveLength(3);
		expect(view.stages.map((stage) => stage.label)).toEqual(['Opening round', 'Semi-finals', 'Final']);
		expect(view.stages.every((stage) => stage.resolved)).toBe(true);
		const finalTie = view.stages[2].ties[0];
		expect(finalTie.frames).toHaveLength(5);
		expect(finalTie.viewer.canCorrect).toBe(false); // complete: frozen
		expect(view.history.map((entry) => entry.action)).toContain('competition_complete');

		// No invented league results and an unchanged league table.
		expect(count(db, 'fixtures')).toBe(168);
		expect(count(db, 'results')).toBe(138);
		expect(count(db, 'knockout_tie_results')).toBe(resultsAtStart + 7);
		const after = computeStandings(db, { seasonId: league.league.seasonId });
		expect(after.map((row) => [row.playerId, row.points])).toEqual(
			before.map((row) => [row.playerId, row.points])
		);
		// startCompetition raw-INSERTs the competition (no 'announced' row) and
		// every opt-in writes its own audit entry.
		expect(auditActions(db, started.competitionId)).toEqual([
			...Array.from({ length: 8 }, () => 'player_opted_in'),
			'entrants_selected',
			'opening_draw_saved',
			'match_result_recorded',
			'match_result_recorded',
			'match_result_recorded',
			'match_result_recorded',
			'stage_drawn',
			'match_result_recorded',
			'match_result_recorded',
			'stage_drawn',
			'match_result_recorded',
			'competition_complete'
		]);
	});

	it('refuses results that break the fixed format or double-resolve a tie', () => {
		const db = freshDb();
		const people = addPeople(db);
		// Seven entrants: three opening ties plus the bye the last block needs.
		const started = startCompetition(db, people, { entrants: 7, framesToWin: 3 });
		const tieId = started.tieIds[0];
		const row = db
			.prepare('SELECT player_low_id AS l, player_high_id AS h FROM knockout_ties WHERE id = ?')
			.get(tieId) as { l: number; h: number };

		expect(() =>
			recordKnockoutResult(
				db,
				{
					tieId,
					actorPlayerId: row.l,
					frames: [
						{ frameNumber: 1, winnerPlayerId: row.l },
						{ frameNumber: 2, winnerPlayerId: row.h }
					],
					actualPlayedDate: playDay
				},
				{ now: new Date('2026-04-08T10:00:00Z'), today: playDay }
			)
		).toThrow(KnockoutValidationError);

		expect(() =>
			recordKnockoutResult(
				db,
				{
					tieId,
					actorPlayerId: row.l,
					frames: [
						{ frameNumber: 1, winnerPlayerId: row.l },
						{ frameNumber: 2, winnerPlayerId: row.l },
						{ frameNumber: 3, winnerPlayerId: row.l },
						{ frameNumber: 4, winnerPlayerId: row.h }
					],
					actualPlayedDate: playDay
				},
				{ now: new Date('2026-04-08T10:00:00Z'), today: playDay }
			)
		).toThrow(/stops once a player reaches 3/);

		recordKnockoutResult(
			db,
			{
				tieId,
				actorPlayerId: row.l,
				frames: framesFor(row.l, row.h, 3, 1),
				actualPlayedDate: playDay
			},
			{ now: new Date('2026-04-08T10:00:00Z'), today: playDay }
		);
		expect(() =>
			recordKnockoutResult(
				db,
				{
					tieId,
					actorPlayerId: row.l,
					frames: framesFor(row.l, row.h, 3, 1),
					actualPlayedDate: playDay
				},
				{ now: new Date('2026-04-08T11:00:00Z'), today: playDay }
			)
		).toThrow(/already has a saved outcome/);

		const byeTie = (
			db
				.prepare(
					`SELECT id FROM knockout_ties WHERE stage_id = ? AND tie_type = 'bye' LIMIT 1`
				)
				.get(started.openingStageId) as { id: number }
		).id;
		expect(() =>
			recordKnockoutResult(
				db,
				{
					tieId: byeTie,
					actorPlayerId: people.adminId,
					frames: framesFor(people.playerIds[0], people.playerIds[1], 3, 0),
					actualPlayedDate: playDay
				},
				{ now: new Date('2026-04-08T10:00:00Z'), today: playDay }
			)
		).toThrow(/not matches/);
	});

	it('waits for a resolved stage before drawing the next one and gates draws to admins', () => {
		const db = freshDb();
		const people = addPeople(db);
		const started = startCompetition(db, people, { entrants: 8, framesToWin: 2 });
		expect(() =>
			drawKnockoutNextStage(
				db,
				{ competitionId: started.competitionId, actorPlayerId: people.adminId },
				{ now: drawTime, randomInt: seededRandom(9) }
			)
		).toThrow(/unresolved/);

		// Play all four opening ties.
		started.tieIds.forEach((tieId) => {
			const row = db
				.prepare('SELECT player_low_id AS l, player_high_id AS h FROM knockout_ties WHERE id = ?')
				.get(tieId) as { l: number; h: number };
			recordKnockoutResult(
				db,
				{ tieId, actorPlayerId: row.l, frames: framesFor(row.l, row.h, 2, 0), actualPlayedDate: playDay },
				{ now: new Date('2026-04-08T10:00:00Z'), today: playDay }
			);
		});
		expect(() =>
			drawKnockoutNextStage(
				db,
				{ competitionId: started.competitionId, actorPlayerId: people.playerIds[0] },
				{ now: new Date('2026-04-09T12:00:00Z'), randomInt: seededRandom(9) }
			)
		).toThrow(KnockoutPermissionError);
		const next = drawKnockoutNextStage(
			db,
			{ competitionId: started.competitionId, actorPlayerId: people.adminId },
			{ now: new Date('2026-04-09T12:00:00Z'), randomInt: seededRandom(9) }
		);
		expect(next.matchups).toHaveLength(2);
		expect(next.byePlayerIds).toHaveLength(0);
	});

	it('advances the opponent on a paired dropout without inventing a result', () => {
		const db = freshDb();
		const people = addPeople(db);
		const started = startCompetition(db, people, { entrants: 8, framesToWin: 3 });
		const tieId = started.tieIds[0];
		const row = db
			.prepare('SELECT player_low_id AS l, player_high_id AS h FROM knockout_ties WHERE id = ?')
			.get(tieId) as { l: number; h: number };

		const outcome = recordKnockoutDropout(
			db,
			{
				competitionId: started.competitionId,
				playerId: row.l,
				actorPlayerId: people.adminId,
				reason: 'Moved away mid-competition.'
			},
			{ now: new Date('2026-04-06T12:00:00Z') }
		);
		expect(outcome.dropoutKind).toBe('paired');
		expect(outcome.opponentPlayerId).toBe(row.h);
		expect(tieWinner(db, tieId)).toBe(row.h);
		expect(count(db, 'knockout_tie_results')).toBe(0);
		expect(
			(db.prepare('SELECT resolved_type AS r FROM knockout_ties WHERE id = ?').get(tieId) as { r: string }).r
		).toBe('walkover');
		expect(
			db
				.prepare("SELECT reason FROM audit_log WHERE action = 'dropout_recorded' AND entity_id = ?")
				.get(started.competitionId)
		).toBeTruthy();

		// Double dropout is refused; the stage is drawable with the walkover in place.
		expect(() =>
			recordKnockoutDropout(
				db,
				{
					competitionId: started.competitionId,
					playerId: row.l,
					actorPlayerId: people.adminId,
					reason: 'Again'
				},
				{ now: new Date('2026-04-06T13:00:00Z') }
			)
		).toThrow(/already been recorded/);

		// Non-admin dropouts are refused.
		expect(() =>
			recordKnockoutDropout(
				db,
				{
					competitionId: started.competitionId,
					playerId: row.h,
					actorPlayerId: people.playerIds[5],
					reason: 'Not an admin'
				},
				{ now: new Date('2026-04-06T13:00:00Z') }
			)
		).toThrow(KnockoutPermissionError);

		// Play the remaining three ties; stage 2 draws from four players.
		started.tieIds.slice(1).forEach((tieId) => {
			const other = db
				.prepare('SELECT player_low_id AS l, player_high_id AS h FROM knockout_ties WHERE id = ?')
				.get(tieId) as { l: number; h: number };
			recordKnockoutResult(
				db,
				{ tieId, actorPlayerId: other.l, frames: framesFor(other.l, other.h, 3, 0), actualPlayedDate: playDay },
				{ now: new Date('2026-04-08T10:00:00Z'), today: playDay }
			);
		});
		const stageTwo = drawKnockoutNextStage(
			db,
			{ competitionId: started.competitionId, actorPlayerId: people.adminId },
			{ now: new Date('2026-04-09T12:00:00Z'), randomInt: seededRandom(12) }
		);
		expect(stageTwo.advancingPlayerIds).toContain(row.h);
		expect(stageTwo.advancingPlayerIds).not.toContain(row.l);
		expect(stageTwo.matchups).toHaveLength(2);
	});

	it('voids a bye-holder dropout and draws the next stage afresh — never from the waiting list', () => {
		const db = freshDb();
		const people = addPeople(db, 10);
		// 9 opt-ins → 8 selected + 1 waiting; a bye-holder only exists with 6–7,
		// so use a 7-entrant draw where the void must shrink the next stage.
		const started = startCompetition(db, people, { entrants: 7, framesToWin: 3, seed: 21 });
		expect(started.byeCount).toBe(1);
		const byeHolder = (
			db
				.prepare(`SELECT bye_player_id AS b FROM knockout_ties WHERE stage_id = ? AND tie_type = 'bye'`)
				.get(started.openingStageId) as { b: number }
		).b;

		const outcome = recordKnockoutDropout(
			db,
			{
				competitionId: started.competitionId,
				playerId: byeHolder,
				actorPlayerId: people.adminId,
				reason: 'Withdrew before playing a tie.'
			},
			{ now: new Date('2026-04-06T12:00:00Z') }
		);
		expect(outcome.dropoutKind).toBe('bye');
		const byeTie = db
			.prepare(`SELECT id, resolved_type AS r, winner_player_id AS w FROM knockout_ties WHERE stage_id = ? AND tie_type = 'bye'`)
			.get(started.openingStageId) as { id: number; r: string; w: number | null };
		expect(byeTie.r).toBe('void');
		expect(byeTie.w).toBeNull();

		started.tieIds.forEach((tieId) => {
			const row = db
				.prepare('SELECT player_low_id AS l, player_high_id AS h FROM knockout_ties WHERE id = ?')
				.get(tieId) as { l: number; h: number };
			recordKnockoutResult(
				db,
				{ tieId, actorPlayerId: row.l, frames: framesFor(row.l, row.h, 3, 0), actualPlayedDate: playDay },
				{ now: new Date('2026-04-08T10:00:00Z'), today: playDay }
			);
		});

		const stageTwo = drawKnockoutNextStage(
			db,
			{ competitionId: started.competitionId, actorPlayerId: people.adminId },
			{ now: new Date('2026-04-09T12:00:00Z'), randomInt: seededRandom(31) }
		);
		// Three players remain: one semi-final plus one fresh bye — and never a
		// replacement from the waiting list.
		expect(stageTwo.advancingPlayerIds).toHaveLength(3);
		expect(stageTwo.matchups).toHaveLength(1);
		expect(stageTwo.byePlayerIds).toHaveLength(1);
		expect(stageTwo.advancingPlayerIds).not.toContain(byeHolder);
		const selectedCount = (
			db
				.prepare("SELECT COUNT(*) AS n FROM knockout_entries WHERE competition_id = ? AND entry_status = 'selected'")
				.get(started.competitionId) as { n: number }
		).n;
		expect(selectedCount).toBe(7);
		const stageTwoPlayers = (
			db
				.prepare(
					`SELECT COUNT(DISTINCT p.player_low_id) + COUNT(DISTINCT p.player_high_id) + COUNT(DISTINCT p.bye_player_id) AS n
					 FROM knockout_ties p WHERE p.stage_id = ?`
				)
				.get(latestStageId(db, started.competitionId)) as { n: number }
		).n;
		expect(stageTwoPlayers).toBe(3);

		// Play the semi-final: two advance, and the dropouts stay excluded.
		const semiTie = stageTieIds(db, latestStageId(db, started.competitionId))[0];
		const row = db
			.prepare('SELECT player_low_id AS l, player_high_id AS h FROM knockout_ties WHERE id = ?')
			.get(semiTie) as { l: number; h: number };
		const played = recordKnockoutResult(
			db,
			{ tieId: semiTie, actorPlayerId: row.l, frames: framesFor(row.l, row.h, 3, 1), actualPlayedDate: playDay },
			{ now: new Date('2026-04-10T10:00:00Z'), today: playDay }
		);
		expect(played.stageResolved).toBe(true);
		expect(livePlayerIds(db, started.competitionId)).toHaveLength(2);
		const view = loadKnockoutCompetitions(db, people.adminId).find(
			(item) => item.competitionId === started.competitionId
		)!;
		expect(view.nextStageReady).toBe(true);
		expect(view.stages[1].label).toBe('Play-in round');
	});

	it('completes by attrition when a finalist drops out, and can end with no winner at all', () => {
		const db = freshDb();
		const people = addPeople(db);
		const started = startCompetition(db, people, { entrants: 8, framesToWin: 2, seed: 44 });
		started.tieIds.forEach((tieId) => {
			const row = db
				.prepare('SELECT player_low_id AS l, player_high_id AS h FROM knockout_ties WHERE id = ?')
				.get(tieId) as { l: number; h: number };
			recordKnockoutResult(
				db,
				{ tieId, actorPlayerId: row.l, frames: framesFor(row.l, row.h, 2, 1), actualPlayedDate: playDay },
				{ now: new Date('2026-04-08T10:00:00Z'), today: playDay }
			);
		});
		drawKnockoutNextStage(
			db,
			{ competitionId: started.competitionId, actorPlayerId: people.adminId },
			{ now: new Date('2026-04-09T12:00:00Z'), randomInt: seededRandom(45) }
		);
		const semiTieIds = stageTieIds(db, latestStageId(db, started.competitionId));
		semiTieIds.forEach((tieId) => {
			const row = db
				.prepare('SELECT player_low_id AS l, player_high_id AS h FROM knockout_ties WHERE id = ?')
				.get(tieId) as { l: number; h: number };
			recordKnockoutResult(
				db,
				{ tieId, actorPlayerId: row.l, frames: framesFor(row.l, row.h, 2, 0), actualPlayedDate: playDay },
				{ now: new Date('2026-04-10T10:00:00Z'), today: playDay }
			);
		});
		drawKnockoutNextStage(
			db,
			{ competitionId: started.competitionId, actorPlayerId: people.adminId },
			{ now: new Date('2026-04-11T12:00:00Z'), randomInt: seededRandom(46) }
		);
		const finalTieId = stageTieIds(db, latestStageId(db, started.competitionId))[0];
		const finalRow = db
			.prepare('SELECT player_low_id AS l, player_high_id AS h FROM knockout_ties WHERE id = ?')
			.get(finalTieId) as { l: number; h: number };

		// One finalist drops: the other wins the competition on a walkover.
		const outcome = recordKnockoutDropout(
			db,
			{
				competitionId: started.competitionId,
				playerId: finalRow.l,
				actorPlayerId: people.adminId,
				reason: 'Illness before the final.'
			},
			{ now: new Date('2026-04-12T09:00:00Z') }
		);
		expect(outcome.competitionComplete).toBe(true);
		expect(outcome.competitionWinnerPlayerId).toBe(finalRow.h);
		expect(
			(db.prepare('SELECT completed_at FROM knockout_competitions WHERE id = ?').get(started.competitionId) as { completed_at: string }).completed_at
		).toBe('2026-04-12T09:00:00.000Z');
		expect(() =>
			drawKnockoutNextStage(
				db,
				{ competitionId: started.competitionId, actorPlayerId: people.adminId },
				{ now: new Date('2026-04-12T10:00:00Z'), randomInt: seededRandom(47) }
			)
		).toThrow(/already complete/);

		// A second competition where everyone but one drops out crowns the last
		// player standing — attrition never leaves the bracket hanging, and no
		// played result is ever invented along the way.
		const started2 = startCompetition(db, people, { entrants: 6, framesToWin: 2, seed: 48 });
		expect(count(db, 'knockout_tie_results')).toBe(6); // the first competition's played ties only
		const resultsBefore = count(db, 'knockout_tie_results');
		const live = () => livePlayerIds(db, started2.competitionId);
		expect(live()).toHaveLength(6);
		let guard = 0;
		while (live().length > 1 && guard++ < 12) {
			recordKnockoutDropout(
				db,
				{ competitionId: started2.competitionId, playerId: live()[0], actorPlayerId: people.adminId, reason: 'Gone' },
				{ now: new Date('2026-04-06T13:00:00Z') }
			);
		}
		const finalState = db
			.prepare('SELECT completed_at, winner_player_id AS w FROM knockout_competitions WHERE id = ?')
			.get(started2.competitionId) as { completed_at: string | null; w: number | null };
		expect(finalState.completed_at).not.toBeNull();
		expect(finalState.w).toBe(live()[0]);
		expect(count(db, 'knockout_tie_results')).toBe(resultsBefore);
	});

	it('lets participants correct, requires a reason for admin overrides, and freezes moved-on results', () => {
		const db = freshDb();
		const people = addPeople(db);
		const started = startCompetition(db, people, { entrants: 8, framesToWin: 3 });
		const tieId = started.tieIds[0];
		const row = db
			.prepare('SELECT player_low_id AS l, player_high_id AS h FROM knockout_ties WHERE id = ?')
			.get(tieId) as { l: number; h: number };
		recordKnockoutResult(
			db,
			{ tieId, actorPlayerId: row.l, frames: framesFor(row.l, row.h, 3, 0), actualPlayedDate: playDay },
			{ now: new Date('2026-04-08T10:00:00Z'), today: playDay }
		);

		// Participant correction: no reason needed, revision rises.
		const corrected = correctKnockoutResult(
			db,
			{
				tieId,
				actorPlayerId: row.l,
				frames: framesFor(row.l, row.h, 3, 2),
				actualPlayedDate: playDay
			},
			{ now: new Date('2026-04-08T12:00:00Z'), today: playDay }
		);
		expect(corrected.revision).toBe(2);
		expect(corrected.highFrames).toBe(2);

		// A non-participant player cannot correct.
		expect(() =>
			correctKnockoutResult(
				db,
				{
					tieId,
					actorPlayerId: people.playerIds[7],
					frames: framesFor(row.l, row.h, 3, 1),
					actualPlayedDate: playDay
				},
				{ now: new Date('2026-04-08T13:00:00Z'), today: playDay }
			)
		).toThrow(KnockoutPermissionError);

		// Admin override without a reason is refused; with one it lands.
		expect(() =>
			correctKnockoutResult(
				db,
				{
					tieId,
					actorPlayerId: people.adminId,
					frames: framesFor(row.h, row.l, 3, 1),
					actualPlayedDate: playDay
				},
				{ now: new Date('2026-04-08T14:00:00Z'), today: playDay }
			)
		).toThrow(/reason/);
		const override = correctKnockoutResult(
			db,
			{
				tieId,
				actorPlayerId: people.adminId,
				frames: framesFor(row.h, row.l, 3, 1),
				actualPlayedDate: playDay,
				reason: 'Frames were entered the wrong way round.'
			},
			{ now: new Date('2026-04-08T14:00:00Z'), today: playDay }
		);
		expect(override.winnerChanged).toBe(true);
		expect(tieWinner(db, tieId)).toBe(row.h);
		const correctedAudit = db
			.prepare("SELECT reason, detail FROM audit_log WHERE action = 'match_result_corrected' AND entity_id = ? ORDER BY id DESC LIMIT 1")
			.get(started.competitionId) as { reason: string; detail: string };
		expect(correctedAudit.reason).toBe('Frames were entered the wrong way round.');
		expect(correctedAudit.detail).toContain('"adminOverride":true');
		expect(correctedAudit.detail).toContain('"before"');

		// Once the winner is drawn onward, corrections stop.
		started.tieIds.slice(1).forEach((other) => {
			const otherRow = db
				.prepare('SELECT player_low_id AS l, player_high_id AS h FROM knockout_ties WHERE id = ?')
				.get(other) as { l: number; h: number };
			recordKnockoutResult(
				db,
				{ tieId: other, actorPlayerId: otherRow.l, frames: framesFor(otherRow.l, otherRow.h, 3, 0), actualPlayedDate: playDay },
				{ now: new Date('2026-04-08T15:00:00Z'), today: playDay }
			);
		});
		drawKnockoutNextStage(
			db,
			{ competitionId: started.competitionId, actorPlayerId: people.adminId },
			{ now: new Date('2026-04-09T12:00:00Z'), randomInt: seededRandom(51) }
		);
		expect(() =>
			correctKnockoutResult(
				db,
				{
					tieId,
					actorPlayerId: row.h,
					frames: framesFor(row.h, row.l, 3, 0),
					actualPlayedDate: playDay
				},
				{ now: new Date('2026-04-09T13:00:00Z'), today: playDay }
			)
		).toThrow(/carried into a later draw/);
	});

	it('arranges dates, supersedes plans, rate-limits nudges, and refuses both on resolved ties', () => {
		const db = freshDb();
		const people = addPeople(db);
		const started = startCompetition(db, people, { entrants: 8, framesToWin: 3 });
		const tieId = started.tieIds[0];
		const row = db
			.prepare('SELECT player_low_id AS l, player_high_id AS h FROM knockout_ties WHERE id = ?')
			.get(tieId) as { l: number; h: number };

		// Non-participants cannot arrange or nudge.
		expect(() =>
			proposeKnockoutArrangement(
				db,
				{ tieId, actorPlayerId: people.playerIds[7], date: '2026-04-10', time: '18:00' },
				{ now: new Date('2026-04-06T12:00:00Z'), today: '2026-04-06' }
			)
		).toThrow(KnockoutPermissionError);
		expect(() =>
			nudgeKnockoutOpponent(db, { tieId, actorPlayerId: people.playerIds[7] }, { now: new Date('2026-04-06T12:00:00Z') })
		).toThrow(KnockoutPermissionError);

		const first = proposeKnockoutArrangement(
			db,
			{ tieId, actorPlayerId: row.l, date: '2026-04-10', time: '18:00', note: 'At ours.' },
			{ now: new Date('2026-04-06T12:00:00Z'), today: '2026-04-06' }
		);
		expect(first.replaced).toBe(false);
		const second = proposeKnockoutArrangement(
			db,
			{ tieId, actorPlayerId: row.h, date: '2026-04-11' },
			{ now: new Date('2026-04-06T15:00:00Z'), today: '2026-04-06' }
		);
		expect(second.replaced).toBe(true);
		expect(
			(db.prepare('SELECT COUNT(*) AS n FROM knockout_arrangements WHERE tie_id = ? AND status = \'proposed\'').get(tieId) as { n: number }).n
		).toBe(1);
		expect(() =>
			proposeKnockoutArrangement(
				db,
				{ tieId, actorPlayerId: row.l, date: '2026-04-01' },
				{ now: new Date('2026-04-06T15:00:00Z'), today: '2026-04-06' }
			)
		).toThrow(/past/);

		// Nudge: first lands, an immediate second is cooled down, a day later is fine.
		nudgeKnockoutOpponent(db, { tieId, actorPlayerId: row.l }, { now: new Date('2026-04-06T16:00:00Z') });
		expect(() =>
			nudgeKnockoutOpponent(db, { tieId, actorPlayerId: row.l }, { now: new Date('2026-04-06T20:00:00Z') })
		).toThrow(/24 hours/);
		expect(() =>
			nudgeKnockoutOpponent(db, { tieId, actorPlayerId: row.h }, { now: new Date('2026-04-06T20:00:00Z') })
		).not.toThrow(); // per-sender cooldown
		expect(() =>
			nudgeKnockoutOpponent(db, { tieId, actorPlayerId: row.l }, { now: new Date('2026-04-07T16:01:00Z') })
		).not.toThrow();

		expect(cancelKnockoutArrangement(db, { tieId, actorPlayerId: row.h }, { now: new Date('2026-04-07T17:00:00Z') })).toEqual({
			cancelled: true
		});

		// Resolved ties take neither.
		recordKnockoutResult(
			db,
			{ tieId, actorPlayerId: row.l, frames: framesFor(row.l, row.h, 3, 0), actualPlayedDate: playDay },
			{ now: new Date('2026-04-08T10:00:00Z'), today: playDay }
		);
		expect(() =>
			proposeKnockoutArrangement(
				db,
				{ tieId, actorPlayerId: row.l, date: '2026-04-12' },
				{ now: new Date('2026-04-08T11:00:00Z'), today: '2026-04-08' }
			)
		).toThrow(/already has a saved outcome/);
		expect(() =>
			nudgeKnockoutOpponent(db, { tieId, actorPlayerId: row.l }, { now: new Date('2026-04-08T11:00:00Z') })
		).toThrow(/already has a saved outcome/);
	});

	it('exposes per-viewer permissions and honest state through the view model', () => {
		const db = freshDb();
		const people = addPeople(db);
		const started = startCompetition(db, people, { entrants: 8, framesToWin: 2 });
		const tieId = started.tieIds[0];
		const row = db
			.prepare('SELECT player_low_id AS l, player_high_id AS h FROM knockout_ties WHERE id = ?')
			.get(tieId) as { l: number; h: number };

		const asParticipant = loadKnockoutCompetitions(db, row.l).find(
			(item) => item.competitionId === started.competitionId
		)!;
		const participantTie = asParticipant.stages[0].ties.find((tie) => tie.tieId === tieId)!;
		expect(participantTie.viewer).toEqual({ canRecord: true, canCorrect: false, canArrange: true, canNudge: true });

		const asOutsider = loadKnockoutCompetitions(db, people.playerIds[9]).find(
			(item) => item.competitionId === started.competitionId
		)!;
		const outsiderTie = asOutsider.stages[0].ties.find((tie) => tie.tieId === tieId)!;
		expect(outsiderTie.viewer).toEqual({ canRecord: false, canCorrect: false, canArrange: false, canNudge: false });

		const asAdmin = loadKnockoutCompetitions(db, people.adminId).find(
			(item) => item.competitionId === started.competitionId
		)!;
		expect(asAdmin.nextStageReady).toBe(false);

		recordKnockoutResult(
			db,
			{ tieId, actorPlayerId: row.l, frames: framesFor(row.l, row.h, 2, 1), actualPlayedDate: playDay },
			{ now: new Date('2026-04-08T10:00:00Z'), today: playDay }
		);
		const afterResult = loadKnockoutCompetitions(db, row.h).find(
			(item) => item.competitionId === started.competitionId
		)!;
		const playedTie = afterResult.stages[0].ties.find((tie) => tie.tieId === tieId)!;
		expect(playedTie.resolvedType).toBe('played');
		expect(playedTie.lowFrames).toBe(2);
		expect(playedTie.frames).toHaveLength(3);
		expect(playedTie.viewer.canCorrect).toBe(true);
		expect(playedTie.viewer.canRecord).toBe(false);
	});
});
