import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { runMigrations } from '../src/lib/server/migrate';
import { createSeason, openRound, orderedPair, saveLeagueResult, createAward, recordAudit } from '../src/lib/server/league';
import { computeStandings } from '../src/lib/server/standings';
import {
	loadAwardReviewQueue,
	loadWithdrawalAwardPreview,
	reviewCorrectedAward,
	withdrawPlayerAndResolveFixtures
} from '../src/lib/server/withdrawals-awards';

const openDbs: Db[] = [];
function freshDb(): Db {
	const file = path.join(os.tmpdir(), `minsnooks-phase7-${Date.now()}-${Math.random()}.db`);
	const db = openDb(file);
	openDbs.push(db);
	runMigrations(db, path.resolve(process.cwd(), 'migrations'));
	return db;
}
afterEach(() => {
	while (openDbs.length) {
		const db = openDbs.pop()!;
		const file = db.name;
		db.close();
		for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true });
	}
});

function fixture(db: Db, roundId: number, first: number, second: number): number {
	const [low, high] = orderedPair(first, second);
	return (db.prepare('SELECT id FROM fixtures WHERE round_id = ? AND player_low_id = ? AND player_high_id = ?').get(roundId, low, high) as { id: number }).id;
}

function demo(db: Db) {
	const add = db.prepare('INSERT INTO players (email, display_name, initials, avatar_tone, role) VALUES (?, ?, ?, ?, ?)');
	const ids = {
		withdrawn: Number(add.run('withdrawn@test', 'Alex Withdrawn', 'AW', 'maya', 'player').lastInsertRowid),
		opponent: Number(add.run('opponent@test', 'Blair Opponent', 'BO', 'maya', 'player').lastInsertRowid),
		fallback: Number(add.run('fallback@test', 'Casey Fallback', 'CF', 'maya', 'player').lastInsertRowid),
		admin: Number(add.run('admin@test', 'Drew Admin', 'DA', 'maya', 'admin').lastInsertRowid),
		player: Number(add.run('player@test', 'Evan Player', 'EP', 'maya', 'player').lastInsertRowid)
	};
	const seasonId = createSeason(db, { label: 'Phase 7', framesPerMatch: 3, pointsPerFrame: 1, matchWinBonus: 0, timezone: 'UTC' });
	const firstRound = openRound(db, { seasonId, number: 1, playerIds: [ids.withdrawn, ids.opponent, ids.fallback], deadlineAt: '2026-12-01T23:59:59.000Z', openedAt: '2026-01-01T00:00:00.000Z' });
	const sourceFixtureId = fixture(db, firstRound, ids.withdrawn, ids.opponent);
	const [low, high] = orderedPair(ids.withdrawn, ids.opponent);
	const source = saveLeagueResult(db, {
		fixtureId: sourceFixtureId,
		submittedByPlayerId: ids.admin,
		lowFrames: 2,
		highFrames: 1,
		actualPlayedDate: '2026-02-02',
		entrySource: 'admin_direct'
	}, { now: new Date('2026-02-05T00:00:00Z') });
	// Source result and pair sides are returned for tests which vary insertion order.
	const sourceResultId = source.resultId;
	db.prepare("UPDATE rounds SET status = 'closed', closed_at = '2026-03-01T00:00:00.000Z' WHERE id = ?").run(firstRound);
	const secondRound = openRound(db, { seasonId, number: 2, playerIds: [ids.withdrawn, ids.opponent, ids.fallback], deadlineAt: '2026-12-01T23:59:59.000Z', openedAt: '2026-03-02T00:00:00.000Z' });
	return {
		ids, seasonId, firstRound, secondRound, sourceFixtureId, sourceResultId, low, high,
		withOpponent: fixture(db, secondRound, ids.withdrawn, ids.opponent),
		withFallback: fixture(db, secondRound, ids.withdrawn, ids.fallback),
		other: fixture(db, secondRound, ids.opponent, ids.fallback)
	};
}

