/**
 * League domain write paths (Phases 2, 4 and 6).
 *
 * Everything here is server-side. Nothing on this page is ever driven from the
 * client: opening a round snapshots state, fixtures are created atomically for
 * every pair, and results/awards are validated before they touch the database.
 *
 * This module holds the transactional primitives. `results.ts` (Phase 6) is the
 * permission-checked result state machine built on top of them: submission,
 * opponent review, send-back, resubmission and audited admin corrections. The
 * validation rules themselves live in `$lib/result-entry` so the browser can
 * run exactly the same checks while a player fills the form in.
 */
import type { Db } from './db';
import { gracePeriodEndsAt, isPlayedDateWithinRoundWindow, localDateString } from './league-time';
// Relative import (not `$lib/...`): vitest runs without the SvelteKit plugin, so
// only type-only `$lib` imports survive erasure in tests. Server modules import
// their siblings relatively for that reason.
import { validateLeagueResult } from '../result-entry';
import type { BreakDetail, FrameDetail, ValidationResult } from '../result-entry';

export { validateLeagueResult };
export type { BreakDetail, FrameDetail, ValidationResult };

/** One frame of the submitted frame-by-frame winner record. */
export interface FrameWinner {
	frameNumber: number;
	playerId: number;
}

export type FixtureState =
	| 'unplayed'
	| 'awaiting_confirmation'
	| 'confirmed'
	| 'closed_unplayed'
	| 'awarded';

export type ResultStatus = 'submitted' | 'confirmed' | 'sent_back';
export type EntrySource = 'player' | 'admin_direct' | 'admin_retrospective';
export type AwardSource = 'previous_round_result' | 'random_draw' | 'manual';

export interface SeasonConfig {
	label: string;
	framesPerMatch: number;
	pointsPerFrame: number;
	matchWinBonus: number;
	timezone?: string;
}

export function createSeason(db: Db, config: SeasonConfig): number {
	if (!Number.isInteger(config.framesPerMatch) || config.framesPerMatch <= 0) {
		throw new Error('framesPerMatch must be a positive whole number of frames.');
	}
	if (!Number.isInteger(config.pointsPerFrame) || config.pointsPerFrame < 0) {
		throw new Error('pointsPerFrame must be a non-negative whole number.');
	}
	if (!Number.isInteger(config.matchWinBonus) || config.matchWinBonus < 0) {
		throw new Error('matchWinBonus must be a non-negative whole number.');
	}
	db.prepare(
		`INSERT INTO seasons (label, frames_per_match, points_per_frame, match_win_bonus, timezone)
		 VALUES (@label, @framesPerMatch, @pointsPerFrame, @matchWinBonus, @timezone)
		 ON CONFLICT (label) DO UPDATE SET
			frames_per_match = excluded.frames_per_match,
			points_per_frame = excluded.points_per_frame,
			match_win_bonus = excluded.match_win_bonus,
			timezone = excluded.timezone`
	).run({
		label: config.label,
		framesPerMatch: config.framesPerMatch,
		pointsPerFrame: config.pointsPerFrame,
		matchWinBonus: config.matchWinBonus,
		timezone: config.timezone ?? 'Europe/London'
	});
	// Resolve by natural key: lastInsertRowid is not reliable after an upsert
	// that took the UPDATE branch.
	return (
		db.prepare('SELECT id FROM seasons WHERE label = ?').get(config.label) as { id: number }
	).id;
}

export interface OpenRoundInput {
	seasonId: number;
	number: number;
	playerIds: number[];
	deadlineAt?: string | null;
	graceDays?: number;
	isFinal?: boolean;
	openedAt?: string;
}

/**
 * Open a round in one transaction:
 *   1. insert the round,
 *   2. snapshot its roster,
 *   3. create one fixture for every opponent pair.
 *
 * Later membership or settings changes cannot alter an opened round because the
 * roster and the pairings are already rows of their own.
 */
