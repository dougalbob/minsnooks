import type { Db } from './db';
import { computeStandings, loadSeason, type RoundSummary, type SeasonSummary } from './standings';
import {
	compareLatestWindows,
	evaluateMostImproved,
	headToHead,
	recentForm,
	rollingFramesWonAverage,
	sortPlayerMatches,
	streakSummary,
	summarisePlayerMatches,
	type HeadToHeadRow,
	type ImprovedPlayer,
	type ImprovementComparison,
	type PlayerMatch,
	type PlayerRecordSummary,
	type StatsPlayer,
	type StreakSummary
} from '../stats';

const MOST_IMPROVED_WINDOW = 8;
const RECENT_FORM_LIMIT = 5;

interface RawPlayerRow {
	player_id: number;
	name: string;
	initials: string;
	tone: string;
}

interface RawResultRow {
	result_id: number;
	round_id: number;
	round_number: number;
	played_date: string;
	confirmed_at: string;
	player_low_id: number;
	low_name: string;
	low_initials: string;
	low_tone: string;
	player_high_id: number;
	high_name: string;
	high_initials: string;
	high_tone: string;
	low_frames: number;
	high_frames: number;
}

interface RawPointRow {
	result_id: number;
	frame_number: number;
	low_points: number;
	high_points: number;
}

interface RawBreakRow {
	result_id: number;
	player_id: number;
	break_points: number;
}

export interface StatsFramePoints {
	frameNumber: number;
	lowPoints: number;
	highPoints: number;
}

export interface StatsBreak {
	player: StatsPlayer;
	points: number;
}

export interface StatsMatch {
	resultId: number;
	roundId: number;
	roundNumber: number;
	playedDate: string;
	confirmedAt: string;
	low: StatsPlayer;
	high: StatsPlayer;
	lowFrames: number;
	highFrames: number;
	framePoints: StatsFramePoints[];
	breaks: StatsBreak[];
}

export interface StatsRound {
	roundId: number;
	number: number;
	status: 'open' | 'closed';
	openedAt: string;
}

export interface StatsRecordHolder extends StatsPlayer {
	value: number;
	resultId: number;
	roundNumber: number;
	playedDate: string;
	frameNumber?: number;
}

export interface StatsRecord {
	value: number | null;
	holders: StatsRecordHolder[];
}

export interface StatsCoverage {
	recorded: number;
	eligible: number;
	percent: number | null;
}

export interface StatsPlayerRoundSummary extends PlayerRecordSummary {
	roundNumber: number | null;
	position: number | null;
}

export interface StatsTimelinePoint {
	id: string;
	date: string;
	timestamp: string;
	value: number;
	label: string;
	detail: string;
}

export interface PointsRoundSummary {
	roundNumber: number;
	date: string;
	average: number | null;
	totalPoints: number;
	framesWithDetail: number;
	recordedMatches: number;
	eligibleMatches: number;
}

export interface ImprovementDetail extends ImprovementComparison {
	player: StatsPlayer;
}

export interface HomeStatsHighlights {
	seasonId: number | null;
	seasonLabel: string | null;
	currentRoundNumber: number | null;
	mostImproved: ImprovementDetail[];
	mostImprovedReady: boolean;
	currentRoundRecordsReady: boolean;
	activeRoundPlayers: number;
	currentRoundPlayedBy: number;
	currentRoundConfirmedMatches: number;
	currentRoundHighestBreak: StatsRecord;
	currentRoundBestFrame: StatsRecord;
}

export interface PersonalStats {
	player: StatsPlayer;
	seasonSummary: PlayerRecordSummary & { position: number | null };
	roundSummary: StatsPlayerRoundSummary;
	recentForm: ReturnType<typeof recentForm>;
	streaks: StreakSummary;
	headToHead: HeadToHeadRow[];
	rollingFramesAverage: ReturnType<typeof rollingFramesWonAverage>;
	leaguePositionHistory: StatsTimelinePoint[];
	pointsPerRound: PointsRoundSummary[];
	pointsCoverage: StatsCoverage;
	breakCoverage: StatsCoverage;
	personalBestBreak: StatsRecord;
	personalBestFrame: StatsRecord;
	mostImproved: ImprovementDetail | null;
}

