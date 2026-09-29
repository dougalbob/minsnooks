/**
 * Knockout progression — match results, later-stage draws, dropouts,
 * arrangements and completion (Phase 12).
 *
 * Shape (HANDOFF §6):
 *
 *   tie (match, unresolved) ──record──▶ resolved 'played' ──correct──▶ revision + 1
 *          │                                                                 │
 *          │ paired dropout (admin)          bye-holder dropout (admin)      │ corrections stop once
 *          ▼                                 ▼                               │ a later stage exists
 *   resolved 'walkover'                resolved 'void'                       │ or the competition is
 *   (opponent advances,                (holder removed; next stage           │ complete — the audit
 *    no played result)                  drawn afresh from the rest)          │ trail keeps the record
 *
 *   latest stage fully resolved ──▶ admin draws the next stage fresh from the
 *   players who advanced (never pre-seeded) ──▶ one player left ──▶ complete
 *
 * Invariants this module exists to protect:
 *
 *   * **format enforcement**: a result must stop exactly when a player
 *     reaches the competition's fixed first-to-N target (the same shared
 *     validator the record form runs live);
 *   * **no invented results**: a walkover advances a player without a played
 *     result — no frames, no played date, no result row — and progression
 *     never invents a result to unblock a stage;
 *   * **fresh later-stage draws**: progression waits until the prior stage is
 *     fully resolved, then draws pairings (and an odd-count bye) from the
 *     players who advanced, excluding anyone who dropped out — the waiting
 *     list is never used to replace a bye-holder;
 *   * **no league contamination**: nothing here touches league fixtures,
 *     results, standings or statistics;
 *   * **visible, auditable state**: every write records who, what, when and
 *     why in `audit_log` under `knockout_competition`.
 *
 * There is no opponent-approval state machine here: the confirmed Phase 8
 * matrix lets either participant (or an admin) record a knockout match, and a
 * saved result is final the moment it is written. Participants may correct
 * their own result; an admin correcting someone else's must give a reason
 * (mirroring the friendly rules decided in Q6). Corrections stop once a later
 * stage exists or the competition is complete, because the winner has already
 * been placed into the next draw.
 */
import type { Db } from './db';
import {
	assertAdmin,
	assertCompetition,
	checkedNow,
	KnockoutPermissionError,
	KnockoutValidationError,
	loadActor,
	secureRandomInt,
	shuffled,
	type KnockoutStatus,
	type RandomInt
} from './knockout';
import type { ViewerPlayer } from './viewer';
import { canRecordKnockoutMatch } from './permissions';
import { recordAudit } from './league';
import { isIsoDate, localDateString } from './league-time';
import {
	maxFramesForTarget,
	planStageFromOrder,
	validateKnockoutFrames,
	type KnockoutFrameCall
} from '../knockout-progression';

/** How a tie stands once its stage plays out. */
export type KnockoutResolvedType = 'played' | 'walkover' | 'void' | 'bye';

/** How a player left the competition (HANDOFF §6 dropout rules). */
export type KnockoutDropoutKind = 'paired' | 'bye' | 'between_stages';

const REASON_LIMIT = 300;
const NOTE_LIMIT = 200;
/** One nudge per sender per tie per day — a reminder, not a nag. */
const NUDGE_COOLDOWN_HOURS = 24;

function leagueTimezone(db: Db): string {
	const row = db.prepare('SELECT timezone FROM seasons ORDER BY id DESC LIMIT 1').get() as
		| { timezone: string }
		| undefined;
	return row?.timezone ?? 'Europe/London';
}

function todayInLeague(db: Db, now: Date): string {
	return localDateString(now, leagueTimezone(db));
}

export interface KnockoutTieFacts {
	tieId: number;
	competitionId: number;
	stageId: number;
	stageNumber: number;
	tieNumber: number;
	tieType: 'match' | 'bye';
	playerLowId: number | null;
	playerHighId: number | null;
	byePlayerId: number | null;
	resolvedType: KnockoutResolvedType | null;
	winnerPlayerId: number | null;
	framesToWin: number;
	competitionStatus: KnockoutStatus;
	completedAt: string | null;
}

const TIE_SELECT = `
	SELECT t.id AS tie_id, t.tie_number, t.tie_type, t.player_low_id, t.player_high_id,
		t.bye_player_id, t.resolved_type, t.winner_player_id,
		s.id AS stage_id, s.stage_number, s.competition_id,
		c.frames_to_win, c.status AS competition_status, c.completed_at
	FROM knockout_ties t
	JOIN knockout_stages s ON s.id = t.stage_id
	JOIN knockout_competitions c ON c.id = s.competition_id
`;

interface TieRow {
	tie_id: number;
	tie_number: number;
	tie_type: 'match' | 'bye';
	player_low_id: number | null;
	player_high_id: number | null;
	bye_player_id: number | null;
	resolved_type: KnockoutResolvedType | null;
	winner_player_id: number | null;
	stage_id: number;
	stage_number: number;
	competition_id: number;
	frames_to_win: number;
	competition_status: KnockoutStatus;
	completed_at: string | null;
}