export function openRound(db: Db, input: OpenRoundInput): number {
	if (!Number.isInteger(input.number) || input.number < 1) {
		throw new Error('Round number must be a positive whole number.');
	}
	if (!Number.isInteger(input.graceDays ?? 0) || (input.graceDays ?? 0) < 0) {
		throw new Error('Grace days must be a non-negative whole number.');
	}
	const unique = [...new Set(input.playerIds)];
	if (unique.length < 2) throw new Error('A round needs at least two players.');

	return db.transaction(() => {
		const existing = db
			.prepare('SELECT id, deadline_at, grace_days FROM rounds WHERE season_id = ? AND number = ?')
			.get(input.seasonId, input.number) as
			| { id: number; deadline_at: string | null; grace_days: number }
			| undefined;
		if (existing) {
			const savedRoster = (db
				.prepare('SELECT player_id FROM round_players WHERE round_id = ? ORDER BY player_id')
				.all(existing.id) as Array<{ player_id: number }>).map((row) => row.player_id);
			const requestedRoster = [...unique].sort((a, b) => a - b);
			const sameRoster =
				savedRoster.length === requestedRoster.length &&
				savedRoster.every((playerId, index) => playerId === requestedRoster[index]);
			if (
				!sameRoster ||
				existing.deadline_at !== (input.deadlineAt ?? null) ||
				existing.grace_days !== (input.graceDays ?? 0)
			) {
				throw new Error('An existing round snapshot cannot be changed or reopened.');
			}
			return existing.id;
		}

		const active = db
			.prepare("SELECT number, season_id FROM rounds WHERE status = 'open'")
			.get() as { number: number; season_id: number } | undefined;
		if (active) throw new Error(`Round ${active.number} is still open for scheduling.`);
		const last = db
			.prepare('SELECT MAX(number) AS number FROM rounds WHERE season_id = ?')
			.get(input.seasonId) as { number: number | null };
		const expectedNumber = (last.number ?? 0) + 1;
		if (input.number !== expectedNumber) {
			throw new Error(`The next round in this season must be Round ${expectedNumber}.`);
		}

		const roundInfo = db
			.prepare(
				`INSERT INTO rounds (
					season_id, number, status, is_final, deadline_at, grace_days, opened_at
				) VALUES (?, ?, 'open', ?, ?, ?, ?)`
			)
			.run(
				input.seasonId,
				input.number,
				input.isFinal ? 1 : 0,
				input.deadlineAt ?? null,
				input.graceDays ?? 0,
				input.openedAt ?? new Date().toISOString()
			);
		const roundId = Number(roundInfo.lastInsertRowid);
		const addPlayer = db.prepare(
			'INSERT INTO round_players (round_id, player_id, withdrawn) VALUES (?, ?, 0)'
		);
		for (const playerId of unique) addPlayer.run(roundId, playerId);

		const ordered = [...unique].sort((a, b) => a - b);
		const addFixture = db.prepare(
			`INSERT INTO fixtures (round_id, player_low_id, player_high_id, state)
			 VALUES (?, ?, ?, 'unplayed')`
		);
		for (let i = 0; i < ordered.length; i++) {
			for (let j = i + 1; j < ordered.length; j++) {
				addFixture.run(roundId, ordered[i], ordered[j]);
			}
		}
		// The roster has been snapshotted; do not alert players outside it.
		db.prepare(`INSERT INTO notifications (player_id,kind,title,href)
			SELECT player_id,'round_opened','New league round is open','/fixtures'
			FROM round_players WHERE round_id = ?`).run(roundId);
		return roundId;
	})();
}

/** Canonical pair ordering used by the fixtures table. */
export function orderedPair(a: number, b: number): [number, number] {
	return a < b ? [a, b] : [b, a];
}

export interface LeagueResultInput {
	fixtureId: number;
	submittedByPlayerId: number;
	lowFrames: number;
	highFrames: number;
	actualPlayedDate: string;
	entrySource?: EntrySource;
	frames?: FrameDetail[];
	breaks?: BreakDetail[];
	/**
	 * Permit overwriting an existing confirmed result. Off by default: an
	 * ordinary submission must never silently replace an approved result.
	 * Only the idempotent dev seed and (Phase 6) audited super-admin
	 * retrospective corrections set this.
	 */
	allowOverwrite?: boolean;
}