export interface LeaguePlayerSummary extends StatsPlayer, PlayerRecordSummary {
	position: number;
}

export interface LeagueStats {
	confirmedMatches: number;
	players: LeaguePlayerSummary[];
	highestBreak: StatsRecord;
	bestFrame: StatsRecord;
	breakCoverage: StatsCoverage;
	frameCoverage: StatsCoverage;
	mostImprovedReady: boolean;
	mostImproved: ImprovementDetail[];
	mostImprovedCandidateCount: number;
}

export interface StatsPageData {
	season: Pick<SeasonSummary, 'seasonId' | 'label' | 'framesPerMatch'> | null;
	currentRound: Pick<RoundSummary, 'roundId' | 'number' | 'status'> | null;
	viewer: StatsPlayer | null;
	personal: PersonalStats | null;
	league: LeagueStats;
}

const EMPTY_RECORD: StatsRecord = { value: null, holders: [] };
const EMPTY_COVERAGE: StatsCoverage = { recorded: 0, eligible: 0, percent: null };

function loadRounds(db: Db, seasonId: number): StatsRound[] {
	return (db
		.prepare(
			`SELECT id AS round_id, number, status, opened_at
			 FROM rounds WHERE season_id = ? ORDER BY number`
		)
		.all(seasonId) as Array<{
		round_id: number;
		number: number;
		status: string;
		opened_at: string;
	}>).map((row) => ({
		roundId: row.round_id,
		number: row.number,
		status: row.status as 'open' | 'closed',
		openedAt: row.opened_at
	}));
}

function chooseCurrentRound(rounds: StatsRound[]): StatsRound | null {
	return rounds.find((round) => round.status === 'open') ?? rounds.at(-1) ?? null;
}