describe('Phase 7 withdrawals and administrative awards', () => {
	it('uses a genuine same-opponent result first, otherwise draws once server-side, and leaves match metrics untouched', () => {
		const db = freshDb();
		const league = demo(db);
		const preview = loadWithdrawalAwardPreview(db, { seasonId: league.seasonId, playerId: league.ids.withdrawn });
		expect(preview).toHaveLength(2);
		expect(preview.find((item) => item.opponentId === league.ids.opponent)).toMatchObject({ tablePoints: 1, sourceResultId: league.sourceResultId, sourceRound: 1 });
		expect(preview.find((item) => item.opponentId === league.ids.fallback)).toMatchObject({ tablePoints: null, sourceResultId: null });

		let randomCalls = 0;
		const result = withdrawPlayerAndResolveFixtures(db, {
			seasonId: league.seasonId,
			playerId: league.ids.withdrawn,
			actorPlayerId: league.ids.admin,
			reason: 'Player has left the league'
		}, (max) => { randomCalls++; expect(max).toBe(4); return 3; });
		expect(randomCalls).toBe(1);
		expect(result.effectiveFromRound).toBe(3);
		expect(result.awards).toHaveLength(2);
		expect(result.awards.find((award) => award.opponentId === league.ids.opponent)).toMatchObject({ tablePoints: 1, sourceType: 'previous_round_result', sourceResultId: league.sourceResultId });
		const randomAward = result.awards.find((award) => award.opponentId === league.ids.fallback)!;
		expect(randomAward).toMatchObject({ tablePoints: 3, sourceType: 'random_draw', drawValue: 3, sourceResultId: null });
		const drawAudit = JSON.parse((db.prepare("SELECT detail FROM audit_log WHERE entity_type = 'award' AND entity_id = ? AND action = 'created'").get(randomAward.awardId) as { detail: string }).detail) as { drawValue: number; tablePoints: number };
		expect(drawAudit).toMatchObject({ drawValue: 3, tablePoints: 3 });
		expect((db.prepare('SELECT state FROM fixtures WHERE id = ?').get(league.withOpponent) as { state: string }).state).toBe('awarded');
		expect((db.prepare('SELECT state FROM fixtures WHERE id = ?').get(league.other) as { state: string }).state).toBe('unplayed');
		expect((db.prepare('SELECT COUNT(*) AS n FROM results WHERE fixture_id IN (?, ?)').get(league.withOpponent, league.withFallback) as { n: number }).n).toBe(0);

		const roundTable = computeStandings(db, { seasonId: league.seasonId, roundId: league.secondRound });
		const opponent = roundTable.find((row) => row.playerId === league.ids.opponent)!;
		const fallback = roundTable.find((row) => row.playerId === league.ids.fallback)!;
		const withdrawn = roundTable.find((row) => row.playerId === league.ids.withdrawn)!;
		expect(opponent).toMatchObject({ points: 1, played: 0, frameDiff: 0, wins: 0 });
		expect(fallback).toMatchObject({ points: 3, played: 0, frameDiff: 0, wins: 0 });
		expect(withdrawn).toMatchObject({ points: 0, played: 0, frameDiff: 0, wins: 0 });
		const seasonTable = computeStandings(db, { seasonId: league.seasonId });
		expect(seasonTable.find((row) => row.playerId === league.ids.withdrawn)!.points).toBe(2);

		const again = withdrawPlayerAndResolveFixtures(db, {
			seasonId: league.seasonId,
			playerId: league.ids.withdrawn,
			actorPlayerId: league.ids.admin,
			reason: 'Repeat request'
		}, () => { throw new Error('A repeated withdrawal must not draw again.'); });
		expect(again).toMatchObject({ alreadyWithdrawn: true, effectiveFromRound: 3, awards: [] });
		expect((db.prepare('SELECT COUNT(*) AS n FROM awards').get() as { n: number }).n).toBe(2);
		expect((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'created' AND entity_type = 'award'").get() as { n: number }).n).toBe(2);
	});

	it('rejects non-admin writes and rolls back if the server draw is invalid', () => {
		const db = freshDb();
		const league = demo(db);
		expect(() => withdrawPlayerAndResolveFixtures(db, {
			seasonId: league.seasonId, playerId: league.ids.withdrawn, actorPlayerId: league.ids.player, reason: 'Not allowed'
		})).toThrow(/admin/i);
		expect(() => withdrawPlayerAndResolveFixtures(db, {
			seasonId: league.seasonId, playerId: league.ids.withdrawn, actorPlayerId: league.ids.admin, reason: 'Invalid draw'
		}, () => 4)).toThrow(/whole number from 0 to 3/i);
		expect((db.prepare('SELECT COUNT(*) AS n FROM player_withdrawals').get() as { n: number }).n).toBe(0);
		expect((db.prepare('SELECT COUNT(*) AS n FROM awards').get() as { n: number }).n).toBe(0);
	});

	it('queues a corrected source award until an admin applies or retains it with a reason', () => {
		const db = freshDb();
		const league = demo(db);
		const [low, high] = orderedPair(league.ids.withdrawn, league.ids.opponent);
		const awardId = createAward(db, {
			fixtureId: league.withOpponent,
			playerId: league.ids.opponent,
			tablePoints: 1,
			sourceType: 'previous_round_result',
			sourceResultId: league.sourceResultId,
			createdByPlayerId: league.ids.admin,
			reason: 'Copied from Round 1'
		});
		// Simulate the server's corrected source values: the opponent's count is
		// now two instead of one. Phase 6 appends the same source flag on correction.
		db.prepare('UPDATE results SET player_low_frames = ?, player_high_frames = ?, revision = 2 WHERE id = ?').run(
			league.ids.opponent === low ? 1 : 2,
			league.ids.opponent === high ? 2 : 1,
			league.sourceResultId
		);
		recordAudit(db, {
			entityType: 'result', entityId: league.sourceResultId, action: 'award_review_needed',
			actorPlayerId: league.ids.admin,
			reason: 'A source result was corrected; dependent awards need review.',
			detail: { awards: [{ id: awardId, player_id: league.ids.opponent, table_points: 1 }] }
		});
		const queue = loadAwardReviewQueue(db);
		expect(queue).toHaveLength(1);
		expect(queue[0]).toMatchObject({ awardId, currentAwardPoints: 1, updatedSourcePoints: 2, sourceRevision: 2 });

		const outcome = reviewCorrectedAward(db, {
			awardId, actorPlayerId: league.ids.admin, decision: 'apply_source', reason: 'Corrected result confirmed the opponent won two frames'
		});
		expect(outcome).toEqual({ before: 1, after: 2 });
		expect((db.prepare('SELECT table_points FROM awards WHERE id = ?').get(awardId) as { table_points: number }).table_points).toBe(2);
		expect(loadAwardReviewQueue(db)).toHaveLength(0);
		expect((db.prepare("SELECT detail FROM audit_log WHERE entity_type = 'award' AND entity_id = ? AND action = 'award_reviewed'").get(awardId) as { detail: string }).detail).toContain('apply_source');
		expect(computeStandings(db, { seasonId: league.seasonId, roundId: league.secondRound }).find((row) => row.playerId === league.ids.opponent)!.points).toBe(2);
	});

	it('requires an admin and a reason to close an award-review flag', () => {
		const db = freshDb();
		const league = demo(db);
		const awardId = createAward(db, {
			fixtureId: league.withOpponent, playerId: league.ids.opponent, tablePoints: 1,
			sourceType: 'previous_round_result', sourceResultId: league.sourceResultId,
			createdByPlayerId: league.ids.admin
		});
		recordAudit(db, { entityType: 'result', entityId: league.sourceResultId, action: 'award_review_needed', detail: { awards: [{ id: awardId }] } });
		expect(() => reviewCorrectedAward(db, { awardId, actorPlayerId: league.ids.player, decision: 'keep', reason: 'No' })).toThrow(/admin/i);
		expect(() => reviewCorrectedAward(db, { awardId, actorPlayerId: league.ids.admin, decision: 'keep', reason: '  ' })).toThrow(/reason/i);
		expect(loadAwardReviewQueue(db)).toHaveLength(1);
		reviewCorrectedAward(db, { awardId, actorPlayerId: league.ids.admin, decision: 'keep', reason: 'Source correction reviewed; prior value retained' });
		expect(loadAwardReviewQueue(db)).toHaveLength(0);
		expect((db.prepare('SELECT table_points FROM awards WHERE id = ?').get(awardId) as { table_points: number }).table_points).toBe(1);
	});
});