export interface ResultRowWrite {
	fixtureId: number;
	lowFrames: number;
	highFrames: number;
	actualPlayedDate: string;
	status: ResultStatus;
	entrySource: EntrySource;
	submittedByPlayerId: number;
	submittedAt: string;
	confirmedByPlayerId?: number | null;
	confirmedAt?: string | null;
	correctedByPlayerId?: number | null;
	correctedAt?: string | null;
	correctionReason?: string | null;
	sentBackByPlayerId?: number | null;
	sentBackAt?: string | null;
	sendBackReason?: string | null;
	/** Omit to keep the stored revision (a brand-new row starts at 1). */
	revision?: number;
	/** Omit to keep the stored lock; a brand-new row locks at first submission. */
	detailsLockedAt?: string | null;
	frames?: FrameDetail[];
	breaks?: BreakDetail[];
	/**
	 * The frame-by-frame winners the submitter entered. `undefined` keeps
	 * whatever is stored (older results and the aggregated seed have none);
	 * an empty array clears them.
	 */
	frameWinners?: FrameWinner[];
}

/** The fixture state that matches a result status: one mapping, used everywhere. */
export function fixtureStateForResultStatus(status: ResultStatus): FixtureState {
	if (status === 'confirmed') return 'confirmed';
	if (status === 'submitted') return 'awaiting_confirmation';
	// A sent-back result leaves the fixture outstanding again: the submitter has to
	// correct it, and an unconfirmed result never masquerades as a played result.
	return 'unplayed';
}

interface ResultRowSnapshot {
	revision: number;
	details_locked_at: string | null;
	confirmed_by_player_id: number | null;
	confirmed_at: string | null;
	corrected_by_player_id: number | null;
	corrected_at: string | null;
	correction_reason: string | null;
	sent_back_by_player_id: number | null;
	sent_back_at: string | null;
	send_back_reason: string | null;
}

/**
 * The single physical write path for a result row: the `results` row, its
 * optional frame-point detail and highest breaks, and the fixture state that
 * matches the result status. Callers own the guards, the permissions and the
 * audit entries; this function only makes the row and its children agree.
 *
 * A field left `undefined` keeps its stored value, so an admin correction can
 * change the scoreline without erasing who confirmed the original submission.
 */
