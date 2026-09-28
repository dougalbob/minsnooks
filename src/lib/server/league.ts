/**
 * League domain write paths (Phase 2).
 *
 * Everything here is server-side. Nothing on this page is ever driven from the
 * client: opening a round snapshots state, fixtures are created atomically for
 * every pair, and results/awards are validated before they touch the database.
 *
 * The lifecycle rules themselves (grace enforcement, auto-advance, withdrawals)
 * arrive in Phases 4 and 7; this module provides the transactional primitives
 * and the validation core those phases build on.
 */
import type { Db } from './db';
import { gracePeriodEndsAt, isPlayedDateWithinRoundWindow, localDateString } from './league-time';

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
		return roundId;
	})();
}

/** Canonical pair ordering used by the fixtures table. */
export function orderedPair(a: number, b: number): [number, number] {
	return a < b ? [a, b] : [b, a];
}

export interface FrameDetail {
	frameNumber: number;
	lowPoints: number;
	highPoints: number;
}

export interface BreakDetail {
	playerId: number;
	breakPoints: number;
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

export interface ValidationResult {
	ok: boolean;
	errors: string[];
	warnings: string[];
}

/** Non-negative whole numbers only (HANDOFF §4 validation rules). */
function isCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Validate a league result against the season's scoring config.
 *
 * Hard errors: impossible frame counts, frame-winner inconsistency, breaks
 * above the player's best recorded frame score, missing actual played date.
 * Soft warnings: extreme but plausible totals (fouls can inflate a frame, so a
 * 100–50 frame is legal — HANDOFF §4). Warnings are never hard rejections.
 */
export function validateLeagueResult(
	input: {
		framesPerMatch: number;
		lowFrames: number;
		highFrames: number;
		actualPlayedDate: string;
		frames?: FrameDetail[];
		breaks?: BreakDetail[];
		lowPlayerId: number;
		highPlayerId: number;
	},
	options: { extremeFramePoints?: number } = {}
): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const extreme = options.extremeFramePoints ?? 120;

	if (!isCount(input.lowFrames) || !isCount(input.highFrames)) {
		errors.push('Frame counts must be non-negative whole numbers.');
		return { ok: false, errors, warnings };
	}
	if (input.lowFrames + input.highFrames !== input.framesPerMatch) {
		errors.push(
			`A league match is exactly ${input.framesPerMatch} frames: ${input.lowFrames} + ${input.highFrames} does not add up.`
		);
	}
	if (input.lowFrames === input.highFrames) {
		errors.push('A league match cannot be drawn; one player must win more frames.');
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.actualPlayedDate)) {
		errors.push('An actual date played (YYYY-MM-DD) is required.');
	}

	const frames = input.frames ?? [];
	if (frames.length > 0) {
		if (frames.length !== input.framesPerMatch) {
			errors.push(`Frame-point detail must cover all ${input.framesPerMatch} frames.`);
		}
		const seen = new Set<number>();
		let lowFrameWins = 0;
		let highFrameWins = 0;
		for (const frame of frames) {
			if (!isCount(frame.lowPoints) || !isCount(frame.highPoints)) {
				errors.push(`Frame ${frame.frameNumber}: points must be non-negative whole numbers.`);
				continue;
			}
			if (seen.has(frame.frameNumber)) {
				errors.push(`Frame ${frame.frameNumber} is listed twice.`);
			}
			seen.add(frame.frameNumber);
			if (frame.lowPoints === frame.highPoints) {
				errors.push(`Frame ${frame.frameNumber}: a frame cannot be drawn.`);
			} else if (frame.lowPoints > frame.highPoints) {
				lowFrameWins++;
			} else {
				highFrameWins++;
			}
			if (frame.lowPoints > extreme || frame.highPoints > extreme) {
				warnings.push(
					`Frame ${frame.frameNumber} is unusually high (${frame.lowPoints}–${frame.highPoints}). Please check — fouls can inflate a frame, so this is allowed.`
				);
			}
		}
		if (errors.length === 0) {
			if (lowFrameWins !== input.lowFrames || highFrameWins !== input.highFrames) {
				errors.push(
					`Frame winners (${lowFrameWins}–${highFrameWins}) do not match the match score (${input.lowFrames}–${input.highFrames}).`
				);
			}
		}
	}

	for (const breakEntry of input.breaks ?? []) {
		if (!isCount(breakEntry.breakPoints)) {
			errors.push('Breaks must be non-negative whole numbers.');
			continue;
		}
		if (breakEntry.playerId !== input.lowPlayerId && breakEntry.playerId !== input.highPlayerId) {
			errors.push('A break was recorded for a player who is not in this match.');
			continue;
		}
		// A break cannot exceed the player's best recorded frame score — in any
		// frame they played, won or lost (a 60 break in a 60–65 frame is legal).
		// Only checked when frame detail exists: without a shot/foul log there is
		// no exact mathematical validator for every possible final frame total.
		const bestFrame = frames.reduce((best, frame) => {
			const own = breakEntry.playerId === input.lowPlayerId ? frame.lowPoints : frame.highPoints;
			return Math.max(best, own);
		}, 0);
		if (frames.length > 0 && breakEntry.breakPoints > bestFrame) {
			errors.push(
				`A break of ${breakEntry.breakPoints} is higher than the best recorded frame score (${bestFrame}).`
			);
		}
	}

	return { ok: errors.length === 0, errors, warnings };
}