function loadTieFacts(db: Db, tieId: number): KnockoutTieFacts {
	const row = db.prepare(`${TIE_SELECT} WHERE t.id = ?`).get(tieId) as TieRow | undefined;
	if (!row) throw new KnockoutValidationError(['That knockout tie no longer exists.']);
	return {
		tieId: row.tie_id,
		competitionId: row.competition_id,
		stageId: row.stage_id,
		stageNumber: row.stage_number,
		tieNumber: row.tie_number,
		tieType: row.tie_type,
		playerLowId: row.player_low_id,
		playerHighId: row.player_high_id,
		byePlayerId: row.bye_player_id,
		resolvedType: row.resolved_type,
		winnerPlayerId: row.winner_player_id,
		framesToWin: row.frames_to_win,
		competitionStatus: row.competition_status,
		completedAt: row.completed_at
	};
}

interface LatestStage {
	stageId: number;
	stageNumber: number;
}

function loadLatestStage(db: Db, competitionId: number): LatestStage | null {
	const row = db
		.prepare(
			`SELECT id AS stage_id, stage_number FROM knockout_stages
			 WHERE competition_id = ? ORDER BY stage_number DESC LIMIT 1`
		)
		.get(competitionId) as { stage_id: number; stage_number: number } | undefined;
	return row ? { stageId: row.stage_id, stageNumber: row.stage_number } : null;
}

function unresolvedTieCount(db: Db, stageId: number): number {
	return (
		db
			.prepare('SELECT COUNT(*) AS n FROM knockout_ties WHERE stage_id = ? AND resolved_type IS NULL')
			.get(stageId) as { n: number }
	).n;
}

/** Players through from a resolved stage (match winners, walkovers and byes). */
function advancingPlayerIds(db: Db, stageId: number): number[] {
	const rows = db
		.prepare(
			`SELECT winner_player_id AS player_id FROM knockout_ties
			 WHERE stage_id = ? AND winner_player_id IS NOT NULL
			 UNION
			 SELECT bye_player_id AS player_id FROM knockout_ties
			 WHERE stage_id = ? AND tie_type = 'bye' AND resolved_type = 'bye'`
		)
		.all(stageId, stageId) as Array<{ player_id: number }>;
	return rows.map((row) => row.player_id).sort((a, b) => a - b);
}

function droppedPlayerIds(db: Db, competitionId: number): Set<number> {
	const rows = db
		.prepare('SELECT player_id FROM knockout_dropouts WHERE competition_id = ?')
		.all(competitionId) as Array<{ player_id: number }>;
	return new Set(rows.map((row) => row.player_id));
}

/**
 * Everyone still able to play in the latest stage, minus dropouts: winners and
 * walkover recipients of resolved ties, holders of live byes, and both players
 * of any tie still waiting to be played.
 */
export function livePlayerIds(db: Db, competitionId: number): number[] {
	const latest = loadLatestStage(db, competitionId);
	if (!latest) return [];
	const dropped = droppedPlayerIds(db, competitionId);
	const ties = db
		.prepare(
			`SELECT tie_type, player_low_id, player_high_id, bye_player_id, resolved_type, winner_player_id
			 FROM knockout_ties WHERE stage_id = ?`
		)
		.all(latest.stageId) as Array<{
		tie_type: 'match' | 'bye';
		player_low_id: number | null;
		player_high_id: number | null;
		bye_player_id: number | null;
		resolved_type: KnockoutResolvedType | null;
		winner_player_id: number | null;
	}>;
	const ids = new Set<number>();
	for (const tie of ties) {
		if (tie.tie_type === 'bye') {
			if (tie.resolved_type === 'bye' && tie.bye_player_id !== null) ids.add(tie.bye_player_id);
		} else if (tie.resolved_type !== null && tie.winner_player_id !== null) {
			ids.add(tie.winner_player_id);
		} else if (tie.resolved_type === null) {
			if (tie.player_low_id !== null) ids.add(tie.player_low_id);
			if (tie.player_high_id !== null) ids.add(tie.player_high_id);
		}
	}
	return [...ids].filter((playerId) => !dropped.has(playerId)).sort((a, b) => a - b);
}

export interface CompetitionCompletion {
	completed: boolean;
	winnerPlayerId: number | null;
	/** True when the competition finished with no winner at all. */
	voided: boolean;
}

/**
 * Complete the competition when the latest stage is fully resolved and fewer
 * than two live players remain. Called inside every tie-resolution
 * transaction, so the final, a walkover in the final, or attrition by
 * dropouts all land the outcome in the same write that caused it.
 */
function maybeCompleteCompetition(
	db: Db,
	competitionId: number,
	actorPlayerId: number,
	now: Date
): CompetitionCompletion {
	const competition = assertCompetition(db, competitionId);
	if (competition.completed_at) {
		return {
			completed: true,
			winnerPlayerId: competition.winner_player_id,
			voided: competition.winner_player_id === null
		};
	}
	const latest = loadLatestStage(db, competitionId);
	if (!latest) return { completed: false, winnerPlayerId: null, voided: false };
	if (unresolvedTieCount(db, latest.stageId) > 0) {
		return { completed: false, winnerPlayerId: null, voided: false };
	}
	const dropped = droppedPlayerIds(db, competitionId);
	const through = advancingPlayerIds(db, latest.stageId).filter((id) => !dropped.has(id));
	if (through.length > 1) {
		return { completed: false, winnerPlayerId: null, voided: false };
	}
	const winnerPlayerId = through.length === 1 ? through[0] : null;
	db.prepare(
		'UPDATE knockout_competitions SET winner_player_id = ?, completed_at = ? WHERE id = ? AND completed_at IS NULL'
	).run(winnerPlayerId, now.toISOString(), competitionId);
	recordAudit(db, {
		entityType: 'knockout_competition',
		entityId: competitionId,
		action: 'competition_complete',
		actorPlayerId,
		detail: {
			winnerPlayerId,
			voided: winnerPlayerId === null,
			stageNumber: latest.stageNumber,
			livePlayerIds: through
		}
	});
	return { completed: true, winnerPlayerId, voided: winnerPlayerId === null };
}