export function writeResultRow(db: Db, write: ResultRowWrite): number {
	const existing = db
		.prepare(
			`SELECT revision, details_locked_at, confirmed_by_player_id, confirmed_at,
				corrected_by_player_id, corrected_at, correction_reason,
				sent_back_by_player_id, sent_back_at, send_back_reason
			 FROM results WHERE fixture_id = ?`
		)
		.get(write.fixtureId) as ResultRowSnapshot | undefined;

	const revision = write.revision ?? existing?.revision ?? 1;
	const detailsLockedAt =
		write.detailsLockedAt === undefined
			? (existing?.details_locked_at ?? write.submittedAt)
			: write.detailsLockedAt;

	db.prepare(
		`INSERT INTO results (
			fixture_id, player_low_frames, player_high_frames, actual_played_date,
			status, entry_source, submitted_by_player_id, submitted_at,
			confirmed_by_player_id, confirmed_at,
			corrected_by_player_id, corrected_at, correction_reason,
			sent_back_by_player_id, sent_back_at, send_back_reason,
			revision, details_locked_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (fixture_id) DO UPDATE SET
			player_low_frames = excluded.player_low_frames,
			player_high_frames = excluded.player_high_frames,
			actual_played_date = excluded.actual_played_date,
			status = excluded.status,
			entry_source = excluded.entry_source,
			submitted_by_player_id = excluded.submitted_by_player_id,
			submitted_at = excluded.submitted_at,
			confirmed_by_player_id = excluded.confirmed_by_player_id,
			confirmed_at = excluded.confirmed_at,
			corrected_by_player_id = excluded.corrected_by_player_id,
			corrected_at = excluded.corrected_at,
			correction_reason = excluded.correction_reason,
			sent_back_by_player_id = excluded.sent_back_by_player_id,
			sent_back_at = excluded.sent_back_at,
			send_back_reason = excluded.send_back_reason,
			revision = excluded.revision,
			details_locked_at = excluded.details_locked_at`
	).run(
		write.fixtureId,
		write.lowFrames,
		write.highFrames,
		write.actualPlayedDate,
		write.status,
		write.entrySource,
		write.submittedByPlayerId,
		write.submittedAt,
		write.confirmedByPlayerId === undefined
			? (existing?.confirmed_by_player_id ?? null)
			: write.confirmedByPlayerId,
		write.confirmedAt === undefined ? (existing?.confirmed_at ?? null) : write.confirmedAt,
		write.correctedByPlayerId === undefined
			? (existing?.corrected_by_player_id ?? null)
			: write.correctedByPlayerId,
		write.correctedAt === undefined ? (existing?.corrected_at ?? null) : write.correctedAt,
		write.correctionReason === undefined
			? (existing?.correction_reason ?? null)
			: write.correctionReason,
		write.sentBackByPlayerId === undefined
			? (existing?.sent_back_by_player_id ?? null)
			: write.sentBackByPlayerId,
		write.sentBackAt === undefined ? (existing?.sent_back_at ?? null) : write.sentBackAt,
		write.sendBackReason === undefined
			? (existing?.send_back_reason ?? null)
			: write.sendBackReason,
		revision,
		detailsLockedAt
	);

	// Resolve by natural key: lastInsertRowid is not reliable after an upsert that
	// took the UPDATE branch (SANDBOX.md §3).
	const resultId = (
		db.prepare('SELECT id FROM results WHERE fixture_id = ?').get(write.fixtureId) as { id: number }
	).id;

	db.prepare('DELETE FROM result_frames WHERE result_id = ?').run(resultId);
	const addFrame = db.prepare(
		`INSERT INTO result_frames (result_id, frame_number, player_low_points, player_high_points)
		 VALUES (?, ?, ?, ?)`
	);
	for (const frame of write.frames ?? []) {
		addFrame.run(resultId, frame.frameNumber, frame.lowPoints, frame.highPoints);
	}
	db.prepare('DELETE FROM result_breaks WHERE result_id = ?').run(resultId);
	const addBreak = db.prepare(
		'INSERT INTO result_breaks (result_id, player_id, break_points) VALUES (?, ?, ?)'
	);
	for (const breakEntry of write.breaks ?? []) {
		addBreak.run(resultId, breakEntry.playerId, breakEntry.breakPoints);
	}
	if (write.frameWinners !== undefined) {
		db.prepare('DELETE FROM result_frame_winners WHERE result_id = ?').run(resultId);
		const addWinner = db.prepare(
			'INSERT INTO result_frame_winners (result_id, frame_number, player_id) VALUES (?, ?, ?)'
		);
		for (const winner of write.frameWinners) {
			addWinner.run(resultId, winner.frameNumber, winner.playerId);
		}
	}

	db.prepare('UPDATE fixtures SET state = ? WHERE id = ?').run(
		fixtureStateForResultStatus(write.status),
		write.fixtureId
	);
	return resultId;
}

export interface FixtureResultFacts {
	fixtureId: number;
	roundId: number;
	seasonId: number;
	roundNumber: number;
	roundStatus: 'open' | 'closed';
	playerLowId: number;
	playerHighId: number;
	state: FixtureState;
	/** The season's scoring snapshot: frames actually played per league match. */
	framesPerMatch: number;
	timezone: string;
	deadlineAt: string | null;
	graceDays: number;
	openedAt: string;
}

/**
 * Everything a result write path needs to know about a fixture: its state, its
 * two players, and the round's deadline/grace/timezone snapshot. One query, so
 * the submission, review and correction paths cannot disagree about the facts.
 */
