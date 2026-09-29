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
import {
	createKnockoutCompetition,
	drawKnockoutOpeningStage,
	finaliseKnockoutEntry,
	respondToKnockoutInvitation
} from './knockout';
import {
	drawKnockoutNextStage,
	nudgeKnockoutOpponent,
	proposeKnockoutArrangement,
	recordKnockoutDropout,
	recordKnockoutResult
} from './knockout-progression';
import { deadlineAfterLocalDays } from './league-time';
import {
	leagueChannel,
	markChannelRead,
	markThreadRead,
	openDirectThread,
	postChannelMessage,
	postDirectMessage,
	reportMessage
} from './chat';
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

/**
 * Two fictional Phase 12 progression checkpoints, seeded through the same
 * write paths the app uses (so rows and the audit trail always agree):
 *
 *   * **Winter Plate · Played to the Final** — six players, first to 2, with
 *     the opening round and semi-finals played and the final drawn, arranged
 *     and nudged. Switch to a finalist to record it and watch the competition
 *     complete with a champion.
 *   * **Charity Cup · Stage Two Ready** — seven players, first to 3. The
 *     bye-holder dropped out before playing (the bye is voided and nothing
 *     was invented), the play-in round is resolved, and the final is waiting
 *     for an admin to draw it fresh from the two survivors.
 *
 * Both are idempotent by title and kept separate from league data. Draws use
 * a seeded range source so the fictional story is stable, while every write
 * still goes through the server's own validation.
 */
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function seededRange(seed: number): (maxExclusive: number) => number {
	let state = seed >>> 0;
	return (maxExclusive) => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state % maxExclusive;
	};
}

function calendarDaysFromNow(now: Date, days: number): string {
	return new Date(now.getTime() + days * DAY).toISOString().slice(0, 10);
}

interface SeededTieRow {
	id: number;
	player_low_id: number;
	player_high_id: number;
}

function stageTies(db: Db, stageId: number): SeededTieRow[] {
	return db
		.prepare(
			`SELECT id, player_low_id, player_high_id FROM knockout_ties
			 WHERE stage_id = ? AND tie_type = 'match' ORDER BY tie_number`
		)
		.all(stageId) as SeededTieRow[];
}

/** Record one played tie: `plan` names the frame winners (0 = low id, 1 = high id). */
function playSeededTie(
	db: Db,
	tie: SeededTieRow,
	plan: Array<0 | 1>,
	playedDaysAgo: number,
	now: Date
): void {
	const frames = plan.map((winner, index) => ({
		frameNumber: index + 1,
		winnerPlayerId: winner === 0 ? tie.player_low_id : tie.player_high_id
	}));
	const lowFrames = plan.filter((frame) => frame === 0).length;
	const winnerPlayerId = lowFrames > plan.length - lowFrames ? tie.player_low_id : tie.player_high_id;
	const playedAt = new Date(now.getTime() - playedDaysAgo * DAY);
	recordKnockoutResult(
		db,
		{
			tieId: tie.id,
			actorPlayerId: winnerPlayerId,
			frames,
			actualPlayedDate: playedAt.toISOString().slice(0, 10)
		},
		{ now: playedAt, today: playedAt.toISOString().slice(0, 10) }
	);
}

