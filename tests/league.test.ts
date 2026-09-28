import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { runMigrations } from '../src/lib/server/migrate';
import {
	closeFixtureNeutrally,
	confirmResult,
	createAward,
	createSeason,
	openRound,
	orderedPair,
	previousRoundPointsAgainst,
	saveLeagueResult,
	sendBackResult,
	validateLeagueResult
} from '../src/lib/server/league';
import { computeStandings, roundProgress } from '../src/lib/server/standings';
import { seedAll } from '../src/lib/server/seed';
import { buildLeagueSeedPlan, PLAYER_KEYS, SEED_PLAYERS } from '../src/lib/server/seed-data';

const migrations = path.resolve(process.cwd(), 'migrations');
const openDbs: Db[] = [];

function freshDb(): Db {
	const file = path.join(os.tmpdir(), `minsnooks-league-${Date.now()}-${Math.random()}.db`);
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

/** Minimal four-player league: A beats everyone 2–1 except a whitewash over D. */
function tinyLeague(db: Db): { seasonId: number; roundId: number; ids: Record<string, number> } {
	const ids: Record<string, number> = {};
	const insert = db.prepare(
		`INSERT INTO players (email, display_name, initials, avatar_tone) VALUES (?, ?, ?, ?)`
	);
	for (const [index, key] of ['alpha', 'bravo', 'charlie', 'delta'].entries()) {
		ids[key] = Number(
			insert.run(`${key}@example.test`, key.toUpperCase(), key.slice(0, 2).toUpperCase(), 'maya')
				.lastInsertRowid
		);
		void index;
	}
	const seasonId = createSeason(db, {
		label: 'test',
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

function finishRoundForTest(db: Db, roundId: number): void {
	db.prepare("UPDATE fixtures SET state = 'closed_unplayed' WHERE round_id = ? AND state = 'unplayed'").run(
		roundId
	);
	db.prepare("UPDATE rounds SET status = 'closed', closed_at = '2026-05-09T00:00:00.000Z' WHERE id = ?").run(
		roundId
	);
}

function fixtureBetween(db: Db, roundId: number, a: number, b: number): number {
	const [low, high] = orderedPair(a, b);
	const row = db
		.prepare(
			'SELECT id FROM fixtures WHERE round_id = ? AND player_low_id = ? AND player_high_id = ?'
		)
		.get(roundId, low, high) as { id: number };
	return row.id;
}

describe('canonical schema (0002_league)', () => {
	it('applies to a fresh database alongside 0001', () => {
		const db = freshDb();
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
			.all()
			.map((row) => (row as { name: string }).name);
		for (const table of [
			'seasons',
			'rounds',
			'round_players',
			'fixtures',
			'results',
			'result_frames',
			'result_breaks',
			'awards',
			'audit_log'
		]) {
			expect(tables).toContain(table);
		}
	});

	it('creates exactly one fixture per pair when a round opens', () => {
		const db = freshDb();
		const { roundId } = tinyLeague(db);
		const rows = db.prepare('SELECT COUNT(*) AS n FROM fixtures WHERE round_id = ?').get(roundId) as {
			n: number;
		};
		expect(rows.n).toBe(6); // C(4,2)
		expect(
			db.prepare('SELECT COUNT(*) AS n FROM round_players WHERE round_id = ?').get(roundId) as { n: number }
		).toEqual({ n: 4 });
	});

	it('makes duplicate pairings impossible, including mirrored ones', () => {
		const db = freshDb();
		const { roundId, ids } = tinyLeague(db);
		const [low, high] = orderedPair(ids.alpha, ids.bravo);
		expect(() =>
			db
				.prepare('INSERT INTO fixtures (round_id, player_low_id, player_high_id) VALUES (?, ?, ?)')
				.run(roundId, low, high)
		).toThrow(/UNIQUE/);
		// The CHECK (low < high) rejects the mirrored ordering outright.
		expect(() =>
			db
				.prepare('INSERT INTO fixtures (round_id, player_low_id, player_high_id) VALUES (?, ?, ?)')
				.run(roundId, high, low)
		).toThrow(/CHECK/);
	});

	it('snapshots the roster so later membership changes cannot alter an open round', () => {
		const db = freshDb();
		const { roundId } = tinyLeague(db);
		// A brand-new player joins the league after the round opened.
		const newcomer = Number(
			db
				.prepare(
					`INSERT INTO players (email, display_name, initials) VALUES ('echo@example.test', 'ECHO', 'EC')`
				)
				.run().lastInsertRowid
		);
		const count = db.prepare('SELECT COUNT(*) AS n FROM fixtures WHERE round_id = ?').get(roundId) as {
			n: number;
		};
		expect(count.n).toBe(6);
		expect(
			db
				.prepare('SELECT COUNT(*) AS n FROM round_players WHERE player_id = ?')
				.get(newcomer) as { n: number }
		).toEqual({ n: 0 });
	});
});

describe('league scoring', () => {
	it('awards one table point per frame and no match-win bonus', () => {
		const db = freshDb();
		const { seasonId, roundId, ids } = tinyLeague(db);
		for (const loser of ['bravo', 'charlie', 'delta']) {
			saveLeagueResult(db, {
				fixtureId: fixtureBetween(db, roundId, ids.alpha, ids[loser]),
				submittedByPlayerId: ids.alpha,
				lowFrames: 2,
				highFrames: 1,
				actualPlayedDate: '2026-04-20',
				entrySource: 'admin_direct'
			});
		}
		// alpha beats delta 3–0 as well
		saveLeagueResult(db, {
			fixtureId: fixtureBetween(db, roundId, ids.alpha, ids.delta),
			submittedByPlayerId: ids.alpha,
			lowFrames: 3,
			highFrames: 0,
			actualPlayedDate: '2026-04-21',
			entrySource: 'admin_direct',
			allowOverwrite: true
		});
		const rows = computeStandings(db, { seasonId, roundId });
		const alpha = rows.find((row) => row.name === 'ALPHA')!;
		// 2 + 2 + 3 frames = 7 points, no win bonus
		expect(alpha.points).toBe(7);
		expect(alpha.wins).toBe(3);
		expect(alpha.played).toBe(3);
		expect(alpha.frameDiff).toBe(2 + 2 + 3 - (1 + 1 + 0));
	});

	it('rejects frame counts that do not add up to the season format', () => {
		const result = validateLeagueResult({
			framesPerMatch: 3,
			lowFrames: 2,
			highFrames: 2,
			actualPlayedDate: '2026-04-20',
			lowPlayerId: 1,
			highPlayerId: 2
		});
		expect(result.ok).toBe(false);
		expect(result.errors.join(' ')).toMatch(/exactly 3 frames/);
	});

	it('rejects a drawn league match and a missing actual played date', () => {
		expect(
			validateLeagueResult({
				framesPerMatch: 4,
				lowFrames: 2,
				highFrames: 2,
				actualPlayedDate: '2026-04-20',
				lowPlayerId: 1,
				highPlayerId: 2
			}).errors.join(' ')
		).toMatch(/cannot be drawn/);
		expect(
			validateLeagueResult({
				framesPerMatch: 3,
				lowFrames: 2,
				highFrames: 1,
				actualPlayedDate: 'not-a-date',
				lowPlayerId: 1,
				highPlayerId: 2
			}).errors.join(' ')
		).toMatch(/actual date played/);
	});

	it('requires frame winners to agree with the match score', () => {
		const result = validateLeagueResult({
			framesPerMatch: 3,
			lowFrames: 2,
			highFrames: 1,
			actualPlayedDate: '2026-04-20',
			lowPlayerId: 1,
			highPlayerId: 2,
			frames: [
				{ frameNumber: 1, lowPoints: 60, highPoints: 40 },
				{ frameNumber: 2, lowPoints: 30, highPoints: 70 },
				{ frameNumber: 3, lowPoints: 20, highPoints: 80 }
			]
		});
		expect(result.ok).toBe(false);
		expect(result.errors.join(' ')).toMatch(/Frame winners/);
	});

	it('accepts frame winners that agree, and rejects a break above the best frame', () => {
		const frames = [
			{ frameNumber: 1, lowPoints: 62, highPoints: 40 },
			{ frameNumber: 2, lowPoints: 30, highPoints: 70 },
			{ frameNumber: 3, lowPoints: 80, highPoints: 20 }
		];
		expect(
			validateLeagueResult({
				framesPerMatch: 3,
				lowFrames: 2,
				highFrames: 1,
				actualPlayedDate: '2026-04-20',
				lowPlayerId: 1,
				highPlayerId: 2,
				frames
			}).ok
		).toBe(true);
		expect(
			validateLeagueResult({
				framesPerMatch: 3,
				lowFrames: 2,
				highFrames: 1,
				actualPlayedDate: '2026-04-20',
				lowPlayerId: 1,
				highPlayerId: 2,
				frames,
				breaks: [{ playerId: 1, breakPoints: 90 }]
			}).errors.join(' ')
		).toMatch(/higher than the best recorded frame score/);
	});

	it('warns instead of rejecting a plausible foul-inflated frame', () => {
		const result = validateLeagueResult({
			framesPerMatch: 3,
			lowFrames: 2,
			highFrames: 1,
			actualPlayedDate: '2026-04-20',
			lowPlayerId: 1,
			highPlayerId: 2,
			frames: [
				{ frameNumber: 1, lowPoints: 138, highPoints: 96 },
				{ frameNumber: 2, lowPoints: 30, highPoints: 70 },
				{ frameNumber: 3, lowPoints: 80, highPoints: 20 }
			]
		});
		expect(result.ok).toBe(true);
		expect(result.ok).toBe(true);
		expect(result.warnings.length).toBeGreaterThan(0);
	});
});

describe('standings engine is the single canonical path', () => {
	it('ignores submitted-but-unconfirmed results entirely', () => {
		const db = freshDb();
		const { seasonId, roundId, ids } = tinyLeague(db);
		saveLeagueResult(db, {
			fixtureId: fixtureBetween(db, roundId, ids.alpha, ids.bravo),
			submittedByPlayerId: ids.alpha,
			lowFrames: 3,
			highFrames: 0,
			actualPlayedDate: '2026-04-20'
			// no entrySource → 'player' → awaiting confirmation
		});
		const before = computeStandings(db, { seasonId, roundId });
		expect(before.every((row) => row.played === 0 && row.points === 0)).toBe(true);

		const resultId = (
			db.prepare('SELECT id FROM results WHERE fixture_id = ?').get(
				fixtureBetween(db, roundId, ids.alpha, ids.bravo)
			) as { id: number }
		).id;
		confirmResult(db, resultId, ids.bravo);
		const after = computeStandings(db, { seasonId, roundId });
		expect(after.find((row) => row.name === 'ALPHA')!.points).toBe(3);
		expect(after.find((row) => row.name === 'BRAVO')!.points).toBe(0);
	});

	it('a send-back removes the result from the table', () => {
		const db = freshDb();
		const { seasonId, roundId, ids } = tinyLeague(db);
		saveLeagueResult(db, {
			fixtureId: fixtureBetween(db, roundId, ids.alpha, ids.bravo),
			submittedByPlayerId: ids.alpha,
			lowFrames: 3,
			highFrames: 0,
			actualPlayedDate: '2026-04-20'
		});
		const resultId = (
			db.prepare('SELECT id FROM results WHERE fixture_id = ?').get(
				fixtureBetween(db, roundId, ids.alpha, ids.bravo)
			) as { id: number }
		).id;
		sendBackResult(db, resultId);
		const rows = computeStandings(db, { seasonId, roundId });
		expect(rows.every((row) => row.played === 0)).toBe(true);
		expect(roundProgress(db, roundId).awaitingConfirmation).toBe(0);
	});

	it('gives tied players a shared position, including joint first', () => {
		const db = freshDb();
		const { seasonId, roundId, ids } = tinyLeague(db);
		// alpha 2–1 bravo and charlie 2–1 delta leaves alpha and charlie level on
		// 2 points / +1 / 1 win, and bravo and delta level on 1 point / −1 / 0.
		const pairs: Array<[string, string]> = [
			['alpha', 'bravo'],
			['charlie', 'delta']
		];
		for (const [winner, loser] of pairs) {
			saveLeagueResult(db, {
				fixtureId: fixtureBetween(db, roundId, ids[winner], ids[loser]),
				submittedByPlayerId: ids[winner],
				lowFrames: 2,
				highFrames: 1,
				actualPlayedDate: '2026-04-20',
				entrySource: 'admin_direct'
			});
		}
		const rows = computeStandings(db, { seasonId, roundId });
		const alpha = rows.find((row) => row.name === 'ALPHA')!;
		const charlie = rows.find((row) => row.name === 'CHARLIE')!;
		expect(alpha.points).toBe(2);
		expect(charlie.points).toBe(2);
		// Joint first = joint champions, sharing the black ball.
		expect(alpha.position).toBe(1);
		expect(charlie.position).toBe(1);
		expect(alpha.ball).toBe('black');
		expect(charlie.ball).toBe('black');
		// Competition ranking: the next distinct row is 3rd, not 2nd.
		expect(rows.find((row) => row.name === 'BRAVO')!.position).toBe(3);
		expect(rows.find((row) => row.name === 'DELTA')!.position).toBe(3);
	});

	it('counts awards as table points only — never frames, difference or wins', () => {
		const db = freshDb();
		const { seasonId, roundId, ids } = tinyLeague(db);
		// A genuine played result in round 1 supplies the award value for round 2.
		saveLeagueResult(db, {
			fixtureId: fixtureBetween(db, roundId, ids.bravo, ids.delta),
			submittedByPlayerId: ids.bravo,
			lowFrames: 3,
			highFrames: 0,
			actualPlayedDate: '2026-04-20',
			entrySource: 'admin_direct'
		});
		finishRoundForTest(db, roundId);
		const round2 = openRound(db, { seasonId, number: 2, playerIds: Object.values(ids) });
		const source = previousRoundPointsAgainst(db, {
			seasonId,
			playerId: ids.bravo,
			opponentId: ids.delta,
			beforeRoundNumber: 2
		})!;
		expect(source.tablePoints).toBe(3);
		createAward(db, {
			fixtureId: fixtureBetween(db, round2, ids.bravo, ids.delta),
			playerId: ids.bravo,
			tablePoints: source.tablePoints,
			sourceType: 'previous_round_result',
			sourceResultId: source.resultId,
			createdByPlayerId: ids.alpha,
			reason: 'fictional award'
		});
		const bravo = computeStandings(db, { seasonId, roundId: round2 }).find(
			(row) => row.name === 'BRAVO'
		)!;
		expect(bravo.points).toBe(3);
		expect(bravo.played).toBe(0);
		expect(bravo.frameDiff).toBe(0);
		expect(bravo.wins).toBe(0);
		expect(bravo.award).toBe(true);
		// The recipient is the only one flagged.
		expect(
			computeStandings(db, { seasonId, roundId: round2 })
				.filter((row) => row.award)
				.map((row) => row.name)
		).toEqual(['BRAVO']);
	});

	it('treats a zero-point award as no points and no asterisk', () => {
		const db = freshDb();
		const { seasonId, roundId, ids } = tinyLeague(db);
		// Round 1: bravo lost 0–3 to delta, so the award value is zero points.
		saveLeagueResult(db, {
			fixtureId: fixtureBetween(db, roundId, ids.bravo, ids.delta),
			submittedByPlayerId: ids.delta,
			lowFrames: 0,
			highFrames: 3,
			actualPlayedDate: '2026-04-20',
			entrySource: 'admin_direct'
		});
		finishRoundForTest(db, roundId);
		const round2 = openRound(db, { seasonId, number: 2, playerIds: Object.values(ids) });
		const source = previousRoundPointsAgainst(db, {
			seasonId,
			playerId: ids.bravo,
			opponentId: ids.delta,
			beforeRoundNumber: 2
		})!;
		expect(source.tablePoints).toBe(0);
		createAward(db, {
			fixtureId: fixtureBetween(db, round2, ids.bravo, ids.delta),
			playerId: ids.bravo,
			tablePoints: 0,
			sourceType: 'previous_round_result',
			sourceResultId: source.resultId,
			createdByPlayerId: ids.alpha,
			reason: 'fictional zero-point award'
		});
		const bravo = computeStandings(db, { seasonId, roundId: round2 }).find(
			(row) => row.name === 'BRAVO'
		)!;
		expect(bravo.points).toBe(0);
		expect(bravo.award).toBe(false);
		expect(roundProgress(db, round2).awarded).toBe(1);
	});

	it('closes an unplayed fixture neutrally: no result, no points, not outstanding', () => {
		const db = freshDb();
		const { roundId, ids } = tinyLeague(db);
		const fixtureId = fixtureBetween(db, roundId, ids.bravo, ids.delta);
		closeFixtureNeutrally(db, fixtureId, new Date('2026-10-23T12:00:00.000Z'));
		expect(db.prepare('SELECT COUNT(*) AS n FROM results').get()).toEqual({ n: 0 });
		const progress = roundProgress(db, roundId);
		expect(progress.closedUnplayed).toBe(1);
		expect(progress.unplayed).toBe(5);
		expect(progress.total).toBe(6);
	});

	it('derives an automatic award only from a genuine previous-round result', () => {
		const db = freshDb();
		const { seasonId, roundId, ids } = tinyLeague(db);
		// Round 1: charlie beat delta 2–1 (2 table points for charlie).
		saveLeagueResult(db, {
			fixtureId: fixtureBetween(db, roundId, ids.charlie, ids.delta),
			submittedByPlayerId: ids.charlie,
			lowFrames: 2,
			highFrames: 1,
			actualPlayedDate: '2026-04-20',
			entrySource: 'admin_direct'
		});
		finishRoundForTest(db, roundId);
		const round2 = openRound(db, { seasonId, number: 2, playerIds: Object.values(ids) });
		const source = previousRoundPointsAgainst(db, {
			seasonId,
			playerId: ids.charlie,
			opponentId: ids.delta,
			beforeRoundNumber: 2
		});
		expect(source).not.toBeNull();
		expect(source!.tablePoints).toBe(2);
		expect(source!.roundNumber).toBe(1);

		// An unconfirmed submission in round 1 is not a valid source.
		saveLeagueResult(db, {
			fixtureId: fixtureBetween(db, round2, ids.charlie, ids.delta),
			submittedByPlayerId: ids.charlie,
			lowFrames: 3,
			highFrames: 0,
			actualPlayedDate: '2026-05-20'
		});
		expect(
			previousRoundPointsAgainst(db, {
				seasonId,
				playerId: ids.delta,
				opponentId: ids.charlie,
				beforeRoundNumber: 3
			})!.tablePoints
		).toBe(1); // still round 1's genuine result
	});
});

describe('fictional seed', () => {
	it('is deterministic: two independent builds produce identical plans', () => {
		expect(JSON.stringify(buildLeagueSeedPlan())).toBe(JSON.stringify(buildLeagueSeedPlan()));
	});

	it('seeds the eight prototype players and the 2026 league shape', () => {
		const db = freshDb();
		const { players, league } = seedAll(db);
		expect(players).toBe(8);
		expect(league.rounds).toBe(6);
		// 6 rounds × C(8,2) fixtures = 168; 138 of them are confirmed results,
		// exactly as the approved prototype's progress line states.
		expect(league.fixtures).toBe(168);
		expect(league.results).toBe(138);
		expect(league.awards).toBe(2);
	});

	it('is idempotent: re-seeding converges to the same standings', () => {
		const db = freshDb();
		seedAll(db);
		const first = JSON.stringify(computeStandings(db, { seasonId: 1 }));
		seedAll(db);
		const second = JSON.stringify(computeStandings(db, { seasonId: 1 }));
		expect(second).toBe(first);
	});

	it('reproduces the approved prototype round 6 table', () => {
		const db = freshDb();
		const { league } = seedAll(db);
		const rows = computeStandings(db, { seasonId: league.seasonId, roundId: 6 });
		expect(
			rows.map((row) => [row.position, row.name, row.played, row.points, row.frameDiff, row.wins])
		).toEqual([
			[1, 'Maya Chen', 6, 12, 6, 6],
			[2, 'Leon Park', 6, 11, 4, 5],
			[3, 'Jules Rivera', 6, 11, 0, 3],
			[4, 'Sam Wilson', 6, 10, 2, 4],
			[5, 'Priya Desai', 5, 8, 1, 2],
			[6, 'Owen Brooks', 5, 7, -1, 1],
			[7, 'Ella Thompson', 5, 5, -5, 1],
			[8, 'Noah Kim', 5, 4, -7, 0]
		]);
		expect(rows.find((row) => row.name === 'Jules Rivera')!.award).toBe(true);
	});

	it('reproduces the approved prototype season table', () => {
		const db = freshDb();
		const { league } = seedAll(db);
		const rows = computeStandings(db, { seasonId: league.seasonId });
		expect(
			rows.map((row) => [row.position, row.name, row.played, row.points, row.frameDiff, row.wins])
		).toEqual([
			[1, 'Maya Chen', 36, 67, 26, 28],
			[2, 'Leon Park', 36, 62, 16, 25],
			[3, 'Jules Rivera', 35, 60, 11, 22],
			[4, 'Sam Wilson', 35, 55, 5, 20],
			[5, 'Priya Desai', 34, 52, 2, 17],
			[6, 'Owen Brooks', 34, 47, -8, 12],
			[7, 'Ella Thompson', 33, 40, -19, 9],
			[8, 'Noah Kim', 33, 33, -33, 5]
		]);
	});

	it('keeps every seeded result internally consistent', () => {
		const db = freshDb();
		seedAll(db);
		const season = db.prepare('SELECT frames_per_match FROM seasons WHERE id = 1').get() as {
			frames_per_match: number;
		};
		const bad = db
			.prepare(
				`SELECT COUNT(*) AS n FROM results
				 WHERE player_low_frames + player_high_frames <> ?
				    OR player_low_frames = player_high_frames
				    OR actual_played_date IS NULL
				    OR actual_played_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`
			)
			.get(season.frames_per_match) as { n: number };
		expect(bad.n).toBe(0);

		// Frame winners agree with the match score wherever frame detail exists.
		const detailed = db
			.prepare(
				`SELECT r.id, r.player_low_frames, r.player_high_frames,
					(SELECT COUNT(*) FROM result_frames rf WHERE rf.result_id = r.id) AS frame_count
				 FROM results r`
			)
			.all() as Array<{
				id: number;
				player_low_frames: number;
				player_high_frames: number;
				frame_count: number;
			}>;
		for (const row of detailed) {
			if (row.frame_count === 0) continue;
			const frames = db
				.prepare(
					'SELECT player_low_points, player_high_points FROM result_frames WHERE result_id = ? ORDER BY frame_number'
				)
				.all(row.id) as Array<{ player_low_points: number; player_high_points: number }>;
			expect(frames).toHaveLength(season.frames_per_match);
			const lowWins = frames.filter(
				(frame) => frame.player_low_points > frame.player_high_points
			).length;
			expect(lowWins).toBe(row.player_low_frames);
		}

		// No break exceeds its player's best recorded frame score.
		const breaks = db
			.prepare(
				`SELECT rb.result_id, rb.player_id, rb.break_points,
					f.player_low_id, f.player_high_id
				 FROM result_breaks rb
				 JOIN results r ON r.id = rb.result_id
				 JOIN fixtures f ON f.id = r.fixture_id`
			)
			.all() as Array<{
				result_id: number;
				player_id: number;
				break_points: number;
				player_low_id: number;
				player_high_id: number;
			}>;
		for (const entry of breaks) {
			const frames = db
				.prepare(
					'SELECT player_low_points, player_high_points FROM result_frames WHERE result_id = ?'
				)
				.all(entry.result_id) as Array<{ player_low_points: number; player_high_points: number }>;
			const own = frames.map((frame) =>
				entry.player_id === entry.player_low_id ? frame.player_low_points : frame.player_high_points
			);
			expect(Math.max(0, ...own)).toBeGreaterThanOrEqual(entry.break_points);
		}
	});

	it('satisfies the identity frame difference = 2 × points − 3 × played', () => {
		const db = freshDb();
		seedAll(db);
		const rows = computeStandings(db, { seasonId: 1 });
		for (const row of rows) {
			// Awards add points without frames, so subtract them first.
			const awardPoints = (
				db
					.prepare(
						`SELECT COALESCE(SUM(a.table_points), 0) AS pts FROM awards a
						 JOIN fixtures f ON f.id = a.fixture_id
						 JOIN rounds ro ON ro.id = f.round_id
						 WHERE ro.season_id = 1 AND a.player_id = ?`
					)
					.get(row.playerId) as { pts: number }
			).pts;
			expect(row.frameDiff).toBe(2 * (row.points - awardPoints) - 3 * row.played);
		}
	});

	it('uses the eight prototype players and the agreed 2026 scoring', () => {
		const plan = buildLeagueSeedPlan();
		expect(plan.rounds.map((round) => round.number)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(plan.rounds.every((round) => round.players.length === 8)).toBe(true);
		expect(plan.season).toMatchObject({
			label: '2026',
			framesPerMatch: 3,
			pointsPerFrame: 1,
			matchWinBonus: 0,
			timezone: 'Europe/London'
		});
		expect(PLAYER_KEYS).toEqual([
			'maya',
			'leon',
			'jules',
			'sam',
			'priya',
			'owen',
			'ella',
			'noah'
		]);
		expect(SEED_PLAYERS).toHaveLength(8);
	});

	it('leaves the current round open and the earlier rounds closed', () => {
		const db = freshDb();
		seedAll(db);
		const states = db
			.prepare('SELECT number, status FROM rounds WHERE season_id = 1 ORDER BY number')
			.all() as Array<{ number: number; status: string }>;
		expect(states.map((row) => row.status)).toEqual([
			'closed',
			'closed',
			'closed',
			'closed',
			'closed',
			'open'
		]);
	});
});