function loadConfirmedMatches(db: Db, seasonId: number): StatsMatch[] {
	const rows = db
		.prepare(
			`SELECT r.id AS result_id, f.round_id, ro.number AS round_number,
				r.actual_played_date AS played_date,
				COALESCE(r.confirmed_at, r.submitted_at) AS confirmed_at,
				f.player_low_id, low.display_name AS low_name, low.initials AS low_initials,
				low.avatar_tone AS low_tone,
				f.player_high_id, high.display_name AS high_name, high.initials AS high_initials,
				high.avatar_tone AS high_tone,
				r.player_low_frames AS low_frames, r.player_high_frames AS high_frames
			 FROM results r
			 JOIN fixtures f ON f.id = r.fixture_id
			 JOIN rounds ro ON ro.id = f.round_id
			 JOIN players low ON low.id = f.player_low_id
			 JOIN players high ON high.id = f.player_high_id
			 WHERE ro.season_id = ? AND r.status = 'confirmed'
			 ORDER BY r.actual_played_date, ro.number, r.id`
		)
		.all(seasonId) as unknown as RawResultRow[];

	if (rows.length === 0) return [];
	const resultIds = rows.map((row) => row.result_id);
	const placeholders = resultIds.map(() => '?').join(',');
	const points = db
		.prepare(
			`SELECT rf.result_id, rf.frame_number,
				rf.player_low_points AS low_points,
				rf.player_high_points AS high_points
			 FROM result_frames rf WHERE rf.result_id IN (${placeholders})
			 ORDER BY rf.result_id, rf.frame_number`
		)
		.all(...resultIds) as unknown as RawPointRow[];
	const breaks = db
		.prepare(
			`SELECT rb.result_id, rb.player_id, rb.break_points
			 FROM result_breaks rb WHERE rb.result_id IN (${placeholders})
			 ORDER BY rb.result_id, rb.player_id`
		)
		.all(...resultIds) as unknown as RawBreakRow[];

	const pointsByResult = new Map<number, StatsFramePoints[]>();
	for (const point of points) {
		const list = pointsByResult.get(point.result_id) ?? [];
		list.push({
			frameNumber: point.frame_number,
				lowPoints: point.low_points,
				highPoints: point.high_points
		});
		pointsByResult.set(point.result_id, list);
	}
	const breaksByResult = new Map<number, StatsBreak[]>();
	const playerForResult = new Map<number, Map<number, StatsPlayer>>();
	for (const row of rows) {
		playerForResult.set(
			row.result_id,
			new Map([
				[
					row.player_low_id,
					{ playerId: row.player_low_id, name: row.low_name, initials: row.low_initials, tone: row.low_tone }
				],
				[
					row.player_high_id,
					{ playerId: row.player_high_id, name: row.high_name, initials: row.high_initials, tone: row.high_tone }
				]
			])
		);
	}
	for (const item of breaks) {
		const player = playerForResult.get(item.result_id)?.get(item.player_id);
		if (!player) continue;
		const list = breaksByResult.get(item.result_id) ?? [];
		list.push({ player, points: item.break_points });
		breaksByResult.set(item.result_id, list);
	}

	return rows.map((row) => ({
		resultId: row.result_id,
		roundId: row.round_id,
		roundNumber: row.round_number,
		playedDate: row.played_date,
		confirmedAt: row.confirmed_at,
		low: {
			playerId: row.player_low_id,
			name: row.low_name,
			initials: row.low_initials,
			tone: row.low_tone
		},
		high: {
			playerId: row.player_high_id,
			name: row.high_name,
			initials: row.high_initials,
			tone: row.high_tone
		},
		lowFrames: row.low_frames,
		highFrames: row.high_frames,
		framePoints: pointsByResult.get(row.result_id) ?? [],
		breaks: breaksByResult.get(row.result_id) ?? []
	}));
}

function perspective(match: StatsMatch, playerId: number): PlayerMatch | null {
	if (match.low.playerId === playerId) {
		return {
			resultId: match.resultId,
			roundId: match.roundId,
			roundNumber: match.roundNumber,
			playedDate: match.playedDate,
			framesWon: match.lowFrames,
			framesLost: match.highFrames,
			opponent: match.high,
			pointScores: match.framePoints.map((frame) => frame.lowPoints),
			highestBreak: match.breaks.find((entry) => entry.player.playerId === playerId)?.points ?? null
		};
	}
	if (match.high.playerId === playerId) {
		return {
			resultId: match.resultId,
			roundId: match.roundId,
			roundNumber: match.roundNumber,
			playedDate: match.playedDate,
			framesWon: match.highFrames,
			framesLost: match.lowFrames,
			opponent: match.low,
			pointScores: match.framePoints.map((frame) => frame.highPoints),
			highestBreak: match.breaks.find((entry) => entry.player.playerId === playerId)?.points ?? null
		};
	}
	return null;
}

function playerMatches(matches: readonly StatsMatch[], playerId: number): PlayerMatch[] {
	return sortPlayerMatches(matches.flatMap((match) => {
		const own = perspective(match, playerId);
		return own ? [own] : [];
	}));
}