/**
 * Save a league result. `entrySource` decides whether opponent confirmation is
 * required: 'player' submissions land as 'submitted' and must not move the
 * table; admin entries are confirmed immediately.
 */
export function saveLeagueResult(
	db: Db,
	input: LeagueResultInput,
	options: { now?: Date } = {}
): { resultId: number; status: ResultStatus } {
	const now = options.now ?? new Date();
	const fixture = db
		.prepare(
			`SELECT f.*, s.frames_per_match, s.timezone,
					ro.status AS round_status, ro.deadline_at, ro.grace_days, ro.opened_at
			 FROM fixtures f
			 JOIN rounds ro ON ro.id = f.round_id
			 JOIN seasons s ON s.id = ro.season_id
			 WHERE f.id = ?`
		)
		.get(input.fixtureId) as
		| {
				id: number;
				round_id: number;
				player_low_id: number;
				player_high_id: number;
				state: FixtureState;
				frames_per_match: number;
				timezone: string;
				round_status: 'open' | 'closed';
				deadline_at: string | null;
				grace_days: number;
				opened_at: string;
		  }
		| undefined;
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
	if (
		fixture.deadline_at &&
		!isPlayedDateWithinRoundWindow({
			actualPlayedDate: input.actualPlayedDate,
			openedAt: fixture.opened_at,
			deadlineAt: fixture.deadline_at,
			graceDays: fixture.grace_days,
			timeZone: fixture.timezone
		})
	) {
		throw new Error('The actual played date must fall within this round’s deadline and grace period.');
	}
	if (fixture.state === 'unplayed' && fixture.deadline_at) {
		const closesAt = gracePeriodEndsAt(fixture.deadline_at, fixture.grace_days, fixture.timezone);
		if (now.getTime() > closesAt.getTime()) {
			throw new Error('This fixture is past its deadline and grace period; wait for neutral closure and use the admin retrospective path.');
		}
		if (input.actualPlayedDate > localDateString(now, fixture.timezone)) {
			throw new Error('The actual played date cannot be in the future.');
		}
	}
	if (entrySource === 'player' && fixture.round_status !== 'open') {
		throw new Error('A closed round does not accept player result submissions.');
	}
	if (fixture.state === 'awaiting_confirmation' && !input.allowOverwrite) {
		throw new Error('This fixture already has a submitted result awaiting confirmation.');
	}

	const validation = validateLeagueResult({
		framesPerMatch: fixture.frames_per_match,
		lowFrames: input.lowFrames,
		highFrames: input.highFrames,
		actualPlayedDate: input.actualPlayedDate,
		frames: input.frames,
		breaks: input.breaks,
		lowPlayerId: fixture.player_low_id,
		highPlayerId: fixture.player_high_id
	});
	if (!validation.ok) {
		throw new Error(`Invalid result: ${validation.errors.join(' ')}`);
	}

	const status: ResultStatus = entrySource === 'player' ? 'submitted' : 'confirmed';

	return db.transaction(() => {
		db.prepare(
			`INSERT INTO results (
				fixture_id, player_low_frames, player_high_frames, actual_played_date,
				status, entry_source, submitted_by_player_id, confirmed_by_player_id, confirmed_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (fixture_id) DO UPDATE SET
				player_low_frames = excluded.player_low_frames,
				player_high_frames = excluded.player_high_frames,
				actual_played_date = excluded.actual_played_date,
				status = excluded.status,
				entry_source = excluded.entry_source,
				submitted_by_player_id = excluded.submitted_by_player_id,
				confirmed_by_player_id = excluded.confirmed_by_player_id,
				confirmed_at = excluded.confirmed_at`
		)
			.run(
				input.fixtureId,
				input.lowFrames,
				input.highFrames,
				input.actualPlayedDate,
				status,
				entrySource,
				input.submittedByPlayerId,
				status === 'confirmed' ? input.submittedByPlayerId : null,
				status === 'confirmed' ? now.toISOString() : null
			);
		const resultId = (
			db.prepare('SELECT id FROM results WHERE fixture_id = ?').get(input.fixtureId) as { id: number }
		).id;

		db.prepare('DELETE FROM result_frames WHERE result_id = ?').run(resultId);
		const addFrame = db.prepare(
			`INSERT INTO result_frames (result_id, frame_number, player_low_points, player_high_points)
			 VALUES (?, ?, ?, ?)`
		);
		for (const frame of input.frames ?? []) {
			addFrame.run(resultId, frame.frameNumber, frame.lowPoints, frame.highPoints);
		}
		db.prepare('DELETE FROM result_breaks WHERE result_id = ?').run(resultId);
		const addBreak = db.prepare(
			`INSERT INTO result_breaks (result_id, player_id, break_points) VALUES (?, ?, ?)`
		);
		for (const breakEntry of input.breaks ?? []) {
			addBreak.run(resultId, breakEntry.playerId, breakEntry.breakPoints);
		}

		db.prepare('UPDATE fixtures SET state = ? WHERE id = ?').run(
			status === 'confirmed' ? 'confirmed' : 'awaiting_confirmation',
			input.fixtureId
		);
		if (entrySource === 'admin_retrospective') {
			recordAudit(db, {
				entityType: 'result',
				entityId: resultId,
				action: 'retrospective_recorded',
				actorPlayerId: input.submittedByPlayerId,
				detail: {
					fixtureId: input.fixtureId,
					roundId: fixture.round_id,
					actualPlayedDate: input.actualPlayedDate,
					frames: [input.lowFrames, input.highFrames]
				}
			});
		}
		return { resultId, status };
	})();
}