/* ------------------------------------------------------------------ *
 * Recording and correcting results
 * ------------------------------------------------------------------ */

export interface KnockoutResultOutcome {
	tieId: number;
	winnerPlayerId: number;
	lowFrames: number;
	highFrames: number;
	stageResolved: boolean;
	competitionComplete: boolean;
	competitionWinnerPlayerId: number | null;
}

function validatePlayedDate(value: string, today: string): string {
	if (!isIsoDate(value)) {
		throw new KnockoutValidationError(['Enter a valid actual date played (YYYY-MM-DD).']);
	}
	if (value > today) {
		throw new KnockoutValidationError([
			'The actual date played cannot be in the future — enter the day the frames were played.'
		]);
	}
	return value;
}

/**
 * Record a played knockout result: first to N, stopping at the target.
 * Either participant or an admin may record; the write is final (no opponent
 * approval) and audited. Completing the final tie completes the competition.
 */
export function recordKnockoutResult(
	db: Db,
	input: {
		tieId: number;
		actorPlayerId: number;
		frames: KnockoutFrameCall[];
		actualPlayedDate: string;
	},
	options: { now?: Date; today?: string } = {}
): KnockoutResultOutcome {
	const now = checkedNow(options.now);
	const today = options.today ?? todayInLeague(db, now);

	return db.transaction((): KnockoutResultOutcome => {
		const tie = loadTieFacts(db, input.tieId);
		assertTieRecordable(tie);
		const { allowed, isParticipant, reason } = canRecordTie(db, tie, input.actorPlayerId);
		if (!allowed) throw new KnockoutPermissionError(reason ?? 'Only the participants or an admin can record this match.');

		const verdict = validateKnockoutFrames({
			playerLowId: tie.playerLowId!,
			playerHighId: tie.playerHighId!,
			framesToWin: tie.framesToWin,
			frames: input.frames
		});
		if (!verdict.ok) throw new KnockoutValidationError(verdict.errors);
		const actualPlayedDate = validatePlayedDate(input.actualPlayedDate, today);

		db.prepare(
			`INSERT INTO knockout_tie_results (
				tie_id, low_frames, high_frames, actual_played_date,
				recorded_by_player_id, recorded_at, revision
			) VALUES (?, ?, ?, ?, ?, ?, 1)`
		).run(
			tie.tieId,
			verdict.lowFrames,
			verdict.highFrames,
			actualPlayedDate,
			input.actorPlayerId,
			now.toISOString()
		);
		writeFrameWinners(db, tie.tieId, input.frames);
		db.prepare(
			`UPDATE knockout_ties SET resolved_type = 'played', winner_player_id = ?, resolved_at = ? WHERE id = ?`
		).run(verdict.winnerPlayerId, now.toISOString(), tie.tieId);

		recordAudit(db, {
			entityType: 'knockout_competition',
			entityId: tie.competitionId,
			action: 'match_result_recorded',
			actorPlayerId: input.actorPlayerId,
			detail: {
				tieId: tie.tieId,
				stageNumber: tie.stageNumber,
				winnerPlayerId: verdict.winnerPlayerId,
				lowFrames: verdict.lowFrames,
				highFrames: verdict.highFrames,
				frames: input.frames,
				actualPlayedDate,
				framesToWin: tie.framesToWin,
				adminOverride: !isParticipant
			}
		});

		const unresolved = unresolvedTieCount(db, tie.stageId);
		const completion = maybeCompleteCompetition(db, tie.competitionId, input.actorPlayerId, now);
		return {
			tieId: tie.tieId,
			winnerPlayerId: verdict.winnerPlayerId!,
			lowFrames: verdict.lowFrames,
			highFrames: verdict.highFrames,
			stageResolved: unresolved === 0,
			competitionComplete: completion.completed,
			competitionWinnerPlayerId: completion.winnerPlayerId
		};
	})();
}

function assertTieRecordable(tie: KnockoutTieFacts): void {
	if (tie.tieType !== 'match') {
		throw new KnockoutValidationError(['Byes are not matches — nothing to record.']);
	}
	if (tie.competitionStatus !== 'drawn') {
		throw new KnockoutValidationError(['This competition has no saved draw to record against.']);
	}
	if (tie.completedAt) {
		throw new KnockoutValidationError(['This competition is already complete.']);
	}
	if (tie.resolvedType !== null) {
		throw new KnockoutValidationError(['This tie already has a saved outcome.']);
	}
}

/** Shared participant-or-admin gate for tie actions, with the override flag. */
function canRecordTie(
	db: Db,
	tie: KnockoutTieFacts,
	actorPlayerId: number
): { allowed: boolean; isParticipant: boolean; reason: string | null } {
	const viewer: ViewerPlayer | null = loadActor(db, actorPlayerId);
	const check = canRecordKnockoutMatch(viewer, tie.playerLowId ?? -1, tie.playerHighId ?? -2);
	const isParticipant =
		viewer !== null && (viewer.playerId === tie.playerLowId || viewer.playerId === tie.playerHighId);
	return { allowed: check.allowed, isParticipant, reason: check.reason };
}

