/**
 * Idempotent fictional dev seed (HANDOFF §1: fictional data only).
 *
 * Seeds the eight prototype players and then the canonical league: one season
 * (2026, three-frame matches, one table point per frame, no match-win bonus),
 * six rounds with roster snapshots, one fixture per pair per round, the
 * confirmed results implied by the approved prototype, the two administrative
 * awards that produce Jules Rivera's asterisk, and the single planned date the
 * prototype shows as arranged (Leon Park vs Owen Brooks).
 *
 * Safe to re-run: every write is keyed on a natural unique constraint, so the
 * second run converges to exactly the same state. Never runs in production
 * builds of the app itself (explicit script only).
 */
import { getDb, closeDb, type Db } from './db';
import {
	createSeason,
	openRound,
	orderedPair,
	saveLeagueResult,
	createAward,
	closeFixtureNeutrally,
	recordAudit
} from './league';
import { proposeBooking } from './bookings';
import { recordFriendlyResult, scheduleFriendly } from './friendlies';
import { buildLeagueSeedPlan, SEED_PLAYERS, type LeagueSeedPlan, type SeedPlayer } from './seed-data';

const PLAYER_ROLES: Record<string, 'player' | 'admin' | 'super_admin'> = {
	maya: 'super_admin',
	jules: 'admin'
};

export function seedPlayers(db: Db = getDb()): number {
	const upsert = db.prepare(`
		INSERT INTO players (email, display_name, initials, avatar_tone, role, phone, contact_visible)
		VALUES (@email, @display_name, @initials, @avatar_tone, @role, @phone, @contact_visible)
		ON CONFLICT (email) DO UPDATE SET
			display_name = excluded.display_name,
			initials = excluded.initials,
			avatar_tone = excluded.avatar_tone,
			role = excluded.role,
			phone = coalesce(excluded.phone, players.phone),
			contact_visible = coalesce(excluded.contact_visible, players.contact_visible)
	`);
	const tx = db.transaction((rows: SeedPlayer[]) => {
		for (const row of rows) {
			upsert.run({
				email: row.email,
				display_name: row.name,
				initials: row.initials,
				avatar_tone: row.tone,
				role: PLAYER_ROLES[row.key] ?? 'player',
				phone: row.phone ?? null,
				contact_visible: row.contactVisible === false ? 0 : 1
			});
		}
	});
	tx(SEED_PLAYERS);
	return SEED_PLAYERS.length;
}

/** Player ids keyed by their seed key. */
function playerIdsByKey(db: Db): Map<string, number> {
	const rows = db.prepare('SELECT id, email FROM players').all() as Array<{
		id: number;
		email: string;
	}>;
	const byEmail = new Map(rows.map((row) => [row.email.toLowerCase(), row.id]));
	const result = new Map<string, number>();
	for (const player of SEED_PLAYERS) {
		const id = byEmail.get(player.email);
		if (id === undefined) throw new Error(`Player ${player.key} is not seeded.`);
		result.set(player.key, id);
	}
	return result;
}

export interface SeedSummary {
	seasonId: number;
	rounds: number;
	fixtures: number;
	results: number;
	awards: number;
}

