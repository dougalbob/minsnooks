/**
 * Debug / inspection page for the Phase 2 checkpoint.
 *
 * Everything here is read straight out of SQLite through the canonical
 * standings engine (`computeStandings`) — no provisional arrays. It exists so
 * the owner can confirm the seeded league, and so a later phase can be diffed
 * against a known-good state. It is not part of the player-facing app.
 */
import { getDb } from '$lib/server/db';
import { computeStandings, loadSeason, type SeasonSummary } from '$lib/server/standings';
import { buildLeagueSeedPlan } from '$lib/server/seed-data';

export interface DebugRoundRow {
	number: number;
	status: 'open' | 'closed';
	isFinal: boolean;
	players: number;
	confirmed: number;
	awarded: number;
	unplayed: number;
	closedUnplayed: number;
	total: number;
	deadlineAt: string | null;
	graceDays: number;
}

export interface DebugSeedData {
	season: SeasonSummary;
	roundRows: Awaited<ReturnType<typeof computeStandings>>;
	seasonRows: Awaited<ReturnType<typeof computeStandings>>;
	roundTable: DebugRoundRow[];
	/** Rounds whose unplayed fixtures are still open for play. */
	currentRoundNumber: number | null;
	awards: Array<{
		round: number;
		recipient: string;
		opponent: string;
		tablePoints: number;
		sourceType: string;
		reason: string | null;
	}>;
	auditCount: number;
	expectedConfirmed: number;
}

export function load(): DebugSeedData {
	const db = getDb();
	const season = loadSeason(db, 1);
	if (!season) {
		throw new Error('Season 2026 is not seeded. Run `npm run seed` first.');
	}
	const current = season.rounds.find((round) => round.status === 'open');
	const roundId = current?.roundId ?? season.rounds[season.rounds.length - 1].roundId;

	interface AwardRow {
		round: number;
		recipient: string;
		opponent: string;
		table_points: number;
		source_type: string;
		reason: string | null;
	}
	const awards = db
		.prepare(
			`SELECT ro.number AS round,
					recipient.display_name AS recipient,
					opponent.display_name AS opponent,
					a.table_points, a.source_type, a.reason
			 FROM awards a
			 JOIN fixtures f ON f.id = a.fixture_id
			 JOIN rounds ro ON ro.id = f.round_id
			 JOIN players recipient ON recipient.id = a.player_id
			 JOIN players opponent ON opponent.id =
					CASE WHEN a.player_id = f.player_low_id THEN f.player_high_id ELSE f.player_low_id END
			 WHERE ro.season_id = 1
			 ORDER BY ro.number, a.id`
		)
		.all() as AwardRow[];

	return {
		season,
		roundRows: computeStandings(db, { seasonId: 1, roundId }),
		seasonRows: computeStandings(db, { seasonId: 1 }),
		roundTable: season.rounds.map((round) => ({
			number: round.number,
			status: round.status,
			isFinal: round.isFinal,
			players: round.playerCount,
			confirmed: round.progress.confirmed,
			awarded: round.progress.awarded,
			unplayed: round.progress.unplayed,
			closedUnplayed: round.progress.closedUnplayed,
			total: round.progress.total,
			deadlineAt: round.deadlineAt,
			graceDays: round.graceDays
		})),
		currentRoundNumber: current?.number ?? null,
		awards: awards.map((award) => ({
			round: award.round,
			recipient: award.recipient,
			opponent: award.opponent,
			tablePoints: award.table_points,
			sourceType: award.source_type,
			reason: award.reason
		})),
		auditCount: (db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n,
		expectedConfirmed: buildLeagueSeedPlan().rounds.reduce(
			(total, round) => total + round.results.length,
			0
		)
	};
}