function writeFrameWinners(db: Db, tieId: number, frames: KnockoutFrameCall[]): void {
	db.prepare('DELETE FROM knockout_frame_winners WHERE tie_id = ?').run(tieId);
	const insert = db.prepare(
		'INSERT INTO knockout_frame_winners (tie_id, frame_number, winner_player_id) VALUES (?, ?, ?)'
	);
	for (const frame of frames) insert.run(tieId, frame.frameNumber, frame.winnerPlayerId);
}

export interface KnockoutCorrectionOutcome extends KnockoutResultOutcome {
	revision: number;
	winnerChanged: boolean;
}

/**
 * Correct a played result while it is still safe to do so: the tie must be in
 * the latest stage, no later draw may have placed its winner, and the
 * competition must not be complete. Participants correct their own matches
 * freely (audited); an admin overriding someone else's result must give a
 * reason (Q6 rules).
 */
export function correctKnockoutResult(
	db: Db,
	input: {
		tieId: number;
		actorPlayerId: number;
		frames: KnockoutFrameCall[];
		actualPlayedDate: string;
		reason?: string | null;
	},
	options: { now?: Date; today?: string } = {}
): KnockoutCorrectionOutcome {
	const now = checkedNow(options.now);
	const today = options.today ?? todayInLeague(db, now);
	const reason = (input.reason ?? '').trim();
	if (reason.length > REASON_LIMIT) {
		throw new KnockoutValidationError([`Keep the correction reason to ${REASON_LIMIT} characters or fewer.`]);
	}

	return db.transaction((): KnockoutCorrectionOutcome => {
		const tie = loadTieFacts(db, input.tieId);
		if (tie.tieType !== 'match' || tie.resolvedType !== 'played') {
			throw new KnockoutValidationError(['Only a played result can be corrected.']);
		}
		if (tie.completedAt) {
			throw new KnockoutValidationError([
				'This competition is complete, so its results are frozen — the audit trail keeps the saved outcome.'
			]);
		}
		const latest = loadLatestStage(db, tie.competitionId);
		if (!latest || latest.stageId !== tie.stageId) {
			throw new KnockoutValidationError([
				'The winner has already been carried into a later draw, so this result can no longer be corrected.'
			]);
		}
		const { allowed, isParticipant, reason: permissionReason } = canRecordTie(db, tie, input.actorPlayerId);
		if (!allowed) {
			throw new KnockoutPermissionError(permissionReason ?? 'Only the participants or an admin can correct this match.');
		}
		const adminOverride = !isParticipant;
		if (adminOverride && !reason) {
			throw new KnockoutValidationError(['A correction made by an admin needs a short reason for the audit trail.']);
		}

		const existing = db
			.prepare('SELECT low_frames, high_frames, actual_played_date, revision FROM knockout_tie_results WHERE tie_id = ?')
			.get(tie.tieId) as
			| { low_frames: number; high_frames: number; actual_played_date: string; revision: number }
			| undefined;
		if (!existing) throw new KnockoutValidationError(['The saved result row is missing.']);

		const verdict = validateKnockoutFrames({
			playerLowId: tie.playerLowId!,
			playerHighId: tie.playerHighId!,
			framesToWin: tie.framesToWin,
			frames: input.frames
		});
		if (!verdict.ok) throw new KnockoutValidationError(verdict.errors);
		const actualPlayedDate = validatePlayedDate(input.actualPlayedDate, today);

		const winnerChanged = verdict.winnerPlayerId !== tie.winnerPlayerId;
		db.prepare(
			`UPDATE knockout_tie_results SET low_frames = ?, high_frames = ?, actual_played_date = ?,
				revision = revision + 1, corrected_by_player_id = ?, corrected_at = ?, correction_reason = ?
			 WHERE tie_id = ?`
		).run(
			verdict.lowFrames,
			verdict.highFrames,
			actualPlayedDate,
			input.actorPlayerId,
			now.toISOString(),
			reason || null,
			tie.tieId
		);
		writeFrameWinners(db, tie.tieId, input.frames);
		db.prepare('UPDATE knockout_ties SET winner_player_id = ? WHERE id = ?').run(
			verdict.winnerPlayerId,
			tie.tieId
		);

		recordAudit(db, {
			entityType: 'knockout_competition',
			entityId: tie.competitionId,
			action: 'match_result_corrected',
			actorPlayerId: input.actorPlayerId,
			reason: reason || null,
			detail: {
				tieId: tie.tieId,
				stageNumber: tie.stageNumber,
				adminOverride,
				before: {
					winnerPlayerId: tie.winnerPlayerId,
					lowFrames: existing.low_frames,
					highFrames: existing.high_frames,
					actualPlayedDate: existing.actual_played_date,
					revision: existing.revision
				},
				after: {
					winnerPlayerId: verdict.winnerPlayerId,
					lowFrames: verdict.lowFrames,
					highFrames: verdict.highFrames,
					actualPlayedDate
				},
				frames: input.frames
			}
		});

		const revision = (
			db.prepare('SELECT revision FROM knockout_tie_results WHERE tie_id = ?').get(tie.tieId) as {
				revision: number;
			}
		).revision;
		// The stage stays resolved (a correction cannot unresolve a tie), but
		// completing again is harmless and keeps the guard in one place.
		const completion = maybeCompleteCompetition(db, tie.competitionId, input.actorPlayerId, now);
		return {
			tieId: tie.tieId,
			winnerPlayerId: verdict.winnerPlayerId!,
			lowFrames: verdict.lowFrames,
			highFrames: verdict.highFrames,
			stageResolved: unresolvedTieCount(db, tie.stageId) === 0,
			competitionComplete: completion.completed,
			competitionWinnerPlayerId: completion.winnerPlayerId,
			revision,
			winnerChanged
		};
	})();
}

