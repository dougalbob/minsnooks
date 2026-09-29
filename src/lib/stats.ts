/**
 * Pure league-stat calculations shared by the server loader and tests.
 * Every input is already a confirmed, genuine league result; bookings,
 * awards, closures, friendlies and knockouts never enter these functions.
 */

export interface TrendPoint {
	id: string;
	date: string;
	timestamp?: string;
	value: number;
	label: string;
	detail: string;
}

export interface StatsPlayer {
	playerId: number;
	name: string;
	initials: string;
	tone: string;
}

export type MatchOutcome = 'win' | 'loss' | 'draw';

export interface PlayerMatch {
	resultId: number;
	roundId: number;
	roundNumber: number;
	playedDate: string;
	framesWon: number;
	framesLost: number;
	opponent: StatsPlayer;
	pointScores: number[];
	highestBreak: number | null;
}

export interface PlayerRecordSummary {
	played: number;
	wins: number;
	losses: number;
	draws: number;
	winRate: number | null;
	framesWon: number;
	framesLost: number;
	averageFramesWon: number | null;
}

export interface FormMatch {
	resultId: number;
	roundNumber: number;
	playedDate: string;
	outcome: MatchOutcome;
	opponentName: string;
	framesWon: number;
	framesLost: number;
}

export interface RollingAveragePoint {
	resultId: number;
	playedDate: string;
	roundNumber: number;
	average: number;
	matchesInWindow: number;
}

export interface HeadToHeadRow {
	opponent: StatsPlayer;
	played: number;
	wins: number;
	losses: number;
	framesWon: number;
	framesLost: number;
}

export interface StreakSummary {
	currentOutcome: MatchOutcome | null;
	currentLength: number;
	bestWinLength: number;
}

export interface ImprovedPlayer {
	player: StatsPlayer;
	matches: PlayerMatch[];
}

export interface ImprovementComparison {
	previousAverage: number;
	recentAverage: number;
	change: number;
	previousMatches: PlayerMatch[];
	recentMatches: PlayerMatch[];
}

export interface MostImprovedEvaluation {
	ready: boolean;
	winnerDeltaFrames: number | null;
	winners: Array<ImprovedPlayer & ImprovementComparison>;
}

export function sortPlayerMatches(matches: readonly PlayerMatch[]): PlayerMatch[] {
	return [...matches].sort(
		(a, b) =>
		a.playedDate.localeCompare(b.playedDate) ||
		a.roundNumber - b.roundNumber ||
		a.resultId - b.resultId
	);
}

export function outcomeFor(framesWon: number, framesLost: number): MatchOutcome {
	return framesWon > framesLost ? 'win' : framesWon < framesLost ? 'loss' : 'draw';
}

export function summarisePlayerMatches(matches: readonly PlayerMatch[]): PlayerRecordSummary {
	let wins = 0;
	let losses = 0;
	let draws = 0;
	let framesWon = 0;
	let framesLost = 0;
	for (const match of matches) {
		const outcome = outcomeFor(match.framesWon, match.framesLost);
		if (outcome === 'win') wins++;
		else if (outcome === 'loss') losses++;
		else draws++;
		framesWon += match.framesWon;
		framesLost += match.framesLost;
	}
	const played = matches.length;
	return {
		played,
		wins,
		losses,
		draws,
		winRate: played === 0 ? null : (wins / played) * 100,
		framesWon,
		framesLost,
		averageFramesWon: played === 0 ? null : framesWon / played
	};
}

/** Latest `limit` outcomes, in chronological (oldest-to-newest) display order. */
export function recentForm(matches: readonly PlayerMatch[], limit = 5): FormMatch[] {
	const ordered = sortPlayerMatches(matches);
	return ordered.slice(Math.max(0, ordered.length - Math.max(0, limit))).map((match) => ({
		resultId: match.resultId,
		roundNumber: match.roundNumber,
		playedDate: match.playedDate,
		outcome: outcomeFor(match.framesWon, match.framesLost),
		opponentName: match.opponent.name,
		framesWon: match.framesWon,
		framesLost: match.framesLost
	}));
}

/** Rolling per-match average. Early points use the available sample until full. */
export function rollingFramesWonAverage(
	matches: readonly PlayerMatch[],
	windowSize = 8
): RollingAveragePoint[] {
	if (!Number.isInteger(windowSize) || windowSize < 1) return [];
	const ordered = sortPlayerMatches(matches);
	return ordered.map((match, index) => {
		const start = Math.max(0, index - windowSize + 1);
		const window = ordered.slice(start, index + 1);
		const totalFrames = window.reduce((sum, item) => sum + item.framesWon, 0);
		return {
			resultId: match.resultId,
			playedDate: match.playedDate,
			roundNumber: match.roundNumber,
			average: totalFrames / window.length,
			matchesInWindow: window.length
		};
	});
}