/** Opponent approval. Only a confirmed result moves the standings. */
export function confirmResult(db: Db, resultId: number, confirmingPlayerId: number): void {
	const result = db.prepare('SELECT * FROM results WHERE id = ?').get(resultId) as
		| { id: number; fixture_id: number; status: ResultStatus }
		| undefined;
	if (!result) throw new Error(`Result ${resultId} does not exist.`);
	if (result.status === 'confirmed') return;
	db.transaction(() => {
		db.prepare(
			`UPDATE results SET status = 'confirmed', confirmed_by_player_id = ?, confirmed_at = ?
			 WHERE id = ?`
		).run(confirmingPlayerId, new Date().toISOString(), resultId);
		db.prepare(`UPDATE fixtures SET state = 'confirmed' WHERE id = ?`).run(result.fixture_id);
	})();
}

/** Opponent sends the result back for correction; the table is untouched. */
export function sendBackResult(db: Db, resultId: number): void {
	const result = db.prepare('SELECT fixture_id FROM results WHERE id = ?').get(resultId) as
		| { fixture_id: number }
		| undefined;
	if (!result) throw new Error(`Result ${resultId} does not exist.`);
	db.transaction(() => {
		db.prepare(`UPDATE results SET status = 'sent_back' WHERE id = ?`).run(resultId);
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
		const info = db
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
		const awardId = Number(info.lastInsertRowid);
		db.prepare(`UPDATE fixtures SET state = 'awarded' WHERE id = ?`).run(input.fixtureId);
		recordAudit(db, {
			entityType: 'award',
			entityId: awardId,
			action: 'created',
			actorPlayerId: input.createdByPlayerId,
			reason: input.reason ?? null
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
