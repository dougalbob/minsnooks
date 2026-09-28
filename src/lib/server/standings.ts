/**
 * Canonical standings engine (HANDOFF §10).
 *
 * This module is the single path from the database to a standings table.
 * Every screen, report and statistic that needs a league position must go
 * through `computeStandings`; nothing recomputes points, frame difference or
 * wins on its own.
 *
 * Rules implemented (HANDOFF §4):
 *   * Only **confirmed** results count. A submitted-but-unconfirmed result
 *     never moves the table.
 *   * Ordering: table points, then frame difference, then match wins. Players
 *     still tied share a position (joint first = joint champions).
 *   * Table points = frames won in confirmed results + administrative award
 *     points. Awards add table points ONLY — never frames, frame difference or
 *     match wins — and raise the asterisk flag.
 *   * Neutral closures contribute nothing: they are not results, so they simply
 *     do not appear here.
 *
 * The pure ordering/ball-colour core lives in `$lib/standings` so it can be
 * unit-tested and shared with the client.
 */
import type { Db } from './db';
import { rankRows, type RankedRow, type StandingRow } from '../standings';

export interface PlayerStanding extends RankedRow {
	playerId: number;
}

export interface StandingsQuery {
	seasonId: number;
	/** Omit (or pass null) for the whole-season table. */
	roundId?: number | null;
}

/** Row shape as aggregated by SQL (before ranking). */
interface AggregateRow {
	player_id: number;
	display_name: string;
	initials: string;
	avatar_tone: string;
	played: number;
	frames_won: number;
	frames_lost: number;
	wins: number;
	award_points: number;
}

const STANDINGS_SQL = `
	WITH scope_rounds AS (
		SELECT id FROM rounds WHERE season_id = @seasonId
	),
	scope_fixtures AS (
		SELECT f.id AS fixture_id, f.round_id, f.player_low_id, f.player_high_id
		FROM fixtures f
		JOIN scope_rounds sr ON sr.id = f.round_id
		WHERE (@roundId IS NULL OR f.round_id = @roundId)
	),
	scope_players AS (
		SELECT DISTINCT rp.player_id
		FROM round_players rp
		JOIN scope_rounds sr ON sr.id = rp.round_id
		WHERE (@roundId IS NULL OR rp.round_id = @roundId)
	),
	played AS (
		SELECT sf.player_low_id AS player_id,
			1 AS played,
			r.player_low_frames AS frames_won,
			r.player_high_frames AS frames_lost,
			CASE WHEN r.player_low_frames > r.player_high_frames THEN 1 ELSE 0 END AS won
		FROM scope_fixtures sf
		JOIN results r ON r.fixture_id = sf.fixture_id
		WHERE r.status = 'confirmed'
		UNION ALL
		SELECT sf.player_high_id AS player_id,
			1 AS played,
			r.player_high_frames AS frames_won,
			r.player_low_frames AS frames_lost,
			CASE WHEN r.player_high_frames > r.player_low_frames THEN 1 ELSE 0 END AS won
		FROM scope_fixtures sf
		JOIN results r ON r.fixture_id = sf.fixture_id
		WHERE r.status = 'confirmed'
	),
	played_totals AS (
		SELECT player_id,
			COUNT(*) AS played,
			SUM(frames_won) AS frames_won,
			SUM(frames_lost) AS frames_lost,
			SUM(won) AS wins
		FROM played
		GROUP BY player_id
	),
	award_totals AS (
		SELECT a.player_id, SUM(a.table_points) AS award_points
		FROM awards a
		JOIN scope_fixtures sf ON sf.fixture_id = a.fixture_id
		GROUP BY a.player_id
	)
	SELECT p.id AS player_id,
		p.display_name,
		p.initials,
		p.avatar_tone,
		COALESCE(pt.played, 0) AS played,
		COALESCE(pt.frames_won, 0) AS frames_won,
		COALESCE(pt.frames_lost, 0) AS frames_lost,
		COALESCE(pt.wins, 0) AS wins,
		COALESCE(at.award_points, 0) AS award_points
	FROM scope_players sp
	JOIN players p ON p.id = sp.player_id
	LEFT JOIN played_totals pt ON pt.player_id = p.id
	LEFT JOIN award_totals at ON at.player_id = p.id
`;

/**
 * Compute the ranked standings for a round (or the whole season) from the
 * database. This is the canonical standings path.
 */