export function loadFixtureResultFacts(db: Db, fixtureId: number): FixtureResultFacts | null {
	const row = db
		.prepare(
			`SELECT f.id AS fixture_id, f.round_id, f.state, f.player_low_id, f.player_high_id,
				ro.number AS round_number, ro.status AS round_status, ro.deadline_at, ro.grace_days,
				ro.opened_at, ro.season_id, s.frames_per_match, s.timezone
			 FROM fixtures f
			 JOIN rounds ro ON ro.id = f.round_id
			 JOIN seasons s ON s.id = ro.season_id
			 WHERE f.id = ?`
		)
		.get(fixtureId) as
		| {
				fixture_id: number;
				round_id: number;
				season_id: number;
				round_number: number;
				round_status: 'open' | 'closed';
				player_low_id: number;
				player_high_id: number;
				state: FixtureState;
				frames_per_match: number;
				timezone: string;
				deadline_at: string | null;
				grace_days: number;
				opened_at: string;
		  }
		| undefined;
	if (!row) return null;
	return {
		fixtureId: row.fixture_id,
		roundId: row.round_id,
		seasonId: row.season_id,
		roundNumber: row.round_number,
		roundStatus: row.round_status,
		playerLowId: row.player_low_id,
		playerHighId: row.player_high_id,
		state: row.state,
		framesPerMatch: row.frames_per_match,
		timezone: row.timezone,
		deadlineAt: row.deadline_at,
		graceDays: row.grace_days,
		openedAt: row.opened_at
	};
}

/**
 * The date guards every result write path shares (HANDOFF §4):
 *
 *   * the actual played date must fall inside the round's deadline + grace
 *     window (league-local calendar days, including across daylight saving);
 *   * it cannot be in the future — a result records a match that was played;
 *   * an ordinary unplayed fixture stops accepting results once grace has run
 *     out; from then on only the admin retrospective path can record a genuine
 *     result for it.
 *
 * `fixtures.booked_date` is never consulted here or anywhere else in the result
 * paths: a planned date is a promise, not proof of play.
 */
export function assertPlayedDateAllowed(
	fixture: FixtureResultFacts,
	actualPlayedDate: string,
	now: Date
): void {
	if (!fixture.deadlineAt) return;
	if (
		!isPlayedDateWithinRoundWindow({
			actualPlayedDate,
			openedAt: fixture.openedAt,
			deadlineAt: fixture.deadlineAt,
			graceDays: fixture.graceDays,
			timeZone: fixture.timezone
		})
	) {
		throw new Error('The actual played date must fall within this round’s deadline and grace period.');
	}
	if (actualPlayedDate > localDateString(now, fixture.timezone)) {
		throw new Error('The actual played date cannot be in the future.');
	}
	if (fixture.state === 'unplayed') {
		const closesAt = gracePeriodEndsAt(fixture.deadlineAt, fixture.graceDays, fixture.timezone);
		if (now.getTime() > closesAt.getTime()) {
			throw new Error(
				'This fixture is past its deadline and grace period; wait for neutral closure and use the admin retrospective path.'
			);
		}
	}
}

/**
 * Save a league result. `entrySource` decides whether opponent confirmation is
 * required: 'player' submissions land as 'submitted' and must not move the
 * table; admin entries are confirmed immediately.
 *
 * This is the low-level primitive (used by the seed and the lifecycle rules).
 * Application journeys go through `results.ts`, which adds the permission
 * matrix, the review state machine and the audit trail on top of it.
 */