function groupRecord(candidates: readonly StatsRecordHolder[]): StatsRecord {
	if (candidates.length === 0) return { value: null, holders: [] };
	const value = Math.max(...candidates.map((candidate) => candidate.value));
	const top = candidates.filter((candidate) => candidate.value === value);
	const perPlayer = new Map<number, StatsRecordHolder>();
	for (const candidate of top) {
		const current = perPlayer.get(candidate.playerId);
		if (
			!current ||
			candidate.playedDate < current.playedDate ||
			(candidate.playedDate === current.playedDate && candidate.resultId < current.resultId)
		) {
			perPlayer.set(candidate.playerId, candidate);
		}
	}
	return { value, holders: [...perPlayer.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

function recordsForMatches(matches: readonly StatsMatch[]): {
	highestBreak: StatsRecord;
	bestFrame: StatsRecord;
	breakCoverage: StatsCoverage;
	frameCoverage: StatsCoverage;
} {
	const breaks: StatsRecordHolder[] = [];
	const frames: StatsRecordHolder[] = [];
	const matchesWithFrames = new Set<number>();
	let breakEntries = 0;
	for (const match of matches) {
		for (const entry of match.breaks) {
			breakEntries++;
			breaks.push({
				...entry.player,
				value: entry.points,
				resultId: match.resultId,
				roundNumber: match.roundNumber,
				playedDate: match.playedDate
			});
		}
		if (match.framePoints.length > 0) matchesWithFrames.add(match.resultId);
		for (const frame of match.framePoints) {
			frames.push(
				{
					...match.low,
					value: frame.lowPoints,
					resultId: match.resultId,
					roundNumber: match.roundNumber,
					playedDate: match.playedDate,
					frameNumber: frame.frameNumber
				},
				{
					...match.high,
					value: frame.highPoints,
					resultId: match.resultId,
					roundNumber: match.roundNumber,
					playedDate: match.playedDate,
					frameNumber: frame.frameNumber
				}
			);
		}
	}
	const breakSlots = matches.length * 2;
	return {
		highestBreak: groupRecord(breaks),
		bestFrame: groupRecord(frames),
		breakCoverage: {
			recorded: breakEntries,
			eligible: breakSlots,
			percent: breakSlots === 0 ? null : (breakEntries / breakSlots) * 100
		},
		frameCoverage: {
			recorded: matchesWithFrames.size,
			eligible: matches.length,
			percent: matches.length === 0 ? null : (matchesWithFrames.size / matches.length) * 100
		}
	};
}

function pointStatsByRound(matches: readonly StatsMatch[], playerId: number, rounds: readonly StatsRound[]): PointsRoundSummary[] {
	const ownMatches = new Map<number, PlayerMatch[]>();
	for (const match of matches) {
		const own = perspective(match, playerId);
		if (!own) continue;
		const list = ownMatches.get(match.roundId) ?? [];
		list.push(own);
		ownMatches.set(match.roundId, list);
	}
	return rounds.map((round) => {
		const roundMatches = ownMatches.get(round.roundId) ?? [];
		const detailed = roundMatches.filter((match) => match.pointScores.length > 0);
		const totalPoints = detailed.reduce(
			(sum, match) => sum + match.pointScores.reduce((frameSum, points) => frameSum + points, 0),
			0
		);
		const framesWithDetail = detailed.reduce((sum, match) => sum + match.pointScores.length, 0);
		return {
			roundNumber: round.number,
			date: round.openedAt.slice(0, 10),
			average: framesWithDetail === 0 ? null : totalPoints / framesWithDetail,
			totalPoints,
			framesWithDetail,
			recordedMatches: detailed.length,
			eligibleMatches: roundMatches.length
		};
	});
}

function pointsCoverage(matches: readonly PlayerMatch[]): StatsCoverage {
	const recorded = matches.filter((match) => match.pointScores.length > 0).length;
	return {
		recorded,
		eligible: matches.length,
		percent: matches.length === 0 ? null : (recorded / matches.length) * 100
	};
}

function breakCoverageForPlayer(matches: readonly StatsMatch[], playerId: number): StatsCoverage {
	const recorded = matches.reduce(
		(sum, match) => sum + (match.breaks.some((entry) => entry.player.playerId === playerId) ? 1 : 0),
		0
	);
	const eligible = matches.filter(
		(match) => match.low.playerId === playerId || match.high.playerId === playerId
	).length;
	return { recorded, eligible, percent: eligible === 0 ? null : (recorded / eligible) * 100 };
}

function personalRecord(matches: readonly StatsMatch[], playerId: number, kind: 'break' | 'frame'): StatsRecord {
	const candidates: StatsRecordHolder[] = [];
	for (const match of matches) {
		if (kind === 'break') {
			for (const entry of match.breaks) {
				if (entry.player.playerId !== playerId) continue;
				candidates.push({
					...entry.player,
					value: entry.points,
					resultId: match.resultId,
					roundNumber: match.roundNumber,
					playedDate: match.playedDate
				});
			}
		} else {
			for (const frame of match.framePoints) {
				const player = match.low.playerId === playerId ? match.low : match.high.playerId === playerId ? match.high : null;
				if (!player) continue;
				candidates.push({
					...player,
					value: match.low.playerId === playerId ? frame.lowPoints : frame.highPoints,
					resultId: match.resultId,
					roundNumber: match.roundNumber,
					playedDate: match.playedDate,
					frameNumber: frame.frameNumber
				});
			}
		}
	}
	return groupRecord(candidates);
}

function loadPositionHistory(db: Db, seasonId: number, playerId: number): StatsTimelinePoint[] {
	const events = db
		.prepare(
			`SELECT event_at, event_type, event_id, round_number
			 FROM (
				SELECT COALESCE(r.confirmed_at, r.submitted_at) AS event_at,
					'RESULT' AS event_type, r.id AS event_id, ro.number AS round_number
				FROM results r
				JOIN fixtures f ON f.id = r.fixture_id
				JOIN rounds ro ON ro.id = f.round_id
				WHERE ro.season_id = ? AND r.status = 'confirmed'
				UNION ALL
				SELECT a.created_at AS event_at, 'AWARD' AS event_type,
					a.id AS event_id, ro.number AS round_number
				FROM awards a
				JOIN fixtures f ON f.id = a.fixture_id
				JOIN rounds ro ON ro.id = f.round_id
				WHERE ro.season_id = ?
			 )
			 WHERE event_at IS NOT NULL
			 ORDER BY julianday(event_at), CASE event_type WHEN 'RESULT' THEN 0 ELSE 1 END, event_id`
		)
		.all(seasonId, seasonId) as Array<{
		event_at: string;
		event_type: 'RESULT' | 'AWARD';
		event_id: number;
		round_number: number;
	}>;

	const timeline: StatsTimelinePoint[] = [];
	for (const event of events) {
		const eventType = event.event_type === 'RESULT' ? 'result' : 'award';
		const row = computeStandings(db, {
			seasonId,
			asOfAt: event.event_at,
			asOfEvent: { type: eventType, id: event.event_id }
		}).find((standing) => standing.playerId === playerId);
		if (!row) continue;
		const date = event.event_at.slice(0, 10);
		const eventSummary = eventType === 'result' ? 'confirmed result' : 'table-point award';
		timeline.push({
			id: `${eventType}-${event.event_id}`,
			date,
			timestamp: event.event_at,
			value: row.position,
			label: `Round ${event.round_number}`,
			detail: `Position ${row.position} after ${eventSummary} ${event.event_id} on ${date}`
		});
	}
	return timeline;
}

function loadOpeningRoster(db: Db, seasonId: number): StatsPlayer[] {
	const row = db
		.prepare('SELECT id FROM rounds WHERE season_id = ? ORDER BY number LIMIT 1')
		.get(seasonId) as { id: number } | undefined;
	if (!row) return [];
	return (db
		.prepare(
			`SELECT p.id AS playerId, p.display_name AS name, p.initials, p.avatar_tone AS tone
			 FROM round_players rp JOIN players p ON p.id = rp.player_id
			 WHERE rp.round_id = ? ORDER BY rp.player_id`
		)
		.all(row.id) as StatsPlayer[]);
}

function loadActiveRoundPlayers(db: Db, roundId: number): StatsPlayer[] {
	return db
		.prepare(
			`SELECT p.id AS playerId, p.display_name AS name, p.initials, p.avatar_tone AS tone
			 FROM round_players rp
			 JOIN players p ON p.id = rp.player_id
			 WHERE rp.round_id = ? AND rp.withdrawn = 0 AND p.is_active = 1
			 ORDER BY p.display_name COLLATE NOCASE`
		)
		.all(roundId) as StatsPlayer[];
}

function asImprovementDetail(
	value: ImprovedPlayer & ImprovementComparison
): ImprovementDetail {
	return {
		player: value.player,
		previousAverage: value.previousAverage,
		recentAverage: value.recentAverage,
		change: value.change,
		previousMatches: value.previousMatches,
		recentMatches: value.recentMatches
	};
}

function buildMostImproved(
	db: Db,
	seasonId: number,
	currentRound: StatsRound | null,
	allMatches: readonly StatsMatch[]
): {
	evaluation: ReturnType<typeof evaluateMostImproved>;
	personalCandidates: Map<number, ImprovementDetail>;
} {
	if (!currentRound) {
		return { evaluation: { ready: false, winnerDeltaFrames: null, winners: [] }, personalCandidates: new Map() };
	}

	// Freeze eligibility at the round's actual open instant. Later corrections
	// retain the original confirmation time, so their new values flow through;
	// a newly recorded retrospective result cannot silently change the snapshot.
	const openedAt = Date.parse(currentRound.openedAt);
	const snapshotMatches = allMatches.filter(
		(match) => Number.isFinite(openedAt) && Date.parse(match.confirmedAt) <= openedAt
	);
	const activePlayers = loadActiveRoundPlayers(db, currentRound.roundId);
	const activeIds = new Set(activePlayers.map((player) => player.playerId));
	const openingRoster = loadOpeningRoster(db, seasonId).filter((player) => activeIds.has(player.playerId));
	const openingIds = openingRoster.map((player) => player.playerId);
	const readinessPlayers = new Map<number, StatsPlayer>();
	for (const player of [...openingRoster, ...activePlayers]) readinessPlayers.set(player.playerId, player);
	const cohortAndActiveCandidates: ImprovedPlayer[] = [...readinessPlayers.values()].map((player) => ({
		player,
		matches: playerMatches(snapshotMatches, player.playerId)
	}));
	const rawEvaluation = evaluateMostImproved(openingIds, cohortAndActiveCandidates, MOST_IMPROVED_WINDOW);
	const evaluation = {
		...rawEvaluation,
		// A season-opening player who withdrew before reaching 16 no longer blocks
		// the initial unlock and cannot win a current-round highlight.
		winners: rawEvaluation.winners.filter((candidate) => activeIds.has(candidate.player.playerId))
	};
	const personalCandidates = new Map<number, ImprovementDetail>();
	if (evaluation.ready) {
		for (const candidate of activePlayers) {
			const comparison = compareLatestWindows(
				candidate,
				playerMatches(snapshotMatches, candidate.playerId),
				MOST_IMPROVED_WINDOW
			);
			if (comparison) personalCandidates.set(candidate.playerId, asImprovementDetail(comparison));
		}
	}
	return { evaluation, personalCandidates };
}

function evaluationDetails(evaluation: ReturnType<typeof evaluateMostImproved>): ImprovementDetail[] {
	return evaluation.winners.map(asImprovementDetail);
}

function emptyHomeHighlights(): HomeStatsHighlights {
	return {
		seasonId: null,
		seasonLabel: null,
		currentRoundNumber: null,
		mostImproved: [],
		mostImprovedReady: false,
		currentRoundRecordsReady: false,
		activeRoundPlayers: 0,
		currentRoundPlayedBy: 0,
		currentRoundConfirmedMatches: 0,
		currentRoundHighestBreak: EMPTY_RECORD,
		currentRoundBestFrame: EMPTY_RECORD
	};
}

export function loadHomeStatsHighlights(
	db: Db,
	season: SeasonSummary | null,
	currentRound: RoundSummary | null
): HomeStatsHighlights {
	if (!season) return emptyHomeHighlights();
	const matches = loadConfirmedMatches(db, season.seasonId);
	const statsRound = currentRound
		? { roundId: currentRound.roundId, number: currentRound.number, status: currentRound.status, openedAt: currentRound.openedAt }
		: null;
	const { evaluation } = buildMostImproved(db, season.seasonId, statsRound, matches);
	const roundMatches = currentRound
		? matches.filter((match) => match.roundId === currentRound.roundId)
		: [];
	const activePlayers = currentRound ? loadActiveRoundPlayers(db, currentRound.roundId) : [];
	const playedPlayerIds = new Set<number>();
	for (const match of roundMatches) {
		playedPlayerIds.add(match.low.playerId);
		playedPlayerIds.add(match.high.playerId);
	}
	const currentRoundRecordsReady =
		activePlayers.length > 0 && activePlayers.every((player) => playedPlayerIds.has(player.playerId));
	const currentRoundRecords = currentRoundRecordsReady ? recordsForMatches(roundMatches) : null;
	return {
		seasonId: season.seasonId,
		seasonLabel: season.label,
		currentRoundNumber: currentRound?.number ?? null,
		mostImproved: evaluationDetails(evaluation),
		mostImprovedReady: evaluation.ready,
		currentRoundRecordsReady,
		activeRoundPlayers: activePlayers.length,
		currentRoundPlayedBy: activePlayers.filter((player) => playedPlayerIds.has(player.playerId)).length,
		currentRoundConfirmedMatches: roundMatches.length,
		currentRoundHighestBreak: currentRoundRecords?.highestBreak ?? EMPTY_RECORD,
		currentRoundBestFrame: currentRoundRecords?.bestFrame ?? EMPTY_RECORD
	};
}

function loadPersonalPosition(
	db: Db,
	seasonId: number,
	roundId: number | null,
	playerId: number
): { season: number | null; round: number | null } {
	const seasonPosition = computeStandings(db, { seasonId }).find((row) => row.playerId === playerId)?.position ?? null;
	const roundPosition = roundId === null
		? null
		: computeStandings(db, { seasonId, roundId }).find((row) => row.playerId === playerId)?.position ?? null;
	return { season: seasonPosition, round: roundPosition };
}

function loadPointsRoundSummaries(
	playerId: number,
	rounds: readonly StatsRound[],
	matches: readonly StatsMatch[]
): PointsRoundSummary[] {
	return pointStatsByRound(matches, playerId, rounds);
}

export function loadStatsPageData(db: Db, viewerPlayerId: number | null): StatsPageData {
	const latestSeason = db.prepare('SELECT id FROM seasons ORDER BY id DESC LIMIT 1').get() as
		| { id: number }
		| undefined;
	if (!latestSeason) {
		return {
			season: null,
			currentRound: null,
			viewer: null,
			personal: null,
			league: {
				confirmedMatches: 0,
				players: [],
				highestBreak: EMPTY_RECORD,
				bestFrame: EMPTY_RECORD,
				breakCoverage: EMPTY_COVERAGE,
				frameCoverage: EMPTY_COVERAGE,
				mostImprovedReady: false,
				mostImproved: [],
				mostImprovedCandidateCount: 0
			}
		};
	}

	const season = loadSeason(db, latestSeason.id);
	if (!season) throw new Error(`Season ${latestSeason.id} could not be loaded.`);
	const rounds = loadRounds(db, season.seasonId);
	const currentRound = chooseCurrentRound(rounds);
	const allMatches = loadConfirmedMatches(db, season.seasonId);
	const records = recordsForMatches(allMatches);
	const standings = computeStandings(db, { seasonId: season.seasonId });
	const leaguePlayers: LeaguePlayerSummary[] = standings.map((standing) => ({
		playerId: standing.playerId,
		name: standing.name,
		initials: standing.initials,
		tone: standing.tone,
		...summarisePlayerMatches(playerMatches(allMatches, standing.playerId)),
		position: standing.position
	}));
	const { evaluation, personalCandidates } = buildMostImproved(
		db,
		season.seasonId,
		currentRound,
		allMatches
	);
	const roundOpenTimestamp = currentRound ? Date.parse(currentRound.openedAt) : Number.NaN;
	const roundOpenMatches = allMatches.filter(
		(match) => Number.isFinite(roundOpenTimestamp) && Date.parse(match.confirmedAt) <= roundOpenTimestamp
	);
	const candidateCount = currentRound
		? loadActiveRoundPlayers(db, currentRound.roundId).filter(
			(player) => playerMatches(roundOpenMatches, player.playerId).length >= MOST_IMPROVED_WINDOW * 2
		).length
		: 0;

	const viewerRow = viewerPlayerId === null
		? null
		: (db
				.prepare(
					`SELECT id AS playerId, display_name AS name, initials, avatar_tone AS tone
					 FROM players WHERE id = ? AND is_active = 1`
				)
				.get(viewerPlayerId) as StatsPlayer | undefined) ?? null;
	let personal: PersonalStats | null = null;
	if (viewerRow) {
		const matches = playerMatches(allMatches, viewerRow.playerId);
		const currentRoundMatches = currentRound
			? matches.filter((match) => match.roundId === currentRound.roundId)
			: [];
		const summary = summarisePlayerMatches(matches);
		const positions = loadPersonalPosition(db, season.seasonId, currentRound?.roundId ?? null, viewerRow.playerId);
		const allPlayerBreaks = personalRecord(allMatches, viewerRow.playerId, 'break');
		const allPlayerFrames = personalRecord(allMatches, viewerRow.playerId, 'frame');
		const roundMatchesForPoints = loadPointsRoundSummaries(viewerRow.playerId, rounds, allMatches);
		const pointsMatches = roundMatchesForPoints.reduce((sum, round) => sum + round.recordedMatches, 0);
		const totalPlayerMatches = matches.length;
		personal = {
			player: viewerRow,
			seasonSummary: { ...summary, position: positions.season },
			roundSummary: {
				...summarisePlayerMatches(currentRoundMatches),
				roundNumber: currentRound?.number ?? null,
				position: positions.round
			},
			recentForm: recentForm(matches, RECENT_FORM_LIMIT),
			streaks: streakSummary(matches),
			headToHead: headToHead(matches),
			rollingFramesAverage: rollingFramesWonAverage(matches, MOST_IMPROVED_WINDOW),
			leaguePositionHistory: loadPositionHistory(db, season.seasonId, viewerRow.playerId),
			pointsPerRound: roundMatchesForPoints,
			pointsCoverage: { recorded: pointsMatches, eligible: totalPlayerMatches, percent: totalPlayerMatches === 0 ? null : (pointsMatches / totalPlayerMatches) * 100 },
			breakCoverage: breakCoverageForPlayer(allMatches, viewerRow.playerId),
			personalBestBreak: allPlayerBreaks,
			personalBestFrame: allPlayerFrames,
			mostImproved: personalCandidates.get(viewerRow.playerId) ?? null
		};
	}

	const currentRoundSummary = currentRound
		? season.rounds.find((round) => round.roundId === currentRound.roundId) ?? null
		: null;
	return {
		season: { seasonId: season.seasonId, label: season.label, framesPerMatch: season.framesPerMatch },
		currentRound: currentRoundSummary
			? { roundId: currentRoundSummary.roundId, number: currentRoundSummary.number, status: currentRoundSummary.status }
			: null,
		viewer: viewerRow,
		personal,
		league: {
			confirmedMatches: allMatches.length,
			players: leaguePlayers,
			highestBreak: records.highestBreak,
			bestFrame: records.bestFrame,
			breakCoverage: records.breakCoverage,
			frameCoverage: records.frameCoverage,
			mostImprovedReady: evaluation.ready,
			mostImproved: evaluationDetails(evaluation),
			mostImprovedCandidateCount: candidateCount
		}
	};
}