/** Seed the canonical league described by `buildLeagueSeedPlan()`. */
export function seedLeague(db: Db = getDb(), plan: LeagueSeedPlan = buildLeagueSeedPlan()): SeedSummary {
	const ids = playerIdsByKey(db);
	const seasonId = createSeason(db, plan.season);

	let fixtures = 0;
	let results = 0;
	let awards = 0;

	for (const round of plan.rounds) {
		const playerIds = round.players.map((key) => {
			const id = ids.get(key);
			if (id === undefined) throw new Error(`Unknown seed player ${key}.`);
			return id;
		});
		const roundId = openRound(db, {
			seasonId,
			number: round.number,
			playerIds,
			deadlineAt: round.deadlineAt,
			graceDays: round.graceDays,
			isFinal: round.isFinal,
			openedAt: round.openedAt
		});
		// Keep the fictional, deterministic history stable when the seed is rerun.
		db.prepare('UPDATE rounds SET opened_at = ? WHERE id = ?').run(round.openedAt, roundId);

		const markWithdrawn = db.prepare(
			'UPDATE round_players SET withdrawn = 1 WHERE round_id = ? AND player_id = ?'
		);
		const addLeagueWithdrawal = db.prepare(
			`INSERT OR IGNORE INTO player_withdrawals (
				player_id, effective_from_season_id, effective_from_round, reason
			) VALUES (?, ?, ?, 'Fictional seeded withdrawal')`
		);
		for (const key of round.withdrawn ?? []) {
			markWithdrawn.run(roundId, ids.get(key)!);
			addLeagueWithdrawal.run(ids.get(key)!, seasonId, round.number + 1);
		}

		const fixtureId = db.prepare(
			`SELECT id FROM fixtures WHERE round_id = ? AND player_low_id = ? AND player_high_id = ?`
		);
		const setClosed = db.prepare(
			`UPDATE fixtures SET state = 'closed_unplayed' WHERE id = ? AND state = 'unplayed'`
		);
		const countFixtures = db.prepare('SELECT COUNT(*) AS n FROM fixtures WHERE round_id = ?');
		fixtures += (countFixtures.get(roundId) as { n: number }).n;

		// Unplayed fixtures: closed neutrally in finished rounds, still open in
		// the current round. Never a played 0–0, never an outstanding entry again.
		for (const [a, b] of round.unplayed) {
			const [low, high] = orderedPair(ids.get(a)!, ids.get(b)!);
			const row = fixtureId.get(roundId, low, high) as { id: number } | undefined;
			if (!row) throw new Error(`Missing fixture for ${a}/${b} in round ${round.number}.`);
			if (round.status === 'closed') setClosed.run(row.id);
		}

		// Confirmed results. These are approved league results, so they are the
		// only thing that moves the table.
		for (const result of round.results) {
			const [dbLow, dbHigh] = orderedPair(ids.get(result.low)!, ids.get(result.high)!);
			const row = fixtureId.get(roundId, dbLow, dbHigh) as { id: number } | undefined;
			if (!row) throw new Error(`Missing fixture for ${result.low}/${result.high} in round ${round.number}.`);
			// Frame counts and frame points are stored relative to the fixture's
			// player_low_id, so flip them if the plan's ordering disagrees with the
			// database's id ordering.
			const lowIsPlanLow = dbLow === ids.get(result.low)!;
			saveLeagueResult(db, {
				fixtureId: row.id,
				submittedByPlayerId: ids.get(result.low)!,
				lowFrames: lowIsPlanLow ? result.lowFrames : result.highFrames,
				highFrames: lowIsPlanLow ? result.highFrames : result.lowFrames,
				actualPlayedDate: result.playedDate,
				// Seeded results are already approved: an unconfirmed submission
				// must never appear to move the standings.
				entrySource: 'admin_direct',
				// Re-running the seed converges to the same rows instead of failing.
				allowOverwrite: true,
				frames: result.frames?.map((frame) => ({
					frameNumber: frame.frameNumber,
					lowPoints: lowIsPlanLow ? frame.lowPoints : frame.highPoints,
					highPoints: lowIsPlanLow ? frame.highPoints : frame.lowPoints
				})),
				breaks: result.breaks?.map((entry) => ({
					playerId: ids.get(entry.player)!,
					breakPoints: entry.breakPoints
				}))
			}, { now: new Date(`${result.playedDate}T12:00:00.000Z`) });
			results++;
		}

		// Administrative awards: table points only.
		for (const award of plan.rounds[round.number - 1].awards) {
			const [low, high] = orderedPair(ids.get(award.low)!, ids.get(award.high)!);
			const row = fixtureId.get(roundId, low, high) as { id: number } | undefined;
			if (!row) throw new Error(`Missing fixture for award ${award.low}/${award.high}.`);
			let sourceResultId: number | null = null;
			if (award.sourceResult) {
				const [sLow, sHigh] = orderedPair(
					ids.get(award.sourceResult.low)!,
					ids.get(award.sourceResult.high)!
				);
				const sourceRound = db
					.prepare(
						`SELECT f.id AS fixture_id FROM fixtures f
						 JOIN rounds ro ON ro.id = f.round_id
						 WHERE ro.season_id = ? AND ro.number = ?
						   AND f.player_low_id = ? AND f.player_high_id = ?`
					)
					.get(seasonId, award.sourceResult.round, sLow, sHigh) as
					| { fixture_id: number }
					| undefined;
				const sourceResult = sourceRound
					? (db
							.prepare('SELECT id FROM results WHERE fixture_id = ?')
							.get(sourceRound.fixture_id) as { id: number } | undefined)
					: undefined;
				sourceResultId = sourceResult?.id ?? null;
				if (sourceResultId === null) {
					throw new Error(
						`Award source result missing for ${award.sourceResult.low}/${award.sourceResult.high} in round ${award.sourceResult.round}.`
					);
				}
			}
			createAward(db, {
				fixtureId: row.id,
				playerId: ids.get(award.recipient)!,
				tablePoints: award.tablePoints,
				sourceType: award.sourceType,
				sourceResultId,
				createdByPlayerId: ids.get('maya')!,
				reason: award.reason
			});
			awards++;
		}

		// Planned dates: seeded through the same write path the app uses, so the
		// row, the fixture mirror and the audit entry always agree. Re-running the
		// seed is idempotent: an identical active proposal is left untouched.
		for (const booking of round.bookings ?? []) {
			const [low, high] = orderedPair(ids.get(booking.low)!, ids.get(booking.high)!);
			const row = fixtureId.get(roundId, low, high) as { id: number } | undefined;
			if (!row) throw new Error(`Missing fixture for planned date ${booking.low}/${booking.high}.`);
			const proposerId = ids.get(booking.proposedBy)!;
			const active = db
				.prepare(
					"SELECT proposed_date, proposed_time, proposed_by_player_id FROM bookings WHERE fixture_id = ? AND status = 'proposed'"
				)
				.get(row.id) as
				| { proposed_date: string; proposed_time: string | null; proposed_by_player_id: number }
				| undefined;
			if (
				active &&
				active.proposed_date === booking.date &&
				active.proposed_time === booking.time &&
				active.proposed_by_player_id === proposerId
			) {
				continue;
			}
			proposeBooking(
				db,
				{
					fixtureId: row.id,
					actorPlayerId: proposerId,
					date: booking.date,
					time: booking.time,
					note: booking.note ?? null
				},
				{ now: new Date(round.openedAt) }
			);
		}

		if (round.status === 'closed') {
			db.prepare(`UPDATE rounds SET status = 'closed', closed_at = ? WHERE id = ?`).run(
				new Date().toISOString(),
				roundId
			);
		}
		recordAudit(db, {
			entityType: 'round',
			entityId: roundId,
			action: round.status === 'closed' ? 'seeded_closed' : 'seeded_open',
			actorPlayerId: ids.get('maya')!,
			detail: { round: round.number, players: round.players.length }
		});
	}

	return { seasonId, rounds: plan.rounds.length, fixtures, results, awards };
}

