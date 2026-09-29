import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	compareLatestWindows,
	evaluateMostImproved,
	headToHead,
	recentForm,
	rollingFramesWonAverage,
	streakSummary,
	summarisePlayerMatches,
	type PlayerMatch,
	type StatsPlayer
} from '../src/lib/stats';
import { loadHomePageData } from '../src/lib/server/home-page';
import { openDb, type Db } from '../src/lib/server/db';
import { createSeason, openRound, orderedPair, saveLeagueResult } from '../src/lib/server/league';
import { computeStandings } from '../src/lib/server/standings';
import { runMigrations } from '../src/lib/server/migrate';
import { loadStatsPageData } from '../src/lib/server/stats-page';
import { seedAll } from '../src/lib/server/seed';
import { correctResult } from '../src/lib/server/results';

const migrations = path.resolve(process.cwd(), 'migrations');
const databases: Db[] = [];

function freshDb(): Db {
	const file = path.join(os.tmpdir(), `minsnooks-stats-${Date.now()}-${Math.random()}.db`);
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

const player: StatsPlayer = { playerId: 1, name: 'Avery', initials: 'AV', tone: 'maya' };
const opponent: StatsPlayer = { playerId: 2, name: 'Blake', initials: 'BL', tone: 'leon' };

function playerMatch(
	resultId: number,
	framesWon: number,
	framesLost: number,
	options: Partial<PlayerMatch> = {}
): PlayerMatch {
	return {
		resultId,
		roundId: 1,
		roundNumber: resultId,
		playedDate: `2026-01-${String(resultId).padStart(2, '0')}`,
		framesWon,
		framesLost,
		opponent,
		pointScores: [],
		highestBreak: null,
		...options
	};
}

function runWithFrames(framesWon: number[]): PlayerMatch[] {
	return framesWon.map((frames, index) => playerMatch(index + 1, frames, 3 - frames));
}

function addPlayer(db: Db, name: string, role: 'player' | 'admin' = 'player'): number {
	const initials = name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
	return Number(
		db.prepare(
			'INSERT INTO players (email, display_name, initials, avatar_tone, role) VALUES (?, ?, ?, ?, ?)'
		).run(`${name.toLowerCase().replaceAll(' ', '.')}@example.test`, name, initials, 'maya', role)
			.lastInsertRowid
	);
}

function fixtureBetween(db: Db, roundId: number, playerA: number, playerB: number): number {
	const [low, high] = orderedPair(playerA, playerB);
	const row = db
		.prepare('SELECT id FROM fixtures WHERE round_id = ? AND player_low_id = ? AND player_high_id = ?')
		.get(roundId, low, high) as { id: number } | undefined;
	if (!row) throw new Error(`Missing fixture in round ${roundId}.`);
	return row.id;
}

function saveScore(
	db: Db,
	input: {
		roundId: number;
		lowId: number;
		highId: number;
		winnerId: number;
		adminId: number;
		playedDate: string;
		now: string;
		frames?: Array<{ frameNumber: number; lowPoints: number; highPoints: number }>;
		breaks?: Array<{ playerId: number; breakPoints: number }>;
	}
): number {
	const [lowId, highId] = orderedPair(input.lowId, input.highId);
	const lowWon = input.winnerId === lowId;
	const result = saveLeagueResult(
		db,
		{
			fixtureId: fixtureBetween(db, input.roundId, lowId, highId),
			submittedByPlayerId: input.adminId,
			lowFrames: lowWon ? 2 : 1,
			highFrames: lowWon ? 1 : 2,
			actualPlayedDate: input.playedDate,
			entrySource: 'admin_direct',
			frames: input.frames,
			breaks: input.breaks
		},
		{ now: new Date(input.now) }
	);
	return result.resultId;
}

describe('pure personal-stat calculations', () => {
	it('counts played, wins, losses, win rate and frames from played results only', () => {
		const summary = summarisePlayerMatches([
			playerMatch(1, 2, 1),
			playerMatch(2, 1, 2),
			playerMatch(3, 2, 1)
		]);
		expect(summary).toEqual({
			played: 3,
			wins: 2,
			losses: 1,
			draws: 0,
			winRate: (2 / 3) * 100,
			framesWon: 5,
			framesLost: 4,
			averageFramesWon: 5 / 3
		});
		expect(summarisePlayerMatches([])).toMatchObject({ played: 0, wins: 0, losses: 0, winRate: null, averageFramesWon: null });
	});

	it('returns the latest five outcomes oldest-to-newest with explicit win/loss results', () => {
		const matches = [
			playerMatch(7, 2, 1),
			playerMatch(3, 1, 2),
			playerMatch(6, 2, 1),
			playerMatch(1, 2, 1),
			playerMatch(5, 1, 2),
			playerMatch(4, 2, 1),
			playerMatch(2, 1, 2)
		];
		expect(recentForm(matches).map(({ resultId, outcome }) => [resultId, outcome])).toEqual([
			[3, 'loss'],
			[4, 'win'],
			[5, 'loss'],
			[6, 'win'],
			[7, 'win']
		]);
		expect(recentForm([])).toEqual([]);
	});

	it('uses a rolling eight-match average and the available early sample', () => {
		const matches = runWithFrames([2, 3, 0, 1, 2, 1, 3, 0, 2]);
		const rolling = rollingFramesWonAverage(matches, 8);
		expect(rolling[0]).toMatchObject({ average: 2, matchesInWindow: 1 });
		expect(rolling[1]).toMatchObject({ average: 2.5, matchesInWindow: 2 });
		expect(rolling[2].average).toBeCloseTo(5 / 3);
		expect(rolling[7].matchesInWindow).toBe(8);
		expect(rolling[8].average).toBeCloseTo(12 / 8);
	});

	it('calculates head-to-head records and current/best winning streaks', () => {
		const rival = { ...opponent, playerId: 3, name: 'Casey' };
		const matches = [
			playerMatch(1, 2, 1, { opponent }),
			playerMatch(2, 2, 1, { opponent: rival }),
			playerMatch(3, 3, 0, { opponent }),
			playerMatch(4, 1, 2, { opponent }),
			playerMatch(5, 2, 1, { opponent: rival })
		];
		expect(headToHead(matches)).toMatchObject([
			{ opponent: { name: 'Blake' }, played: 3, wins: 2, losses: 1, framesWon: 6, framesLost: 3 },
			{ opponent: { name: 'Casey' }, played: 2, wins: 2, losses: 0, framesWon: 4, framesLost: 2 }
		]);
		expect(streakSummary(matches)).toEqual({ currentOutcome: 'win', currentLength: 1, bestWinLength: 3 });
	});

	it('compares adjacent eight-match windows and gates later joiners independently', () => {
		const improved = runWithFrames([...Array(8).fill(1), ...Array(8).fill(2)]);
		const steady = runWithFrames(Array(16).fill(1));
		const laterJoiner = runWithFrames([...Array(8).fill(0), ...Array(8).fill(3)]);
		const first = { player, matches: improved };
		const secondPlayer = { ...opponent, playerId: 4, name: 'Charlie' };
		const second = { player: secondPlayer, matches: steady };
		const joinerPlayer = { ...opponent, playerId: 5, name: 'Drew' };
		const joiner = { player: joinerPlayer, matches: laterJoiner.slice(0, 15) };

		expect(compareLatestWindows(player, improved)).toMatchObject({ previousAverage: 1, recentAverage: 2, change: 1 });
		expect(evaluateMostImproved([1, 4], [first, second, joiner])).toMatchObject({
			ready: true,
			winners: [{ player: { playerId: 1 }, change: 1 }]
		});
		const joinerReady = evaluateMostImproved([1, 4], [first, second, { ...joiner, matches: laterJoiner }]);
		expect(joinerReady.winners.map((winner) => winner.player.playerId)).toEqual([5]);
		expect(evaluateMostImproved([1, 4], [first, { ...second, matches: steady.slice(0, 15) }]).ready).toBe(false);
	});
});

describe('database-backed stats and highlights', () => {
	it('loads seeded fictional personal and league stats from confirmed results only', () => {
		const db = freshDb();
		seedAll(db);
		const mayaId = (db.prepare("SELECT id FROM players WHERE display_name = 'Maya Chen'").get() as { id: number }).id;
		const data = loadStatsPageData(db, mayaId);
		const resultCount = (db.prepare("SELECT COUNT(*) AS n FROM results r JOIN fixtures f ON f.id = r.fixture_id JOIN rounds ro ON ro.id = f.round_id WHERE ro.season_id = ? AND r.status = 'confirmed'").get(data.season!.seasonId) as { n: number }).n;
		const mayaPlayed = (db.prepare("SELECT COUNT(*) AS n FROM results r JOIN fixtures f ON f.id = r.fixture_id JOIN rounds ro ON ro.id = f.round_id WHERE ro.season_id = ? AND r.status = 'confirmed' AND (f.player_low_id = ? OR f.player_high_id = ?)").get(data.season!.seasonId, mayaId, mayaId) as { n: number }).n;
		const eventCount = (db.prepare("SELECT (SELECT COUNT(*) FROM results r JOIN fixtures f ON f.id = r.fixture_id JOIN rounds ro ON ro.id = f.round_id WHERE ro.season_id = ? AND r.status = 'confirmed') + (SELECT COUNT(*) FROM awards a JOIN fixtures f ON f.id = a.fixture_id JOIN rounds ro ON ro.id = f.round_id WHERE ro.season_id = ?) AS n").get(data.season!.seasonId, data.season!.seasonId) as { n: number }).n;

		expect(data.season?.label).toBe('2026');
		expect(data.league.confirmedMatches).toBe(138);
		expect(data.league.confirmedMatches).toBe(resultCount);
		expect(data.league.players).toHaveLength(8);
		expect(data.personal?.player).toMatchObject({ playerId: mayaId, name: 'Maya Chen' });
		expect(data.personal?.seasonSummary.played).toBe(mayaPlayed);
		expect(data.personal?.seasonSummary.wins! + data.personal?.seasonSummary.losses!).toBe(mayaPlayed);
		expect(data.personal?.seasonSummary.winRate).toBeCloseTo(
			(data.personal!.seasonSummary.wins / mayaPlayed) * 100
		);
		expect(data.personal?.recentForm).toHaveLength(5);
		expect(data.personal?.rollingFramesAverage).toHaveLength(mayaPlayed);
		expect(data.personal?.rollingFramesAverage.at(-1)?.matchesInWindow).toBe(8);
		expect(data.personal?.leaguePositionHistory).toHaveLength(eventCount);
		expect(new Set(data.personal?.leaguePositionHistory.map((point) => point.id)).size).toBe(eventCount);
		expect(data.personal?.leaguePositionHistory.at(-1)?.value).toBe(data.personal?.seasonSummary.position);
		expect(data.personal?.pointsCoverage.eligible).toBe(mayaPlayed);
		expect(data.league.frameCoverage.eligible).toBe(resultCount);
		expect(data.league.breakCoverage.eligible).toBe(resultCount * 2);
	});

	it('keeps confirmed table-update points distinct when results share an exact timestamp', () => {
		const db = freshDb();
		const a = addPlayer(db, 'Avery One');
		const b = addPlayer(db, 'Blake Two');
		const c = addPlayer(db, 'Casey Three');
		const seasonId = createSeason(db, { label: 'same-time events', framesPerMatch: 3, pointsPerFrame: 1, matchWinBonus: 0, timezone: 'UTC' });
		const roundId = openRound(db, {
			seasonId,
			number: 1,
			playerIds: [a, b, c],
			deadlineAt: '2026-12-31T23:59:59.000Z',
			openedAt: '2026-01-01T00:00:00.000Z'
		});
		const time = '2026-02-01T12:00:00.000Z';
		const firstResultId = saveScore(db, { roundId, lowId: a, highId: b, winnerId: b, adminId: a, playedDate: '2026-02-01', now: time });
		saveScore(db, { roundId, lowId: a, highId: c, winnerId: c, adminId: a, playedDate: '2026-02-01', now: time });

		const afterFirst = loadStatsPageData(db, a).personal!.leaguePositionHistory;
		const firstPoint = afterFirst.find((point) => point.id === `result-${firstResultId}`);
		const atSecondPoint = loadStatsPageData(db, a).personal!.leaguePositionHistory.at(-1);
		const firstTable = computeStandings(db, {
			seasonId,
			asOfAt: time,
			asOfEvent: { type: 'result', id: firstResultId }
		});
		const fullTable = computeStandings(db, { seasonId, asOfAt: time });

		expect(afterFirst).toHaveLength(2);
		expect(firstPoint?.value).toBe(firstTable.find((row) => row.playerId === a)?.position);
		expect(atSecondPoint?.value).toBe(fullTable.find((row) => row.playerId === a)?.position);
		expect(firstPoint?.value).not.toBe(atSecondPoint?.value);
	});

	it('gates round records until every active roster member has played, then counts optional details separately', () => {
		const db = freshDb();
		const p1 = addPlayer(db, 'Maya First');
		const p2 = addPlayer(db, 'Leon Second');
		const p3 = addPlayer(db, 'Jules Third');
		const seasonId = createSeason(db, { label: 'record gate', framesPerMatch: 3, pointsPerFrame: 1, matchWinBonus: 0, timezone: 'UTC' });
		const roundId = openRound(db, {
			seasonId,
			number: 1,
			playerIds: [p1, p2, p3],
			deadlineAt: '2026-12-31T23:59:59.000Z',
			openedAt: '2026-10-01T00:00:00.000Z'
		});
		const firstFrames = [
			{ frameNumber: 1, lowPoints: 47, highPoints: 40 },
			{ frameNumber: 2, lowPoints: 62, highPoints: 88 },
			{ frameNumber: 3, lowPoints: 75, highPoints: 71 }
		];
		saveScore(db, {
			roundId, lowId: p1, highId: p2, winnerId: p1, adminId: p1,
			playedDate: '2026-10-02', now: '2026-10-03T12:00:00.000Z', frames: firstFrames,
			breaks: [{ playerId: p1, breakPoints: 47 }, { playerId: p2, breakPoints: 71 }]
		});

		const beforeAllHavePlayed = loadHomePageData(db).statsHighlights;
		expect(beforeAllHavePlayed.currentRoundRecordsReady).toBe(false);
		expect(beforeAllHavePlayed.currentRoundPlayedBy).toBe(2);
		expect(beforeAllHavePlayed.currentRoundHighestBreak.value).toBeNull();

		saveScore(db, {
			roundId, lowId: p1, highId: p3, winnerId: p3, adminId: p1,
			playedDate: '2026-10-04', now: '2026-10-05T12:00:00.000Z',
			breaks: [{ playerId: p3, breakPoints: 75 }]
		});
		const afterAllHavePlayed = loadHomePageData(db).statsHighlights;
		const stats = loadStatsPageData(db, p1);

		expect(afterAllHavePlayed).toMatchObject({
			currentRoundRecordsReady: true,
			currentRoundPlayedBy: 3,
			currentRoundHighestBreak: { value: 75 },
			currentRoundBestFrame: { value: 88 }
		});
		expect(stats.league.breakCoverage).toMatchObject({ recorded: 3, eligible: 4, percent: 75 });
		expect(stats.league.frameCoverage).toMatchObject({ recorded: 1, eligible: 2, percent: 50 });
		expect(stats.personal?.pointsCoverage).toMatchObject({ recorded: 1, eligible: 2, percent: 50 });
		expect(stats.personal?.pointsPerRound[0]).toMatchObject({ framesWithDetail: 3, recordedMatches: 1, eligibleMatches: 2 });
	});

	it('freezes Most Improved at round open, includes later joiners only when eligible and recalculates corrections', () => {
		const db = freshDb();
		const a = addPlayer(db, 'Avery Opening');
		const b = addPlayer(db, 'Blake Opening');
		const c = addPlayer(db, 'Casey Opening');
		const admin = addPlayer(db, 'Drew Later', 'admin');
		const seasonId = createSeason(db, { label: 'improvement freeze', framesPerMatch: 3, pointsPerFrame: 1, matchWinBonus: 0, timezone: 'UTC' });
		let lateFixtureId = 0;
		let correctionFixtureId = 0;

		for (let roundNumber = 1; roundNumber <= 8; roundNumber++) {
			const month = String(roundNumber).padStart(2, '0');
			const openedAt = `2026-${month}-01T00:00:00.000Z`;
			const playedDate = `2026-${month}-05`;
			const now = `2026-${month}-07T12:00:00.000Z`;
			const roster = roundNumber === 8 ? [a, b, c, admin] : [a, b, c];
			const roundId = openRound(db, {
				seasonId,
				number: roundNumber,
				playerIds: roster,
				deadlineAt: '2026-12-31T23:59:59.000Z',
				openedAt
			});
			const winners = roundNumber <= 4
				? [[a, b, a], [a, c, c], [b, c, b]] as const
				: [[a, b, a], [a, c, a], [b, c, b]] as const;
			for (const [left, right, winner] of winners) {
				const resultId = saveScore(db, { roundId, lowId: left, highId: right, winnerId: winner, adminId: admin, playedDate, now });
				if (roundNumber === 5 && left === a && right === b) correctionFixtureId = fixtureBetween(db, roundId, left, right);
				if (roundNumber === 8 && left === a && right === b) {
					const row = db.prepare('SELECT fixture_id FROM results WHERE id = ?').get(resultId) as { fixture_id: number };
					correctionFixtureId = correctionFixtureId || row.fixture_id;
				}
			}
			if (roundNumber === 8) {
				lateFixtureId = fixtureBetween(db, roundId, b, admin);
				db.prepare("UPDATE fixtures SET state = 'closed_unplayed' WHERE round_id = ? AND state = 'unplayed'").run(roundId);
			}
			db.prepare("UPDATE rounds SET status = 'closed', closed_at = ? WHERE id = ?").run(`${now}`, roundId);
		}

		const round9 = openRound(db, {
			seasonId,
			number: 9,
			playerIds: [a, b, c, admin],
			deadlineAt: '2026-12-31T23:59:59.000Z',
			openedAt: '2026-09-01T00:00:00.000Z'
		});
		const beforeLateResult = loadStatsPageData(db, a);
		expect(beforeLateResult.currentRound?.roundId).toBe(round9);
		expect(beforeLateResult.league.mostImprovedReady).toBe(true);
		expect(beforeLateResult.league.mostImproved.map((winner) => winner.player.playerId)).toContain(a);
		const improvementAtOpen = beforeLateResult.personal?.mostImproved;
		expect(improvementAtOpen?.change).toBeCloseTo(0.5);

		const [lateLow, lateHigh] = orderedPair(b, admin);
		const lateLowWins = lateLow === b;
		saveLeagueResult(db, {
			fixtureId: lateFixtureId,
			submittedByPlayerId: admin,
			lowFrames: lateLowWins ? 2 : 1,
			highFrames: lateLowWins ? 1 : 2,
			actualPlayedDate: '2026-08-15',
			entrySource: 'admin_retrospective'
		}, { now: new Date('2026-09-05T12:00:00.000Z') });
		const afterLateResult = loadStatsPageData(db, a);
		expect(afterLateResult.personal?.mostImproved).toMatchObject({
			previousAverage: improvementAtOpen?.previousAverage,
			recentAverage: improvementAtOpen?.recentAverage,
			change: improvementAtOpen?.change
		});

		const wrongedLowIsA = orderedPair(a, b)[0] === a;
		const corrected = correctResult(
			db,
			{
				fixtureId: correctionFixtureId,
				actorPlayerId: admin,
				reason: 'The frame winner was entered incorrectly',
				values: {
					actualPlayedDate: '2026-05-05',
					frameWinners: wrongedLowIsA ? ['low', 'high', 'high'] : ['low', 'low', 'high'],
					framePoints: [{ low: '', high: '' }, { low: '', high: '' }, { low: '', high: '' }],
					breaks: { low: '', high: '' }
				}
			},
			{ now: new Date('2026-09-10T12:00:00.000Z') }
		);
		const afterCorrection = loadStatsPageData(db, a);
		expect(corrected.mode).toBe('corrected');
		expect(afterCorrection.personal?.mostImproved?.change).toBeCloseTo(0.375);
		expect(afterCorrection.personal?.mostImproved?.change).not.toBe(improvementAtOpen?.change);
		expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'result' AND action = 'corrected'").get()).toEqual({ n: 1 });
	});

	it('has explicit empty states before any season is seeded', () => {
		const data = loadStatsPageData(freshDb(), null);
		expect(data.season).toBeNull();
		expect(data.personal).toBeNull();
		expect(data.league).toMatchObject({ confirmedMatches: 0, players: [], mostImprovedReady: false });
	});
});
