import type { Db } from './db';
import { computeStandings, loadSeason, type PlayerStanding, type RoundProgress, type RoundSummary, type SeasonSummary } from './standings';

export interface RoundRosterPlayer {
	playerId: number;
	name: string;
	initials: string;
	tone: string;
	withdrawn: boolean;
}

export interface HomePageData {
	season: SeasonSummary | null;
	currentRound: RoundSummary | null;
	roundRows: PlayerStanding[];
	seasonRows: PlayerStanding[];
	roundPlayers: RoundRosterPlayer[];
	roundProgress: RoundProgress | null;
	seasonProgress: RoundProgress;
}

const EMPTY_PROGRESS: RoundProgress = {
	confirmed: 0,
	awaitingConfirmation: 0,
	awarded: 0,
	unplayed: 0,
	closedUnplayed: 0,
	total: 0
};

function sumProgress(rounds: RoundSummary[]): RoundProgress {
	return rounds.reduce(
		(total, round) => ({
			confirmed: total.confirmed + round.progress.confirmed,
			awaitingConfirmation: total.awaitingConfirmation + round.progress.awaitingConfirmation,
			awarded: total.awarded + round.progress.awarded,
			unplayed: total.unplayed + round.progress.unplayed,
			closedUnplayed: total.closedUnplayed + round.progress.closedUnplayed,
			total: total.total + round.progress.total
		}),
		{ ...EMPTY_PROGRESS }
	);
}

/** Load all real, database-backed data needed by the league home page. */
export function loadHomePageData(db: Db): HomePageData {
	const latestSeason = db
		.prepare('SELECT id FROM seasons ORDER BY id DESC LIMIT 1')
		.get() as { id: number } | undefined;

	if (!latestSeason) {
		return {
			season: null,
			currentRound: null,
			roundRows: [],
			seasonRows: [],
			roundPlayers: [],
			roundProgress: null,
			seasonProgress: { ...EMPTY_PROGRESS }
		};
	}

	const season = loadSeason(db, latestSeason.id);
	if (!season) throw new Error(`Season ${latestSeason.id} could not be loaded.`);

	// Prefer the scheduling round; if none is open, present the latest round.
	const currentRound =
		season.rounds.find((round) => round.status === 'open') ?? season.rounds.at(-1) ?? null;
	const roundRows = currentRound
		? computeStandings(db, { seasonId: season.seasonId, roundId: currentRound.roundId })
		: [];
	const seasonRows = computeStandings(db, { seasonId: season.seasonId });
	const roundPlayers = currentRound
		? (db
				.prepare(
					`SELECT p.id AS player_id, p.display_name, p.initials, p.avatar_tone, rp.withdrawn
					 FROM round_players rp
					 JOIN players p ON p.id = rp.player_id
					 WHERE rp.round_id = ?
					 ORDER BY p.display_name COLLATE NOCASE`
				)
				.all(currentRound.roundId) as Array<{
					player_id: number;
					display_name: string;
					initials: string;
					avatar_tone: string;
					withdrawn: number;
				}>).map((player) => ({
				playerId: player.player_id,
				name: player.display_name,
				initials: player.initials,
				tone: player.avatar_tone,
				withdrawn: player.withdrawn === 1
			}))
		: [];

	return {
		season,
		currentRound,
		roundRows,
		seasonRows,
		roundPlayers,
		roundProgress: currentRound?.progress ?? null,
		seasonProgress: sumProgress(season.rounds)
	};
}