export function seedKnockoutProgressionPreviews(db: Db, now = new Date()): number {
	const ids = playerIdsByKey(db);
	const adminId = ids.get('maya')!;
	let seeded = 0;

	const winterTitle = 'Winter Plate · Played to the Final';
	if (!db.prepare('SELECT 1 FROM knockout_competitions WHERE title = ?').get(winterTitle)) {
		const rng = seededRange(4021);
		const createdAt = new Date(now.getTime() - 14 * DAY);
		const replyDeadline = new Date(now.getTime() - 8 * DAY);
		const competitionId = createKnockoutCompetition(
			db,
			{
				actorPlayerId: adminId,
				title: winterTitle,
				announcement:
					'Fictional preview: the opening round and semis are played. Switch to a finalist, record the final, and crown a champion.',
				replyDeadlineAt: replyDeadline.toISOString(),
				framesToWin: 2
			},
			{ now: createdAt }
		);
		for (const key of ['maya', 'jules', 'leon', 'priya', 'owen', 'noah']) {
			respondToKnockoutInvitation(
				db,
				{ competitionId, actorPlayerId: ids.get(key)!, optedIn: true },
				{ now: new Date(replyDeadline.getTime() - 2 * HOUR) }
			);
		}
		finaliseKnockoutEntry(
			db,
			{ competitionId, actorPlayerId: adminId },
			{ now: new Date(replyDeadline.getTime() + 2 * 60 * 1000), randomInt: rng }
		);
		const opening = drawKnockoutOpeningStage(
			db,
			{ competitionId, actorPlayerId: adminId },
			{ now: new Date(replyDeadline.getTime() + 4 * 60 * 1000), randomInt: rng }
		);
		const openingTies = stageTies(db, opening.stageId);
		const openingPlans: Array<Array<0 | 1>> = [[0, 0], [0, 1, 0], [1, 0, 1], [0, 1, 0]];
		openingTies.forEach((tie, index) => {
			playSeededTie(db, tie, openingPlans[index % openingPlans.length], 7.8 - index * 0.2, now);
		});
		const semis = drawKnockoutNextStage(
			db,
			{ competitionId, actorPlayerId: adminId },
			{ now: new Date(now.getTime() - 5 * DAY), randomInt: rng }
		);
		const semiTies = stageTies(db, semis.stageId);
		const semiPlans: Array<Array<0 | 1>> = [[0, 1, 0], [1, 0, 1]];
		semiTies.forEach((tie, index) => {
			playSeededTie(db, tie, semiPlans[index % semiPlans.length], 4.6 - index * 0.2, now);
		});
		const finalStage = drawKnockoutNextStage(
			db,
			{ competitionId, actorPlayerId: adminId },
			{ now: new Date(now.getTime() - 3 * DAY), randomInt: rng }
		);
		const finalTie = stageTies(db, finalStage.stageId)[0];
		proposeKnockoutArrangement(
			db,
			{
				tieId: finalTie.id,
				actorPlayerId: finalTie.player_low_id,
				date: calendarDaysFromNow(now, 3),
				time: '19:00',
				note: 'Table booked at the club — the big one.'
			},
			{ now }
		);
		nudgeKnockoutOpponent(
			db,
			{ tieId: finalTie.id, actorPlayerId: finalTie.player_high_id },
			{ now: new Date(now.getTime() - 2 * DAY) }
		);
		seeded += 1;
	}

	const charityTitle = 'Charity Cup · Stage Two Ready';
	if (!db.prepare('SELECT 1 FROM knockout_competitions WHERE title = ?').get(charityTitle)) {
		const rng = seededRange(7702);
		const createdAt = new Date(now.getTime() - 11 * DAY);
		const replyDeadline = new Date(now.getTime() - 5 * DAY);
		const competitionId = createKnockoutCompetition(
			db,
			{
				actorPlayerId: adminId,
				title: charityTitle,
				announcement:
					'Fictional preview: seven entered, one bye-holder withdrew (her bye was voided), and the play-in round is done. Draw the final.',
				replyDeadlineAt: replyDeadline.toISOString(),
				framesToWin: 3
			},
			{ now: createdAt }
		);
		for (const key of ['maya', 'jules', 'leon', 'sam', 'priya', 'owen', 'ella']) {
			respondToKnockoutInvitation(
				db,
				{ competitionId, actorPlayerId: ids.get(key)!, optedIn: true },
				{ now: new Date(replyDeadline.getTime() - 3 * HOUR) }
			);
		}
		finaliseKnockoutEntry(
			db,
			{ competitionId, actorPlayerId: adminId },
			{ now: new Date(replyDeadline.getTime() + 2 * 60 * 1000), randomInt: rng }
		);
		const opening = drawKnockoutOpeningStage(
			db,
			{ competitionId, actorPlayerId: adminId },
			{ now: new Date(replyDeadline.getTime() + 5 * 60 * 1000), randomInt: rng }
		);
		const byeHolder = (
			db
				.prepare(
					`SELECT bye_player_id FROM knockout_ties WHERE stage_id = ? AND tie_type = 'bye' LIMIT 1`
				)
				.get(opening.stageId) as { bye_player_id: number }
		).bye_player_id;
		recordKnockoutDropout(
			db,
			{
				competitionId,
				playerId: byeHolder,
				actorPlayerId: adminId,
				reason: 'Fictional preview: pulled out before playing a tie.'
			},
			{ now: new Date(now.getTime() - 4 * DAY - 12 * HOUR) }
		);
		const openingTies = stageTies(db, opening.stageId);
		const openingPlans: Array<Array<0 | 1>> = [[0, 0, 0], [1, 0, 1, 0, 1], [0, 1, 1, 0, 0]];
		openingTies.forEach((tie, index) => {
			playSeededTie(db, tie, openingPlans[index % openingPlans.length], 4.4 - index * 0.2, now);
		});
		const stageTwo = drawKnockoutNextStage(
			db,
			{ competitionId, actorPlayerId: adminId },
			{ now: new Date(now.getTime() - 3 * DAY), randomInt: rng }
		);
		const stageTwoTies = stageTies(db, stageTwo.stageId);
		playSeededTie(db, stageTwoTies[0], [0, 1, 0, 0], 2, now);
		seeded += 1;
	}
	return seeded;
}