export function computeStandings(db: Db, query: StandingsQuery): PlayerStanding[] {
	const rows = db.prepare(STANDINGS_SQL).all({
		seasonId: query.seasonId,
		roundId: query.roundId ?? null
	}) as unknown as AggregateRow[];

	const standingRows: StandingRow[] = rows.map((row) => ({
		name: row.display_name,
		initials: row.initials,
		tone: row.avatar_tone,
		played: row.played,
		// Table points = frames won + award points. Awards never touch frames,
		// frame difference or wins.
		points: row.frames_won + row.award_points,
		frameDiff: row.frames_won - row.frames_lost,
		wins: row.wins,
		award: row.award_points > 0
	}));

	return rankRows(standingRows).map((ranked, index) => ({
		...ranked,
		playerId: rows[index].player_id
	}));
}

export interface RoundProgress {
	/** Fixtures with a confirmed result. */
	confirmed: number;
	/** Fixtures with a submitted (unconfirmed) result. */
	awaitingConfirmation: number;
	/** Fixtures resolved by an administrative award. */
	awarded: number;
	/** Fixtures open for play. */
	unplayed: number;
	/** Fixtures neutrally closed after grace. */
	closedUnplayed: number;
	/** Total fixtures in the round. */
	total: number;
}

export function roundProgress(db: Db, roundId: number): RoundProgress {
	const rows = db
		.prepare('SELECT state, COUNT(*) AS n FROM fixtures WHERE round_id = ? GROUP BY state')
		.all(roundId) as Array<{ state: string; n: number }>;
	const counts: RoundProgress = {
		confirmed: 0,
		awaitingConfirmation: 0,
		awarded: 0,
		unplayed: 0,
		closedUnplayed: 0,
		total: 0
	};
	for (const row of rows) {
		counts.total += row.n;
		switch (row.state) {
			case 'confirmed':
				counts.confirmed += row.n;
				break;
			case 'awaiting_confirmation':
				counts.awaitingConfirmation += row.n;
				break;
			case 'awarded':
				counts.awarded += row.n;
				break;
			case 'closed_unplayed':
				counts.closedUnplayed += row.n;
				break;
			default:
				counts.unplayed += row.n;
		}
	}
	return counts;
}

export interface SeasonSummary {
	seasonId: number;
	label: string;
	framesPerMatch: number;
	pointsPerFrame: number;
	matchWinBonus: number;
	timezone: string;
	rounds: RoundSummary[];
}

export interface RoundSummary {
	roundId: number;
	number: number;
	status: 'open' | 'closed';
	isFinal: boolean;
	deadlineAt: string | null;
	graceDays: number;
	playerCount: number;
	progress: RoundProgress;
}

interface SeasonRow {
	id: number;
	label: string;
	frames_per_match: number;
	points_per_frame: number;
	match_win_bonus: number;
	timezone: string;
}

interface RoundRow {
	id: number;
	number: number;
	status: string;
	is_final: number;
	deadline_at: string | null;
	grace_days: number;
}

/** Everything the UI needs to describe a season without touching league logic. */
export function loadSeason(db: Db, seasonId: number): SeasonSummary | null {
	const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId) as
		| SeasonRow
		| undefined;
	if (!season) return null;
	const rounds = db
		.prepare('SELECT * FROM rounds WHERE season_id = ? ORDER BY number')
		.all(seasonId) as unknown as RoundRow[];
	const playerCounts = db
		.prepare(
			'SELECT round_id, COUNT(*) AS n FROM round_players WHERE round_id IN (SELECT id FROM rounds WHERE season_id = ?) GROUP BY round_id'
		)
		.all(seasonId) as unknown as Array<{ round_id: number; n: number }>;
	const playersByRound = new Map(playerCounts.map((row) => [row.round_id, row.n]));

	return {
		seasonId: season.id,
		label: season.label,
		framesPerMatch: season.frames_per_match,
		pointsPerFrame: season.points_per_frame,
		matchWinBonus: season.match_win_bonus,
		timezone: season.timezone,
		rounds: rounds.map((round) => ({
			roundId: round.id,
			number: round.number,
			status: round.status as 'open' | 'closed',
			isFinal: round.is_final === 1,
			deadlineAt: round.deadline_at,
			graceDays: round.grace_days,
			playerCount: playersByRound.get(round.id) ?? 0,
			progress: roundProgress(db, round.id)
		}))
	};
}