/**
 * Seed a few fictional friendlies (Phase 10): one upcoming scheduled plan, one
 * played friendly with full optional detail, and one simple draw. Idempotent:
 * each entry is skipped when its natural key already exists. Seeded through
 * the same write paths the app uses, with a fixed clock so re-running the
 * seed never trips the past-date guards.
 */
export function seedFriendlies(db: Db = getDb(), now = new Date('2026-09-29T12:00:00.000Z')): number {
	const ids = playerIdsByKey(db);
	const pairId = (a: string, b: string): [number, number] => orderedPair(ids.get(a)!, ids.get(b)!);
	let seeded = 0;

	const scheduledPair = pairId('leon', 'priya');
	const scheduledExists = db
		.prepare(
			`SELECT f.id FROM friendlies f
			 WHERE f.player_low_id = ? AND f.player_high_id = ? AND f.scheduled_date = ?
			   AND NOT EXISTS (SELECT 1 FROM friendly_results r WHERE r.friendly_id = f.id)`
		)
		.get(scheduledPair[0], scheduledPair[1], '2026-10-04');
	if (!scheduledExists) {
		scheduleFriendly(
			db,
			{
				actorPlayerId: ids.get('leon')!,
				playerAId: ids.get('leon')!,
				playerBId: ids.get('priya')!,
				date: '2026-10-04',
				time: '15:00',
				note: 'Sunday knockabout'
			},
			{ now }
		);
		seeded += 1;
	}

	const detailed: Array<{
		low: string;
		high: string;
		playedDate: string;
		lowFrames: number;
		highFrames: number;
		frames?: Array<{ frameNumber: number; lowPoints: number; highPoints: number }>;
		breakLow?: string;
		breakHigh?: string;
		submittedBy: string;
	}> = [
		{
			low: 'jules',
			high: 'owen',
			playedDate: '2026-09-20',
			lowFrames: 3,
			highFrames: 2,
			frames: [
				{ frameNumber: 1, lowPoints: 68, highPoints: 42 },
				{ frameNumber: 2, lowPoints: 55, highPoints: 61 },
				{ frameNumber: 3, lowPoints: 74, highPoints: 30 },
				{ frameNumber: 4, lowPoints: 28, highPoints: 63 },
				{ frameNumber: 5, lowPoints: 59, highPoints: 47 }
			],
			breakLow: '52',
			breakHigh: '44',
			submittedBy: 'jules'
		},
		{ low: 'maya', high: 'noah', playedDate: '2026-09-14', lowFrames: 2, highFrames: 2, submittedBy: 'maya' }
	];
	for (const entry of detailed) {
		const [dbLow, dbHigh] = pairId(entry.low, entry.high);
		const playedExists = db
			.prepare(
				`SELECT f.id FROM friendlies f
				 JOIN friendly_results r ON r.friendly_id = f.id
				 WHERE f.player_low_id = ? AND f.player_high_id = ? AND r.actual_played_date = ?`
			)
			.get(dbLow, dbHigh, entry.playedDate);
		if (playedExists) continue;
		// Frame counts and point detail are stored relative to the friendly's
		// player_low_id, so flip them when the plan ordering disagrees with id
		// ordering (same convention as the league seed).
		const lowIsPlanLow = dbLow === ids.get(entry.low)!;
		const frames = entry.frames?.map((frame) => ({
			low: String(lowIsPlanLow ? frame.lowPoints : frame.highPoints),
			high: String(lowIsPlanLow ? frame.highPoints : frame.lowPoints)
		}));
		recordFriendlyResult(
			db,
			{
				actorPlayerId: ids.get(entry.submittedBy)!,
				playerAId: ids.get(entry.low)!,
				playerBId: ids.get(entry.high)!,
				values: {
					actualPlayedDate: entry.playedDate,
					lowFrames: String(lowIsPlanLow ? entry.lowFrames : entry.highFrames),
					highFrames: String(lowIsPlanLow ? entry.highFrames : entry.lowFrames),
					framePoints: frames ?? [],
					breaks: {
						low: lowIsPlanLow ? (entry.breakLow ?? '') : (entry.breakHigh ?? ''),
						high: lowIsPlanLow ? (entry.breakHigh ?? '') : (entry.breakLow ?? '')
					}
				}
			},
			{ now }
		);
		seeded += 1;
	}
	return seeded;
}

export function seedAll(db: Db = getDb()): { players: number; league: SeedSummary; friendlies: number } {
	const players = seedPlayers(db);
	const league = seedLeague(db);
	const friendlies = seedFriendlies(db);
	return { players, league, friendlies };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const db = getDb();
	const { players, league, friendlies } = seedAll(db);
	console.log(
		`Seeded ${players} fictional players; season ${league.seasonId}: ` +
			`${league.rounds} rounds, ${league.fixtures} fixtures, ${league.results} results, ${league.awards} awards, ` +
			`${friendlies} friendlies.`
	);
	closeDb();
}