/**
 * Two fictional knockout checkpoints: one open invitation for player opt-in,
 * and one past-deadline six-player practice entry ready for admin selection
 * and the first draw. Idempotent by title and kept separate from league data.
 */
export function seedKnockoutPreviews(db: Db = getDb(), now = new Date()): number {
	const ids = playerIdsByKey(db);
	const timezone = (db.prepare('SELECT timezone FROM seasons ORDER BY id DESC LIMIT 1').get() as
		| { timezone: string }
		| undefined)?.timezone ?? 'Europe/London';
	let seeded = 0;

	const upcomingTitle = 'Autumn Knockout · Preview';
	if (!db.prepare('SELECT 1 FROM knockout_competitions WHERE title = ?').get(upcomingTitle)) {
		createKnockoutCompetition(
			db,
			{
				actorPlayerId: ids.get('maya')!,
				title: upcomingTitle,
				announcement: 'Fictional preview invitation. Switch to a player and opt in before the saved deadline.',
				replyDeadlineAt: deadlineAfterLocalDays(now, 7, timezone),
				framesToWin: 3
			},
			{ now }
		);
		seeded += 1;
	}

	const practiceTitle = 'Practice Draw · Ready to Close';
	if (!db.prepare('SELECT 1 FROM knockout_competitions WHERE title = ?').get(practiceTitle)) {
		const day = 24 * 60 * 60 * 1000;
		const createdAt = new Date(now.getTime() - 3 * day);
		const replyDeadline = new Date(now.getTime() - day);
		const competitionId = createKnockoutCompetition(
			db,
			{
				actorPlayerId: ids.get('maya')!,
				title: practiceTitle,
				announcement: 'Six fictional players opted in before this demo deadline. Close entry to see the six-player byes.',
				replyDeadlineAt: replyDeadline.toISOString(),
				framesToWin: 2
			},
			{ now: createdAt }
		);
		const repliedAt = new Date(replyDeadline.getTime() - 60 * 60 * 1000);
		for (const key of ['maya', 'jules', 'leon', 'sam', 'priya', 'owen']) {
			respondToKnockoutInvitation(
				db,
				{ competitionId, actorPlayerId: ids.get(key)!, optedIn: true },
				{ now: repliedAt }
			);
		}
		seeded += 1;
	}
	return seeded;
}

/**
 * Fictional chat preview (Phase 13): a short league-channel conversation, two
 * DM threads, and one open report so the admin queue has something to review.
 *
 * Written through the same write paths the app uses, so the rows, the read
 * cursors and the audit entry always agree. Idempotent: once any message
 * exists, the seed leaves chat alone — a player's own conversation is never
 * duplicated by re-running the seed.
 */