export function saveLeagueResult(
	db: Db,
	input: LeagueResultInput,
	options: { now?: Date } = {}
): { resultId: number; status: ResultStatus } {
	const now = options.now ?? new Date();
	const fixture = loadFixtureResultFacts(db, input.fixtureId);
	if (!fixture) throw new Error(`Fixture ${input.fixtureId} does not exist.`);
	const entrySource = input.entrySource ?? 'player';

	if (fixture.state === 'confirmed' && !input.allowOverwrite) {
		throw new Error('This fixture already has a confirmed result.');
	}
	if (fixture.state === 'awarded') throw new Error('An awarded fixture cannot be recorded as a result.');
	if (fixture.state === 'closed_unplayed') {
		if (entrySource !== 'admin_retrospective') {
			throw new Error('A closed fixture only accepts an admin retrospective result.');
		}
	} else if (entrySource === 'admin_retrospective') {
		throw new Error('A retrospective result is only for a neutrally closed fixture.');
	}
	assertPlayedDateAllowed(fixture, input.actualPlayedDate, now);
	if (entrySource === 'player' && fixture.roundStatus !== 'open') {
		throw new Error('A closed round does not accept player result submissions.');
	}
	if (fixture.state === 'awaiting_confirmation' && !input.allowOverwrite) {
		throw new Error('This fixture already has a submitted result awaiting confirmation.');
	}

	const validation = validateLeagueResult({
		framesPerMatch: fixture.framesPerMatch,
		lowFrames: input.lowFrames,
		highFrames: input.highFrames,
		actualPlayedDate: input.actualPlayedDate,
		frames: input.frames,
		breaks: input.breaks,
		lowPlayerId: fixture.playerLowId,
		highPlayerId: fixture.playerHighId
	});
	if (!validation.ok) {
		throw new Error(`Invalid result: ${validation.errors.join(' ')}`);
	}

	const status: ResultStatus = entrySource === 'player' ? 'submitted' : 'confirmed';

	return db.transaction(() => {
		const resultId = writeResultRow(db, {
			fixtureId: input.fixtureId,
			lowFrames: input.lowFrames,
			highFrames: input.highFrames,
			actualPlayedDate: input.actualPlayedDate,
			status,
			entrySource,
			submittedByPlayerId: input.submittedByPlayerId,
			submittedAt: now.toISOString(),
			confirmedByPlayerId: status === 'confirmed' ? input.submittedByPlayerId : null,
			confirmedAt: status === 'confirmed' ? now.toISOString() : null,
			frames: input.frames,
			breaks: input.breaks
		});
		if (entrySource === 'admin_retrospective') {
			recordAudit(db, {
				entityType: 'result',
				entityId: resultId,
				action: 'retrospective_recorded',
				actorPlayerId: input.submittedByPlayerId,
				detail: {
					fixtureId: input.fixtureId,
					roundId: fixture.roundId,
					actualPlayedDate: input.actualPlayedDate,
					frames: [input.lowFrames, input.highFrames]
				}
			});
		}
		return { resultId, status };
	})();
}

/**
 * Opponent approval. Only a confirmed result moves the standings, so this is the
 * transition that makes a submitted scoreline count (HANDOFF §4: auto-advance
 * and the table wait for confirmation, never for submission).
 *
 * Low-level primitive: `results.ts` checks who is allowed to confirm (never the
 * submitter) and writes the audit entry.
 */
export function confirmResult(
	db: Db,
	resultId: number,
	confirmingPlayerId: number,
	meta: { confirmedAt?: string } = {}
): void {
	const result = db
		.prepare('SELECT id, fixture_id, status FROM results WHERE id = ?')
		.get(resultId) as
		| { id: number; fixture_id: number; status: ResultStatus }
		| undefined;
	if (!result) throw new Error(`Result ${resultId} does not exist.`);
	if (result.status === 'confirmed') return;
	if (result.status !== 'submitted') {
		throw new Error('Only a submitted result can be confirmed.');
	}
	db.transaction(() => {
		db.prepare(
			`UPDATE results
			 SET status = 'confirmed', confirmed_by_player_id = ?, confirmed_at = ?,
				sent_back_by_player_id = NULL, sent_back_at = NULL, send_back_reason = NULL
			 WHERE id = ? AND status = 'submitted'`
		).run(confirmingPlayerId, meta.confirmedAt ?? new Date().toISOString(), resultId);
		db.prepare(`UPDATE fixtures SET state = 'confirmed' WHERE id = ?`).run(result.fixture_id);
	})();
}