/* ------------------------------------------------------------------ *
 * Dropouts
 * ------------------------------------------------------------------ */

export interface KnockoutDropoutOutcome {
	dropoutKind: KnockoutDropoutKind;
	/** The opponent advanced without a played result (paired dropout only). */
	opponentPlayerId: number | null;
	competitionComplete: boolean;
	competitionWinnerPlayerId: number | null;
}

/**
 * Record that a player has dropped out of the competition (admin action,
 * audited, reason required). A paired player's opponent advances on a
 * walkover without a played result; a bye-holder's bye is voided and the next
 * stage is drawn afresh from the remaining players — never from the waiting
 * list. A player who is not sitting on an unresolved tie simply leaves the
 * competition before the next draw (or triggers completion by attrition).
 */
export function recordKnockoutDropout(
	db: Db,
	input: {
		competitionId: number;
		playerId: number;
		actorPlayerId: number;
		reason: string;
	},
	options: { now?: Date } = {}
): KnockoutDropoutOutcome {
	const now = checkedNow(options.now);
	const reason = (input.reason ?? '').trim();
	if (!reason) {
		throw new KnockoutValidationError(['Give a short reason for the dropout so the record stays honest.']);
	}
	if (reason.length > REASON_LIMIT) {
		throw new KnockoutValidationError([`Keep the dropout reason to ${REASON_LIMIT} characters or fewer.`]);
	}

	return db.transaction((): KnockoutDropoutOutcome => {
		assertAdmin(db, input.actorPlayerId);
		const competition = assertCompetition(db, input.competitionId);
		if (competition.status !== 'drawn') {
			throw new KnockoutValidationError(['Dropouts apply after the first draw has been saved.']);
		}
		if (competition.completed_at) {
			throw new KnockoutValidationError(['This competition is already complete.']);
		}
		const entry = db
			.prepare(
				`SELECT entry_status FROM knockout_entries WHERE competition_id = ? AND player_id = ?`
			)
			.get(input.competitionId, input.playerId) as { entry_status: string } | undefined;
		if (!entry) {
			throw new KnockoutValidationError(['That player is not an entrant of this knockout.']);
		}
		const existing = db
			.prepare('SELECT 1 FROM knockout_dropouts WHERE competition_id = ? AND player_id = ?')
			.get(input.competitionId, input.playerId);
		if (existing) {
			throw new KnockoutValidationError(['This dropout has already been recorded.']);
		}

		const latest = loadLatestStage(db, input.competitionId);
		if (!latest) throw new KnockoutValidationError(['Dropouts apply after the first draw has been saved.']);

		let dropoutKind: KnockoutDropoutKind = 'between_stages';
		let opponentPlayerId: number | null = null;

		const ownTie = db
			.prepare(
				`SELECT id, tie_type, player_low_id, player_high_id, bye_player_id, resolved_type
				 FROM knockout_ties WHERE stage_id = ?
				   AND (player_low_id = ? OR player_high_id = ? OR bye_player_id = ?)`
			)
			.get(latest.stageId, input.playerId, input.playerId, input.playerId) as
			| {
					id: number;
					tie_type: 'match' | 'bye';
					player_low_id: number | null;
					player_high_id: number | null;
					bye_player_id: number | null;
					resolved_type: KnockoutResolvedType | null;
			  }
			| undefined;

		if (ownTie && (ownTie.resolved_type === null || ownTie.resolved_type === 'bye')) {
			if (ownTie.tie_type === 'match') {
				const opponentPlayerIdResolved =
					ownTie.player_low_id === input.playerId ? ownTie.player_high_id : ownTie.player_low_id;
				db.prepare(
					`UPDATE knockout_ties SET resolved_type = 'walkover', winner_player_id = ?, resolved_at = ? WHERE id = ?`
				).run(opponentPlayerIdResolved, now.toISOString(), ownTie.id);
				dropoutKind = 'paired';
				opponentPlayerId = opponentPlayerIdResolved;
			} else {
				db.prepare(
					`UPDATE knockout_ties SET resolved_type = 'void', resolved_at = ? WHERE id = ?`
				).run(now.toISOString(), ownTie.id);
				dropoutKind = 'bye';
			}
		}

		db.prepare(
			`INSERT INTO knockout_dropouts (
				competition_id, player_id, stage_number, dropout_kind,
				recorded_by_player_id, recorded_at, reason
			) VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run(
			input.competitionId,
			input.playerId,
			latest.stageNumber,
			dropoutKind,
			input.actorPlayerId,
			now.toISOString(),
			reason
		);

		recordAudit(db, {
			entityType: 'knockout_competition',
			entityId: input.competitionId,
			action: 'dropout_recorded',
			actorPlayerId: input.actorPlayerId,
			reason,
			detail: {
				playerId: input.playerId,
				stageNumber: latest.stageNumber,
				dropoutKind,
				tieId: ownTie?.id ?? null,
				opponentPlayerId,
				waitingListUsed: false
			}
		});

		const completion = maybeCompleteCompetition(db, input.competitionId, input.actorPlayerId, now);
		return {
			dropoutKind,
			opponentPlayerId,
			competitionComplete: completion.completed,
			competitionWinnerPlayerId: completion.winnerPlayerId
		};
	})();
}

/* ------------------------------------------------------------------ *
 * Later-stage draws
 * ------------------------------------------------------------------ */

export interface KnockoutStageDrawOutcome {
	stageId: number;
	stageNumber: number;
	matchups: Array<[number, number]>;
	byePlayerIds: number[];
	advancingPlayerIds: number[];
	framesToWin: number;
}

/**
 * Draw the next stage fresh from everyone who advanced — only once the prior
 * stage is fully resolved. Never pre-seeded: pairings (and an odd-count bye)
 * are drawn from the live players at draw time, excluding dropouts. Admin
 * action, server-randomized, audited.
 */
export function drawKnockoutNextStage(
	db: Db,
	input: { competitionId: number; actorPlayerId: number },
	options: { now?: Date; randomInt?: RandomInt } = {}
): KnockoutStageDrawOutcome {
	const now = checkedNow(options.now);
	const nextInt = options.randomInt ?? secureRandomInt;

	return db.transaction((): KnockoutStageDrawOutcome => {
		assertAdmin(db, input.actorPlayerId);
		const competition = assertCompetition(db, input.competitionId);
		if (competition.status !== 'drawn') {
			throw new KnockoutValidationError(['Save the opening draw before drawing a later stage.']);
		}
		if (competition.completed_at) {
			throw new KnockoutValidationError(['This competition is already complete.']);
		}
		const latest = loadLatestStage(db, input.competitionId);
		if (!latest) {
			throw new KnockoutValidationError(['Save the opening draw before drawing a later stage.']);
		}
		const unresolved = unresolvedTieCount(db, latest.stageId);
		if (unresolved > 0) {
			throw new KnockoutValidationError([
				`Stage ${latest.stageNumber} still has ${unresolved} unresolved ${unresolved === 1 ? 'tie' : 'ties'} — later stages wait until the round before them is resolved.`
			]);
		}

		const dropped = droppedPlayerIds(db, input.competitionId);
		const advancing = advancingPlayerIds(db, latest.stageId).filter((id) => !dropped.has(id));
		if (advancing.length <= 1) {
			throw new KnockoutValidationError([
				advancing.length === 1
					? 'Only one player is left, so the competition should already be complete.'
					: 'No players remain, so the competition should already be complete.'
			]);
		}

		const drawOrder = shuffled(advancing, nextInt);
		const plan = planStageFromOrder(drawOrder, 'later');
		const stageNumber = latest.stageNumber + 1;
		const stageInfo = db
			.prepare(
				`INSERT INTO knockout_stages (competition_id, stage_number, drawn_by_player_id, drawn_at)
				 VALUES (?, ?, ?, ?)`
			)
			.run(input.competitionId, stageNumber, input.actorPlayerId, now.toISOString());
		const stageId = Number(stageInfo.lastInsertRowid);
		writeStageTies(db, stageId, plan);

		recordAudit(db, {
			entityType: 'knockout_competition',
			entityId: input.competitionId,
			action: 'stage_drawn',
			actorPlayerId: input.actorPlayerId,
			detail: {
				stageId,
				stageNumber,
				playersEntering: advancing.length,
				advancingPlayerIds: advancing,
				drawOrder,
				matchups: plan.matchups,
				byePlayerIds: plan.byePlayerIds,
				framesToWin: competition.frames_to_win
			}
		});

		return {
			stageId,
			stageNumber,
			matchups: plan.matchups,
			byePlayerIds: plan.byePlayerIds,
			advancingPlayerIds: advancing,
			framesToWin: competition.frames_to_win
		};
	})();
}

/** Write a freshly planned stage: unresolved match ties, byes already through. */
function writeStageTies(
	db: Db,
	stageId: number,
	plan: { matchups: Array<[number, number]>; byePlayerIds: number[] }
): void {
	const addTie = db.prepare(
		`INSERT INTO knockout_ties (
			stage_id, tie_number, tie_type, player_low_id, player_high_id, bye_player_id, resolved_type
		) VALUES (?, ?, ?, ?, ?, ?, ?)`
	);
	let tieNumber = 1;
	for (const [low, high] of plan.matchups) {
		addTie.run(stageId, tieNumber++, 'match', low, high, null, null);
	}
	for (const playerId of plan.byePlayerIds) {
		addTie.run(stageId, tieNumber++, 'bye', null, null, playerId, 'bye');
	}
}

/* ------------------------------------------------------------------ *
 * Arrangements (planned dates) and nudges
 * ------------------------------------------------------------------ */

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Propose or change the planned date for an unresolved tie. Either
 * participant may arrange (an admin may step in, audited). A plan is never a
 * result: the tie stays unresolved and the actual date played is recorded
 * with the result. Re-planning supersedes the previous proposal honestly.
 */
export function proposeKnockoutArrangement(
	db: Db,
	input: {
		tieId: number;
		actorPlayerId: number;
		date: string;
		time?: string | null;
		note?: string | null;
	},
	options: { now?: Date; today?: string } = {}
): { arrangementId: number; replaced: boolean } {
	const now = checkedNow(options.now);
	const today = options.today ?? todayInLeague(db, now);
	const time = (input.time ?? '').trim();
	if (time && !TIME_PATTERN.test(time)) {
		throw new KnockoutValidationError(['Enter a valid time as HH:MM (24-hour), or leave the time blank.']);
	}
	const note = (input.note ?? '').trim();
	if (note.length > NOTE_LIMIT) {
		throw new KnockoutValidationError([`Keep the note to ${NOTE_LIMIT} characters or fewer.`]);
	}
	if (!isIsoDate(input.date)) {
		throw new KnockoutValidationError(['Choose a valid planned date.']);
	}
	if (input.date < today) {
		throw new KnockoutValidationError([
			'A planned date cannot be in the past. The actual date played is recorded with the result.'
		]);
	}

	return db.transaction((): { arrangementId: number; replaced: boolean } => {
		const tie = loadTieFacts(db, input.tieId);
		assertTieRecordable(tie); // same preconditions: an unresolved match tie in a live competition
		const { allowed, isParticipant, reason } = canRecordTie(db, tie, input.actorPlayerId);
		if (!allowed) {
			throw new KnockoutPermissionError(reason ?? 'Only the participants (or an admin) can arrange this match.');
		}

		const existing = db
			.prepare(
				`SELECT id, proposed_date, proposed_time FROM knockout_arrangements
				 WHERE tie_id = ? AND status = 'proposed'`
			)
			.get(tie.tieId) as { id: number; proposed_date: string; proposed_time: string | null } | undefined;
		let replaced = false;
		if (existing) {
			replaced = true;
			db.prepare(
				`UPDATE knockout_arrangements SET status = 'cancelled', cancelled_at = ?,
					cancelled_by_player_id = ?, cancel_reason = 'Replaced by a newer planned date'
				 WHERE id = ?`
			).run(now.toISOString(), input.actorPlayerId, existing.id);
		}
		const info = db
			.prepare(
				`INSERT INTO knockout_arrangements (
					tie_id, proposed_by_player_id, proposed_date, proposed_time, note, status, created_at
				) VALUES (?, ?, ?, ?, ?, 'proposed', ?)`
			)
			.run(tie.tieId, input.actorPlayerId, input.date, time || null, note || null, now.toISOString());
		recordAudit(db, {
			entityType: 'knockout_competition',
			entityId: tie.competitionId,
			action: 'arrangement_proposed',
			actorPlayerId: input.actorPlayerId,
			reason: note || null,
			detail: {
				tieId: tie.tieId,
				stageNumber: tie.stageNumber,
				date: input.date,
				time: time || null,
				replaced,
				adminOverride: !isParticipant
			}
		});
		return { arrangementId: Number(info.lastInsertRowid), replaced };
	})();
}

/** Cancel the active planned date for a tie (participants or admin). */
export function cancelKnockoutArrangement(
	db: Db,
	input: { tieId: number; actorPlayerId: number; reason?: string | null },
	options: { now?: Date } = {}
): { cancelled: boolean } {
	const now = checkedNow(options.now);
	const reason = (input.reason ?? '').trim();
	if (reason.length > NOTE_LIMIT) {
		throw new KnockoutValidationError([`Keep the cancellation note to ${NOTE_LIMIT} characters or fewer.`]);
	}

	return db.transaction((): { cancelled: boolean } => {
		const tie = loadTieFacts(db, input.tieId);
		const { allowed, isParticipant, reason: permissionReason } = canRecordTie(db, tie, input.actorPlayerId);
		if (!allowed) {
			throw new KnockoutPermissionError(permissionReason ?? 'Only the participants (or an admin) can cancel this plan.');
		}
		const active = db
			.prepare(`SELECT id, proposed_date, proposed_time FROM knockout_arrangements WHERE tie_id = ? AND status = 'proposed'`)
			.get(tie.tieId) as { id: number; proposed_date: string; proposed_time: string | null } | undefined;
		if (!active) return { cancelled: false };
		db.prepare(
			`UPDATE knockout_arrangements SET status = 'cancelled', cancelled_at = ?,
				cancelled_by_player_id = ?, cancel_reason = ? WHERE id = ?`
		).run(now.toISOString(), input.actorPlayerId, reason || 'Cancelled by a player', active.id);
		recordAudit(db, {
			entityType: 'knockout_competition',
			entityId: tie.competitionId,
			action: 'arrangement_cancelled',
			actorPlayerId: input.actorPlayerId,
			reason: reason || null,
			detail: {
				tieId: tie.tieId,
				stageNumber: tie.stageNumber,
				date: active.proposed_date,
				time: active.proposed_time,
				adminOverride: !isParticipant
			}
		});
		return { cancelled: true };
	})();
}

/**
 * Nudge the other player about an unresolved tie. Participants only (an admin
 * should talk to players directly), rate-limited to one nudge per sender per
 * tie per day so it stays a friendly reminder.
 */
export function nudgeKnockoutOpponent(
	db: Db,
	input: { tieId: number; actorPlayerId: number },
	options: { now?: Date } = {}
): { recipientPlayerId: number; totalSentByViewer: number } {
	const now = checkedNow(options.now);

	return db.transaction((): { recipientPlayerId: number; totalSentByViewer: number } => {
		const tie = loadTieFacts(db, input.tieId);
		assertTieRecordable(tie);
		const isParticipant =
			input.actorPlayerId === tie.playerLowId || input.actorPlayerId === tie.playerHighId;
		if (!isParticipant) {
			throw new KnockoutPermissionError('Only the two players in this tie can send a nudge.');
		}
		const recipientPlayerId =
			input.actorPlayerId === tie.playerLowId ? tie.playerHighId! : tie.playerLowId!;
		const cooldownCutoff = new Date(now.getTime() - NUDGE_COOLDOWN_HOURS * 60 * 60 * 1000);
		const recent = db
			.prepare(
				`SELECT COUNT(*) AS n FROM knockout_nudges
				 WHERE tie_id = ? AND sent_by_player_id = ? AND sent_at > ?`
			)
			.get(tie.tieId, input.actorPlayerId, cooldownCutoff.toISOString()) as { n: number };
		if (recent.n > 0) {
			throw new KnockoutValidationError([
				'You nudged your opponent within the last 24 hours — give them a little space before the next one.'
			]);
		}
		db.prepare(
			'INSERT INTO knockout_nudges (tie_id, sent_by_player_id, sent_at) VALUES (?, ?, ?)'
		).run(tie.tieId, input.actorPlayerId, now.toISOString());
		const total = (
			db
				.prepare('SELECT COUNT(*) AS n FROM knockout_nudges WHERE tie_id = ? AND sent_by_player_id = ?')
				.get(tie.tieId, input.actorPlayerId) as { n: number }
		).n;
		recordAudit(db, {
			entityType: 'knockout_competition',
			entityId: tie.competitionId,
			action: 'nudge_sent',
			actorPlayerId: input.actorPlayerId,
			detail: {
				tieId: tie.tieId,
				stageNumber: tie.stageNumber,
				recipientPlayerId
			}
		});
		return { recipientPlayerId, totalSentByViewer: total };
	})();
}

/* ------------------------------------------------------------------ *
 * Record-route loader
 * ------------------------------------------------------------------ */

export interface KnockoutRecordPageData {
	tie: {
		tieId: number;
		tieNumber: number;
		stageNumber: number;
		competitionId: number;
		competitionTitle: string;
		framesToWin: number;
		playerLow: { playerId: number; name: string; initials: string; tone: string };
		playerHigh: { playerId: number; name: string; initials: string; tone: string };
	};
	correcting: boolean;
	canAct: boolean;
	reasonRequired: boolean;
	isParticipant: boolean;
	adminOverride: boolean;
	blockReason: string | null;
	today: string;
	maxFrames: number;
	existing: {
		lowFrames: number;
		highFrames: number;
		actualPlayedDate: string;
		revision: number;
		recordedByName: string;
		frames: Array<{ frameNumber: number; winner: 'low' | 'high' }>;
	} | null;
}

/** Everything the record/correct screen needs, with the viewer's permissions. */
export function loadKnockoutTieForRecord(
	db: Db,
	tieId: number,
	viewerPlayerId: number | null
): KnockoutRecordPageData {
	const tie = loadTieFacts(db, tieId);
	const competition = assertCompetition(db, tie.competitionId);
	const player = (id: number) => {
		const row = db
			.prepare('SELECT id, display_name, initials, avatar_tone FROM players WHERE id = ?')
			.get(id) as { id: number; display_name: string; initials: string; avatar_tone: string } | undefined;
		return {
			playerId: id,
			name: row?.display_name ?? `Player ${id}`,
			initials: row?.initials ?? '??',
			tone: row?.avatar_tone ?? 'maya'
		};
	};

	const permission = viewerPlayerId === null
		? { allowed: false, isParticipant: false, reason: 'Sign in to record a knockout result.' }
		: canRecordTie(db, tie, viewerPlayerId);

	let correcting = false;
	let existing: KnockoutRecordPageData['existing'] = null;
	let blockReason: string | null = permission.allowed ? null : permission.reason;
	if (tie.resolvedType === 'played') {
		correcting = true;
		const row = db
			.prepare(
				`SELECT r.low_frames, r.high_frames, r.actual_played_date, r.revision, p.display_name AS recorded_by
				 FROM knockout_tie_results r JOIN players p ON p.id = r.recorded_by_player_id
				 WHERE r.tie_id = ?`
			)
			.get(tie.tieId) as
			| { low_frames: number; high_frames: number; actual_played_date: string; revision: number; recorded_by: string }
			| undefined;
		const frames = db
			.prepare(
				`SELECT frame_number, winner_player_id FROM knockout_frame_winners
				 WHERE tie_id = ? ORDER BY frame_number`
			)
			.all(tie.tieId) as Array<{ frame_number: number; winner_player_id: number }>;
		if (row) {
			existing = {
				lowFrames: row.low_frames,
				highFrames: row.high_frames,
				actualPlayedDate: row.actual_played_date,
				revision: row.revision,
				recordedByName: row.recorded_by,
				frames: frames.map((frame) => ({
					frameNumber: frame.frame_number,
					winner: frame.winner_player_id === tie.playerLowId ? ('low' as const) : ('high' as const)
				}))
			};
		}
		if (blockReason === null) {
			if (tie.completedAt) {
				blockReason = 'This competition is complete, so its results are frozen.';
			} else {
				const latest = loadLatestStage(db, tie.competitionId);
				if (!latest || latest.stageId !== tie.stageId) {
					blockReason = 'The winner has already been carried into a later draw.';
				}
			}
		}
	}

	return {
		tie: {
			tieId: tie.tieId,
			tieNumber: tie.tieNumber,
			stageNumber: tie.stageNumber,
			competitionId: tie.competitionId,
			competitionTitle: competition.title,
			framesToWin: tie.framesToWin,
			playerLow: player(tie.playerLowId!),
			playerHigh: player(tie.playerHighId!)
		},
		correcting,
		canAct: permission.allowed && blockReason === null,
		reasonRequired: permission.allowed && !permission.isParticipant,
		isParticipant: permission.isParticipant,
		adminOverride: permission.allowed && !permission.isParticipant,
		blockReason,
		today: todayInLeague(db, new Date()),
		maxFrames: maxFramesForTarget(tie.framesToWin),
		existing
	};
}