export function seedChat(db: Db = getDb(), now = new Date()): number {
	const existing = db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get() as { n: number };
	if (existing.n > 0) return 0;
	const ids = playerIdsByKey(db);
	const channel = leagueChannel(db);
	if (!channel) return 0;

	const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
	const day = 24 * 60;
	let count = 0;

	const channelMessages: Array<{ key: string; minutes: number; body: string }> = [
		{
			key: 'priya',
			minutes: day + 300,
			body: "Morning all — that table at the top is looking tight 👀"
		},
		{
			key: 'leon',
			minutes: day + 240,
			body:
				'Round 6 deadline is in the app. I have the club table booked on Saturday if anyone wants a ' +
				'knock-up before their match.'
		},
		{
			key: 'maya',
			minutes: day + 60,
			body: 'Reminder: record a result as soon as you play. It only counts once your opponent confirms it.'
		},
		{
			key: 'noah',
			minutes: 130,
			body: 'Squeaked past Ella 2–1 last night. That third frame went on forever.'
		},
		{
			key: 'sam',
			minutes: 45,
			body: 'Nice one Noah. Anyone free Tuesday evening? I still owe Maya a match.'
		}
	];
	let lastChannelMessageId = 0;
	for (const message of channelMessages) {
		const posted = postChannelMessage(
			db,
			{ actorPlayerId: ids.get(message.key)!, body: message.body },
			{ now: minutesAgo(message.minutes) }
		);
		lastChannelMessageId = posted.messageId;
		count += 1;
	}

	// Maya (the default preview identity) has read the channel, so the nav badge
	// in the preview comes from Leon's unread reply below instead.
	markChannelRead(db, ids.get('maya')!, channel.id, lastChannelMessageId, { now });

	const mayaLeon = openDirectThread(
		db,
		{ actorPlayerId: ids.get('leon')!, otherPlayerId: ids.get('maya')! },
		{ now: minutesAgo(day + 30) }
	).threadId;
	const mayaLeonMessages: Array<{ key: string; minutes: number; body: string }> = [
		{ key: 'leon', minutes: day + 25, body: 'Hi Maya — free on Saturday for our Round 6 match?' },
		{ key: 'maya', minutes: day + 20, body: 'Saturday works. 4pm at the club?' },
		{ key: 'maya', minutes: day + 12, body: 'Bringing the good chalk 😄' },
		// Unread for Maya (the default preview identity), so the nav badge shows 1.
		{ key: 'leon', minutes: 20, body: 'Perfect, see you then.' }
	];
	let mayaLastRead = 0;
	for (const message of mayaLeonMessages) {
		const posted = postDirectMessage(
			db,
			{ actorPlayerId: ids.get(message.key)!, threadId: mayaLeon, body: message.body },
			{ now: minutesAgo(message.minutes) }
		);
		if (message.key === 'maya') mayaLastRead = posted.messageId;
		count += 1;
	}
	// Maya has read up to her own last message; Leon's reply stays unread.
	markThreadRead(db, ids.get('maya')!, mayaLeon, mayaLastRead, { now });

	const samPriya = openDirectThread(
		db,
		{ actorPlayerId: ids.get('sam')!, otherPlayerId: ids.get('priya')! },
		{ now: minutesAgo(day - 30) }
	).threadId;
	const samPriyaMessages: Array<{ key: string; minutes: number; body: string }> = [
		{ key: 'priya', minutes: day - 32, body: 'Great frames on Tuesday — happy to play again whenever.' },
		{ key: 'sam', minutes: day - 40, body: 'Thanks! Same again next week?' }
	];
	for (const message of samPriyaMessages) {
		postDirectMessage(
			db,
			{ actorPlayerId: ids.get(message.key)!, threadId: samPriya, body: message.body },
			{ now: minutesAgo(message.minutes) }
		);
		count += 1;
	}

	// One open report so /admin/chat has a queue: Owen flags Sam's channel
	// message as a fictional demo (the text itself is perfectly friendly).
	const samMessage = db
		.prepare(
			`SELECT m.id FROM chat_messages m WHERE m.channel_id = ? AND m.author_player_id = ?
			  ORDER BY m.id DESC LIMIT 1`
		)
		.get(channel.id, ids.get('sam')!) as { id: number };
	reportMessage(
		db,
		{
			actorPlayerId: ids.get('owen')!,
			messageId: samMessage.id,
			reason: 'Fictional preview: checking the report queue (nothing wrong with this message).'
		},
		{ now: minutesAgo(20) }
	);

	return count;
}

export function seedAll(db: Db = getDb()): {
	players: number;
	league: SeedSummary;
	friendlies: number;
	knockoutInvitations: number;
	chatMessages: number;
} {
	const players = seedPlayers(db);
	const league = seedLeague(db);
	const friendlies = seedFriendlies(db);
	const knockoutInvitations = seedKnockoutPreviews(db) + seedKnockoutProgressionPreviews(db);
	const chatMessages = seedChat(db);
	return { players, league, friendlies, knockoutInvitations, chatMessages };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const db = getDb();
	const { players, league, friendlies, knockoutInvitations, chatMessages } = seedAll(db);
	console.log(
		`Seeded ${players} fictional players; season ${league.seasonId}: ` +
			`${league.rounds} rounds, ${league.fixtures} fixtures, ${league.results} results, ${league.awards} awards, ` +
			`${friendlies} friendlies, ${knockoutInvitations} knockout demo invitations, ` +
			`${chatMessages} chat messages (plus two demo conversations and one open report).`
	);
	closeDb();
}