/**
 * Opponent sends the result back for correction; the table is untouched and the
 * fixture becomes outstanding again, so nothing unconfirmed can ever look
 * played. Low-level primitive: `results.ts` checks who may send it back and
 * records the reason and the audit entry.
 */
export function sendBackResult(
	db: Db,
	resultId: number,
	meta: { actorPlayerId?: number | null; reason?: string | null; sentBackAt?: string } = {}
): void {
	const result = db
		.prepare('SELECT fixture_id, status FROM results WHERE id = ?')
		.get(resultId) as
		| { fixture_id: number; status: ResultStatus }
		| undefined;
	if (!result) throw new Error(`Result ${resultId} does not exist.`);
	if (result.status === 'sent_back') return;
	if (result.status !== 'submitted') {
		throw new Error('Only a submitted result can be sent back for correction.');
	}
	const at = meta.sentBackAt ?? new Date().toISOString();
	db.transaction(() => {
		db.prepare(
			`UPDATE results
			 SET status = 'sent_back', sent_back_by_player_id = ?, sent_back_at = ?, send_back_reason = ?
			 WHERE id = ?`
		).run(meta.actorPlayerId ?? null, at, meta.reason ?? null, resultId);
		db.prepare(`UPDATE fixtures SET state = 'unplayed' WHERE id = ?`).run(result.fixture_id);
	})();
}

/**
 * Neutral closure: an ordinary unplayed fixture whose grace period has run out.
 * No played 0–0 is created, nobody is blamed or awarded, and the closed state
 * is retained so the fixture cannot reappear as outstanding (HANDOFF §4).
 */
export function closeFixtureNeutrally(db: Db, fixtureId: number, now = new Date()): void {
	const fixture = db
		.prepare(
			`SELECT f.id, f.state, ro.deadline_at, ro.grace_days, s.timezone
			 FROM fixtures f
			 JOIN rounds ro ON ro.id = f.round_id
			 JOIN seasons s ON s.id = ro.season_id
			 WHERE f.id = ?`
		)
		.get(fixtureId) as
		| { id: number; state: FixtureState; deadline_at: string | null; grace_days: number; timezone: string }
		| undefined;
	if (!fixture) throw new Error(`Fixture ${fixtureId} does not exist.`);
	if (fixture.state === 'closed_unplayed') return;
	if (fixture.state !== 'unplayed') {
		throw new Error('Only an unplayed fixture can be closed neutrally.');
	}
	if (!fixture.deadline_at) throw new Error('A fixture without a round deadline cannot be closed automatically.');
	const closesAt = gracePeriodEndsAt(fixture.deadline_at, fixture.grace_days, fixture.timezone);
	if (now.getTime() <= closesAt.getTime()) {
		throw new Error('The round deadline and grace period have not elapsed.');
	}
	db.prepare("UPDATE fixtures SET state = 'closed_unplayed' WHERE id = ? AND state = 'unplayed'").run(
		fixtureId
	);
}

export interface AwardInput {
	fixtureId: number;
	playerId: number;
	tablePoints: number;
	sourceType: AwardSource;
	sourceResultId?: number | null;
	drawValue?: number | null;
	createdByPlayerId: number;
	reason?: string | null;
}

/**
 * Administrative award. Table points only: the fixture moves to 'awarded' and no
 * result row is created, so frames, frame difference and match wins are
 * untouched by construction.
 */