export function headToHead(matches: readonly PlayerMatch[]): HeadToHeadRow[] {
	const byOpponent = new Map<number, HeadToHeadRow>();
	for (const match of matches) {
		let row = byOpponent.get(match.opponent.playerId);
		if (!row) {
			row = {
				opponent: match.opponent,
				played: 0,
				wins: 0,
				losses: 0,
				framesWon: 0,
				framesLost: 0
			};
			byOpponent.set(match.opponent.playerId, row);
		}
		row.played++;
		if (match.framesWon > match.framesLost) row.wins++;
		else if (match.framesWon < match.framesLost) row.losses++;
		row.framesWon += match.framesWon;
		row.framesLost += match.framesLost;
	}
	return [...byOpponent.values()].sort(
		(a, b) => b.wins - a.wins || b.framesWon - a.framesWon || a.opponent.name.localeCompare(b.opponent.name)
	);
}

export function streakSummary(matches: readonly PlayerMatch[]): StreakSummary {
	const ordered = sortPlayerMatches(matches);
	if (ordered.length === 0) return { currentOutcome: null, currentLength: 0, bestWinLength: 0 };

	let bestWinLength = 0;
	let runOutcome: MatchOutcome | null = null;
	let runLength = 0;
	for (const match of ordered) {
		const outcome = outcomeFor(match.framesWon, match.framesLost);
		if (outcome === runOutcome) runLength++;
		else {
			runOutcome = outcome;
			runLength = 1;
		}
		if (outcome === 'win') bestWinLength = Math.max(bestWinLength, runLength);
	}

	return { currentOutcome: runOutcome, currentLength: runLength, bestWinLength };
}

export function compareLatestWindows(
	player: StatsPlayer,
	matches: readonly PlayerMatch[],
	windowSize = 8
): (ImprovedPlayer & ImprovementComparison) | null {
	if (!Number.isInteger(windowSize) || windowSize < 1) return null;
	const ordered = sortPlayerMatches(matches);
	if (ordered.length < windowSize * 2) return null;
	const lastTwoWindows = ordered.slice(-windowSize * 2);
	const previousMatches = lastTwoWindows.slice(0, windowSize);
	const recentMatches = lastTwoWindows.slice(windowSize);
	const previousAverage = previousMatches.reduce((sum, match) => sum + match.framesWon, 0) / windowSize;
	const recentAverage = recentMatches.reduce((sum, match) => sum + match.framesWon, 0) / windowSize;
	return {
		player,
		matches: ordered,
		previousAverage,
		recentAverage,
		change: recentAverage - previousAverage,
		previousMatches,
		recentMatches
	};
}

/**
 * The season-opening active cohort controls the initial unlock. Once ready,
 * later joiners are candidates only when they have their own full 16 matches.
 * Only positive change can win; equal best improvements share the highlight.
 */
export function evaluateMostImproved(
	openingCohortPlayerIds: readonly number[],
	activePlayers: readonly ImprovedPlayer[],
	windowSize = 8
): MostImprovedEvaluation {
	if (
		!Number.isInteger(windowSize) ||
		windowSize < 1 ||
		openingCohortPlayerIds.length === 0
	) {
		return { ready: false, winnerDeltaFrames: null, winners: [] };
	}

	const activeById = new Map(activePlayers.map((candidate) => [candidate.player.playerId, candidate]));
	const ready = openingCohortPlayerIds.every((playerId) => {
		const player = activeById.get(playerId);
		return player !== undefined && sortPlayerMatches(player.matches).length >= windowSize * 2;
	});
	if (!ready) return { ready: false, winnerDeltaFrames: null, winners: [] };

	const comparisons = activePlayers
		.map((candidate) => compareLatestWindows(candidate.player, candidate.matches, windowSize))
		.filter((candidate): candidate is ImprovedPlayer & ImprovementComparison => candidate !== null);
	const positive = comparisons.filter((candidate) => candidate.change > 0);
	if (positive.length === 0) return { ready: true, winnerDeltaFrames: null, winners: [] };
	const winnerDeltaFrames = Math.max(...positive.map((candidate) => {
		// All windows are the same size, so this remains exact for ordering.
		return Math.round(candidate.change * windowSize);
	}));
	const winners = positive.filter(
		(candidate) => Math.round(candidate.change * windowSize) === winnerDeltaFrames
	);
	return { ready: true, winnerDeltaFrames, winners };
}