export function createAward(db: Db, input: AwardInput): number {
	if (!Number.isInteger(input.tablePoints) || input.tablePoints < 0) {
		throw new Error('Award table points must be a non-negative whole number.');
	}
	if (input.sourceType === 'previous_round_result' && input.sourceResultId == null) {
		throw new Error('A previous-round result must supply the award value.');
	}
	if (input.sourceType === 'random_draw' && input.drawValue == null) {
		throw new Error('A random draw award must record its drawn value.');
	}
	return db.transaction(() => {
		db
			.prepare(
				`INSERT INTO awards (
					fixture_id, player_id, table_points, source_type, source_result_id,
					draw_value, created_by_player_id, reason
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT (fixture_id) DO UPDATE SET
					player_id = excluded.player_id,
					table_points = excluded.table_points,
					source_type = excluded.source_type,
					source_result_id = excluded.source_result_id,
					draw_value = excluded.draw_value,
					created_by_player_id = excluded.created_by_player_id,
					reason = excluded.reason`
			)
			.run(
				input.fixtureId,
				input.playerId,
				input.tablePoints,
				input.sourceType,
				input.sourceResultId ?? null,
				input.drawValue ?? null,
				input.createdByPlayerId,
				input.reason ?? null
			);
		// Resolve the natural key: lastInsertRowid is stale when the idempotent
		// seed hits the ON CONFLICT update branch.
		const awardId = (
			db.prepare('SELECT id FROM awards WHERE fixture_id = ?').get(input.fixtureId) as { id: number }
		).id;
		db.prepare(`UPDATE fixtures SET state = 'awarded' WHERE id = ?`).run(input.fixtureId);
		recordAudit(db, {
			entityType: 'award',
			entityId: awardId,
			action: 'created',
			actorPlayerId: input.createdByPlayerId,
			reason: input.reason ?? null,
			detail: {
				fixtureId: input.fixtureId,
				playerId: input.playerId,
				tablePoints: input.tablePoints,
				sourceType: input.sourceType,
				sourceResultId: input.sourceResultId ?? null,
				drawValue: input.drawValue ?? null
			}
		});
		return awardId;
	})();
}

export interface AuditEntry {
	entityType: string;
	entityId: number;
	action: string;
	actorPlayerId?: number | null;
	reason?: string | null;
	detail?: unknown;
}

/** Append-only audit trail (who changed what, when, and why). */
export function recordAudit(db: Db, entry: AuditEntry): void {
	db.prepare(
		`INSERT INTO audit_log (entity_type, entity_id, action, actor_player_id, reason, detail)
		 VALUES (?, ?, ?, ?, ?, ?)`
	).run(
		entry.entityType,
		entry.entityId,
		entry.action,
		entry.actorPlayerId ?? null,
		entry.reason ?? null,
		entry.detail === undefined ? null : JSON.stringify(entry.detail)
	);
}

/**
 * Table points earned by `playerId` against `opponentId` in a genuine
 * previous-round league result — the only automatic award source (HANDOFF §4).
 * Administrative awards are never a source, and unconfirmed submissions do not
 * qualify.
 */
export function previousRoundPointsAgainst(
	db: Db,
	options: { seasonId: number; playerId: number; opponentId: number; beforeRoundNumber: number }
): { resultId: number; tablePoints: number; roundNumber: number } | null {
	const [low, high] =
		options.playerId < options.opponentId
			? [options.playerId, options.opponentId]
			: [options.opponentId, options.playerId];
	const row = db
		.prepare(
			`SELECT r.id AS result_id, ro.number AS round_number,
					r.player_low_frames, r.player_high_frames
			 FROM results r
			 JOIN fixtures f ON f.id = r.fixture_id
			 JOIN rounds ro ON ro.id = f.round_id
			 WHERE ro.season_id = @seasonId
			   AND ro.number < @beforeRoundNumber
			   AND r.status = 'confirmed'
			   AND f.player_low_id = @low
			   AND f.player_high_id = @high
			 ORDER BY ro.number DESC
			 LIMIT 1`
		)
		.get({
			seasonId: options.seasonId,
			beforeRoundNumber: options.beforeRoundNumber,
			low,
			high
		}) as
		| { result_id: number; round_number: number; player_low_frames: number; player_high_frames: number }
		| undefined;
	if (!row) return null;
	const tablePoints = options.playerId === low ? row.player_low_frames : row.player_high_frames;
	return { resultId: row.result_id, tablePoints, roundNumber: row.round_number };
}
