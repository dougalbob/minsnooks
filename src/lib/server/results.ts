/**
 * Result entry, opponent review and corrections (Phase 6).
 *
 * The state machine (HANDOFF §4 "Result submission and corrections"):
 *
 *   unplayed ──submit──► submitted ──opponent confirms──► confirmed
 *                            │                              │
 *                            └──opponent sends back──► sent_back
 *                                                            │
 *                                   submitter corrects ──────┘ (revision + 1)
 *
 *   confirmed ──admin correction (reason mandatory)──► confirmed (revision + 1)
 *   unplayed / closed ──super-admin direct or retrospective entry──► confirmed
 *
 * Invariants this module exists to protect:
 *
 *   * **only a confirmed result moves the standings.** A submission, a send-back
 *     or a resubmission never changes the table (`standings.ts` reads
 *     `status = 'confirmed'` only), and auto-advance waits for confirmation, not
 *     submission.
 *   * **a submitter can never confirm their own result** — not even an admin who
 *     submitted one. The opponent confirms the scoreline *and the actual date
 *     played* together.
 *   * **the actual played date is entered with the result.** `fixtures.booked_date`
 *     and the `bookings` plan are never read here: a planned date is a promise
 *     between two players, not proof a match was played.
 *   * **optional details are locked at first submission.** A player correction
 *     may fix the values submitted, but may not add frame-point detail or
 *     highest breaks afterwards; only an admin change, with a reason, may.
 *   * **extreme values prompt "is this correct?"** and are never hard-rejected:
 *     fouls can inflate a frame, so a 100–50 frame is plausible.
 *   * **every transition is audited** — who, what, when and why, with a
 *     before/after snapshot in `audit_log`.
 *
 * Permissions are provisional until the Phase 8 matrix is confirmed (PLAN §5
 * Q6): the two participants act on their own fixture, an admin may act for
 * support (audited as an override), and only a super-admin may enter a result
 * directly without opponent approval. Roles always come from the database, never
 * from a successful sign-in.
 */
import type { Db } from './db';
import {
	assertPlayedDateAllowed,
	confirmResult,
	loadFixtureResultFacts,
	recordAudit,
	sendBackResult,
	writeResultRow,
	type EntrySource,
	type FixtureResultFacts,
	type FrameWinner,
	type ResultStatus
} from './league';
import { localDateString } from './league-time';
import {
	assessResultForm,
	checkDetailsLock,
	type AssessedResultForm,
	type ResultFormValues
} from '../result-entry';
import type {
	FramePointsView,
	FrameWinnerView,
	ResultAuditView,
	ResultBreakView,
	ResultParty,
	ResultRecordView
} from '../result-view';

export type {
	FramePointsView,
	FrameWinnerView,
	ResultAuditView,
	ResultBreakView,
	ResultParty,
	ResultRecordView
};

export type PlayerRole = 'player' | 'admin' | 'super_admin';

/** Thrown when the actor is not allowed to make this result change. */
export class ResultPermissionError extends Error {}

/** Thrown when the entered result breaks a hard rule; carries every error. */
export class ResultValidationError extends Error {
	readonly errors: string[];

	constructor(errors: string[]) {
		super(errors.join(' '));
		this.name = 'ResultValidationError';
		this.errors = errors;
	}
}

/**
 * Thrown when the result is plausible but surprising: the player has to answer
 * "is this correct?" before it is saved. Never a rejection (HANDOFF §4).
 */
export class ResultNeedsConfirmationError extends Error {
	readonly warnings: string[];

	constructor(warnings: string[]) {
		super(warnings.join(' '));
		this.name = 'ResultNeedsConfirmationError';
		this.warnings = warnings;
	}
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

interface ResultRow {
	id: number;
	fixture_id: number;
	player_low_frames: number;
	player_high_frames: number;
	actual_played_date: string;
	status: ResultStatus;
	entry_source: EntrySource;
	submitted_by_player_id: number;
	submitted_at: string;
	confirmed_by_player_id: number | null;
	confirmed_at: string | null;
	corrected_by_player_id: number | null;
	corrected_at: string | null;
	correction_reason: string | null;
	sent_back_by_player_id: number | null;
	sent_back_at: string | null;
	send_back_reason: string | null;
	revision: number;
	details_locked_at: string | null;
}

function loadResultRow(db: Db, fixtureId: number): ResultRow | null {
	const row = db.prepare('SELECT * FROM results WHERE fixture_id = ?').get(fixtureId) as
		| ResultRow
		| undefined;
	return row ?? null;
}

export function loadPlayerRole(db: Db, playerId: number | null): PlayerRole | null {
	if (playerId == null) return null;
	const row = db.prepare('SELECT role FROM players WHERE id = ? AND is_active = 1').get(playerId) as
		| { role: PlayerRole }
		| undefined;
	return row?.role ?? null;
}

function loadParty(db: Db, playerId: number): ResultParty {
	const row = db
		.prepare('SELECT id, display_name, initials, avatar_tone FROM players WHERE id = ?')
		.get(playerId) as
		| { id: number; display_name: string; initials: string; avatar_tone: string }
		| undefined;
	return {
		playerId,
		name: row?.display_name ?? `Player ${playerId}`,
		initials: row?.initials ?? '??',
		tone: row?.avatar_tone ?? 'maya'
	};
}

function playerName(db: Db, playerId: number | null): string | null {
	if (playerId == null) return null;
	const row = db.prepare('SELECT display_name FROM players WHERE id = ?').get(playerId) as
		| { display_name: string }
		| undefined;
	return row?.display_name ?? null;
}

/** The full result record for a fixture, or null when it has none. */
export function loadResultRecord(db: Db, fixtureId: number): ResultRecordView | null {
	const facts = loadFixtureResultFacts(db, fixtureId);
	if (!facts) throw new Error(`Fixture ${fixtureId} does not exist.`);
	const row = loadResultRow(db, fixtureId);
	if (!row) return null;

	const low = loadParty(db, facts.playerLowId);
	const high = loadParty(db, facts.playerHighId);

	const frames = (
		db
			.prepare(
				'SELECT frame_number, player_low_points, player_high_points FROM result_frames WHERE result_id = ? ORDER BY frame_number'
			)
			.all(row.id) as Array<{
			frame_number: number;
			player_low_points: number;
			player_high_points: number;
		}>
	).map((frame) => ({
		frameNumber: frame.frame_number,
		lowPoints: frame.player_low_points,
		highPoints: frame.player_high_points
	}));

	const breaks = (
		db
			.prepare(
				`SELECT rb.player_id, rb.break_points, p.display_name
				 FROM result_breaks rb JOIN players p ON p.id = rb.player_id
				 WHERE rb.result_id = ? ORDER BY rb.break_points DESC`
			)
			.all(row.id) as Array<{ player_id: number; break_points: number; display_name: string }>
	).map((entry) => ({
		playerId: entry.player_id,
		playerName: entry.display_name,
		breakPoints: entry.break_points
	}));

	const winnerRows = db
		.prepare(
			`SELECT rfw.frame_number, rfw.player_id, p.display_name
			 FROM result_frame_winners rfw JOIN players p ON p.id = rfw.player_id
			 WHERE rfw.result_id = ? ORDER BY rfw.frame_number`
		)
		.all(row.id) as Array<{ frame_number: number; player_id: number; display_name: string }>;
	const pointsByFrame = new Map(frames.map((frame) => [frame.frameNumber, frame]));
	const frameWinners: FrameWinnerView[] = winnerRows.map((winner) => {
		const points = pointsByFrame.get(winner.frame_number);
		return {
			frameNumber: winner.frame_number,
			playerId: winner.player_id,
			playerName: winner.display_name,
			lowPoints: points?.lowPoints ?? null,
			highPoints: points?.highPoints ?? null
		};
	});

	const seasonLabel = (
		db.prepare('SELECT label FROM seasons WHERE id = ?').get(facts.seasonId) as
			| { label: string }
			| undefined
	)?.label ?? '';

	const lowWon = row.player_low_frames >= row.player_high_frames;
	const isAwardSource = Boolean(
		db.prepare('SELECT 1 FROM awards WHERE source_result_id = ?').get(row.id)
	);

	return {
		resultId: row.id,
		fixtureId,
		roundId: facts.roundId,
		roundNumber: facts.roundNumber,
		seasonLabel,
		status: row.status,
		entrySource: row.entry_source,
		revision: row.revision,
		low,
		high,
		lowFrames: row.player_low_frames,
		highFrames: row.player_high_frames,
		winner: lowWon ? low : high,
		loser: lowWon ? high : low,
		winnerFrames: lowWon ? row.player_low_frames : row.player_high_frames,
		loserFrames: lowWon ? row.player_high_frames : row.player_low_frames,
		actualPlayedDate: row.actual_played_date,
		submittedByPlayerId: row.submitted_by_player_id,
		submittedByName: playerName(db, row.submitted_by_player_id) ?? 'a player',
		submittedAt: row.submitted_at,
		confirmedByPlayerId: row.confirmed_by_player_id,
		confirmedByName: playerName(db, row.confirmed_by_player_id),
		confirmedAt: row.confirmed_at,
		correctedByPlayerId: row.corrected_by_player_id,
		correctedByName: playerName(db, row.corrected_by_player_id),
		correctedAt: row.corrected_at,
		correctionReason: row.correction_reason,
		sentBackByPlayerId: row.sent_back_by_player_id,
		sentBackByName: playerName(db, row.sent_back_by_player_id),
		sentBackAt: row.sent_back_at,
		sendBackReason: row.send_back_reason,
		detailsLockedAt: row.details_locked_at,
		frameWinners,
		frames,
		breaks,
		hasFramePoints: frames.length > 0,
		hasBreaks: breaks.length > 0,
		isAwardSource
	};
}

/**
 * The append-only history of one result: who changed what, when and why.
 *
 * Oldest first, because this is the story of a single result (submitted → sent
 * back → resubmitted → confirmed) and the screens render it as an ordered list.
 * The league-wide feed (`loadResultActivity`) is the reverse: newest first.
 */
export function loadResultAudit(db: Db, resultId: number): ResultAuditView[] {
	const rows = db
		.prepare(
			`SELECT a.id, a.action, a.actor_player_id, p.display_name AS actor_name, a.reason,
				a.detail, a.created_at
			 FROM audit_log a LEFT JOIN players p ON p.id = a.actor_player_id
			 WHERE a.entity_type = 'result' AND a.entity_id = ?
			 ORDER BY a.id ASC`
		)
		.all(resultId) as Array<{
		id: number;
		action: string;
		actor_player_id: number | null;
		actor_name: string | null;
		reason: string | null;
		detail: string | null;
		created_at: string;
	}>;
	return rows.map((row) => {
		let detail: unknown = null;
		try {
			detail = row.detail === null ? null : JSON.parse(row.detail);
		} catch {
			// A malformed historic detail snapshot must not break the history view.
			detail = row.detail;
		}
		return {
			id: row.id,
			action: row.action,
			actorPlayerId: row.actor_player_id,
			actorName: row.actor_name,
			reason: row.reason,
			detail,
			createdAt: row.created_at
		};
	});
}

/* ------------------------------------------------------------------ *
 * Permissions (provisional until the Phase 8 matrix is confirmed)
 * ------------------------------------------------------------------ */

export interface ResultPermissions {
	viewerPlayerId: number | null;
	role: PlayerRole | null;
	isParticipant: boolean;
	isSubmitter: boolean;
	/** The participant who did not submit — the reviewer. */
	isReviewingOpponent: boolean;
	isAdmin: boolean;
	isSuperAdmin: boolean;
	canSubmit: boolean;
	submitReason: string | null;
	canResubmit: boolean;
	resubmitReason: string | null;
	canEnterDirectly: boolean;
	directReason: string | null;
	canReview: boolean;
	reviewReason: string | null;
	canCorrect: boolean;
	correctReason: string | null;
	canRecordRetrospective: boolean;
	retrospectiveReason: string | null;
	/** True when the viewer would be acting as an admin rather than a player. */
	adminOverride: boolean;
	/** Names used in the refusal copy, so the UI can say why, not just hide. */
	submitterName: string | null;
	opponentName: string | null;
}

/**
 * Who may do what with this fixture's result, right now.
 *
 * Every rule is evaluated from the database (role, fixture state, result status)
 * so the UI and the write paths can never disagree — the write paths re-check
 * before they touch anything.
 */
export function resultPermissions(
	db: Db,
	fixtureId: number,
	viewerPlayerId: number | null
): ResultPermissions {
	const facts = loadFixtureResultFacts(db, fixtureId);
	if (!facts) throw new Error(`Fixture ${fixtureId} does not exist.`);
	const row = loadResultRow(db, fixtureId);

	const role = loadPlayerRole(db, viewerPlayerId);
	const isAdmin = role === 'admin' || role === 'super_admin';
	const isSuperAdmin = role === 'super_admin';
	const isParticipant =
		viewerPlayerId !== null &&
		(viewerPlayerId === facts.playerLowId || viewerPlayerId === facts.playerHighId);
	const isSubmitter = row !== null && viewerPlayerId === row.submitted_by_player_id;
	const isReviewingOpponent = row !== null && isParticipant && !isSubmitter;

	const submitterName = row ? playerName(db, row.submitted_by_player_id) : null;
	const opponentName =
		viewerPlayerId === null
			? null
			: playerName(
					db,
					viewerPlayerId === facts.playerLowId ? facts.playerHighId : facts.playerLowId
				);

	const signedOutReason = 'Sign in as one of the two players to record this result.';
	const outsiderReason = 'Only the two players in this fixture (or an admin) can record this result.';
	const noIdentity = viewerPlayerId === null;
	const mayAct = isParticipant || isAdmin;

	const base = {
		viewerPlayerId,
		role,
		isParticipant,
		isSubmitter,
		isReviewingOpponent,
		isAdmin,
		isSuperAdmin,
		submitterName,
		opponentName,
		adminOverride: false
	};

	if (facts.state === 'awarded') {
		return {
			...base,
			canSubmit: false,
			submitReason: 'This fixture was resolved by an administrative award, so no result can be recorded.',
			canResubmit: false,
			resubmitReason: null,
			canEnterDirectly: false,
			directReason: null,
			canReview: false,
			reviewReason: null,
			canCorrect: false,
			correctReason: null,
			canRecordRetrospective: false,
			retrospectiveReason: null
		};
	}

	/* ---- record a new result (fixture still unplayed) ---- */
	let canSubmit = false;
	let submitReason: string | null = null;
	if (facts.state !== 'unplayed' || row !== null) {
		submitReason =
			facts.state === 'confirmed'
				? 'This result is confirmed. Only an admin can change it now.'
				: facts.state === 'closed_unplayed'
					? 'This fixture closed neutrally after the deadline and grace period. Only an admin can record a genuine retrospective result for it.'
					: row?.status === 'sent_back'
						? 'This result was sent back for correction — correct and resubmit it.'
						: `This result is waiting for ${opponentName ?? 'the other player'} to review it.`;
	} else if (noIdentity) {
		submitReason = signedOutReason;
	} else if (!mayAct) {
		submitReason = outsiderReason;
	} else if (facts.roundStatus !== 'open' && !isAdmin) {
		submitReason = `Round ${facts.roundNumber} is closed, so it no longer accepts player submissions.`;
	} else {
		canSubmit = true;
	}

	/* ---- correct a sent-back result and resubmit ---- */
	let canResubmit = false;
	let resubmitReason: string | null = null;
	if (row?.status === 'sent_back') {
		if (noIdentity) {
			resubmitReason = signedOutReason;
		} else if (isSubmitter) {
			canResubmit = true;
		} else if (isAdmin) {
			canResubmit = true;
		} else {
			resubmitReason = `Only ${submitterName ?? 'the player who submitted it'} (or an admin) can correct this result.`;
		}
	}

	/* ---- super-admin direct entry, no opponent approval ---- */
	let canEnterDirectly = false;
	let directReason: string | null = null;
	if (isSuperAdmin && (facts.state === 'unplayed' || facts.state === 'awaiting_confirmation')) {
		canEnterDirectly = true;
	} else if (!isSuperAdmin) {
		directReason = 'Only a super-admin can enter a result without the opponent’s approval.';
	}

	/* ---- opponent review: confirm or send back ---- */
	let canReview = false;
	let reviewReason: string | null = null;
	if (row?.status !== 'submitted') {
		reviewReason =
			row === null
				? 'There is no submitted result to review yet.'
				: row.status === 'confirmed'
					? 'This result is already confirmed.'
					: 'This result was sent back and is waiting for a corrected submission.';
	} else if (noIdentity) {
		reviewReason = 'Sign in as the other player to review this result.';
	} else if (isSubmitter) {
		reviewReason = `You submitted this result, so ${opponentName ?? 'your opponent'} has to confirm it. Nobody can confirm their own submission.`;
	} else if (isReviewingOpponent) {
		canReview = true;
	} else if (isAdmin) {
		canReview = true;
	} else {
		reviewReason = `Only ${opponentName ?? 'the other player'} (or an admin) can review this result.`;
	}

	/* ---- admin change of a confirmed result ---- */
	let canCorrect = false;
	let correctReason: string | null = null;
	if (row?.status !== 'confirmed') {
		correctReason =
			row === null
				? 'There is no confirmed result to correct.'
				: 'Only a confirmed result can be corrected by an admin.';
	} else if (isAdmin) {
		canCorrect = true;
	} else {
		correctReason = 'After approval only an admin can change a result.';
	}

	/* ---- admin retrospective result for a neutrally closed fixture ---- */
	let canRecordRetrospective = false;
	let retrospectiveReason: string | null = null;
	if (facts.state !== 'closed_unplayed') {
		retrospectiveReason = 'Only a neutrally closed fixture takes a retrospective result.';
	} else if (isAdmin) {
		canRecordRetrospective = true;
	} else {
		retrospectiveReason = noIdentity
			? signedOutReason
			: 'Only an admin can record a retrospective result for a closed fixture.';
	}

	return {
		...base,
		adminOverride: isAdmin && !isParticipant,
		canSubmit,
		submitReason,
		canResubmit,
		resubmitReason,
		canEnterDirectly,
		directReason,
		canReview,
		reviewReason,
		canCorrect,
		correctReason,
		canRecordRetrospective,
		retrospectiveReason
	};
}

/* ------------------------------------------------------------------ *
 * Shared write plumbing
 * ------------------------------------------------------------------ */

interface ResultContext {
	facts: FixtureResultFacts;
	low: ResultParty;
	high: ResultParty;
	role: PlayerRole | null;
	today: string;
}

function loadContext(db: Db, fixtureId: number, actorPlayerId: number, now: Date): ResultContext {
	const facts = loadFixtureResultFacts(db, fixtureId);
	if (!facts) throw new Error(`Fixture ${fixtureId} does not exist.`);
	return {
		facts,
		low: loadParty(db, facts.playerLowId),
		high: loadParty(db, facts.playerHighId),
		role: loadPlayerRole(db, actorPlayerId),
		today: localDateString(now, facts.timezone)
	};
}

function actorIsAdmin(role: PlayerRole | null): boolean {
	return role === 'admin' || role === 'super_admin';
}

/**
 * Assess the entered form against the season's scoring rules. Hard rule breaks
 * are thrown; soft "is this correct?" warnings are returned and gated by
 * `requireAcknowledged` *after* the date/window checks, so a player always sees
 * the real blocking problem first.
 */
function assess(context: ResultContext, values: ResultFormValues): AssessedResultForm {
	const assessed = assessResultForm(values, {
		framesPerMatch: context.facts.framesPerMatch,
		lowPlayerId: context.facts.playerLowId,
		highPlayerId: context.facts.playerHighId,
		lowPlayerName: context.low.name,
		highPlayerName: context.high.name,
		today: context.today
	});
	if (!assessed.ok) throw new ResultValidationError(assessed.errors);
	return assessed;
}

/**
 * Extreme but plausible input prompts "is this correct?" and is never rejected
 * outright (HANDOFF §4): the player has to say yes, they checked.
 */
function requireAcknowledged(assessed: AssessedResultForm, ackWarnings: boolean): void {
	if (assessed.warnings.length > 0 && !ackWarnings) {
		throw new ResultNeedsConfirmationError(assessed.warnings);
	}
}

/** The frame-by-frame winner rows that match the assessed form. */
function frameWinnersFrom(
	context: ResultContext,
	assessed: AssessedResultForm
): FrameWinner[] {
	return assessed.frameWinners.map((choice, index) => ({
		frameNumber: index + 1,
		playerId: choice === 'low' ? context.facts.playerLowId : context.facts.playerHighId
	}));
}

function normaliseReason(reason: string | null | undefined, limit = 300): string {
	const trimmed = (reason ?? '').trim();
	if (trimmed.length < 3) {
		throw new ResultValidationError([
			'A reason is required for this change, so the audit record says why.'
		]);
	}
	if (trimmed.length > limit) {
		throw new ResultValidationError([`Keep the reason under ${limit} characters.`]);
	}
	return trimmed;
}

function resultSnapshot(row: ResultRow | null, frames: FramePointsView[]): unknown {
	if (!row) return null;
	return {
		status: row.status,
		revision: row.revision,
		actualPlayedDate: row.actual_played_date,
		frames: [row.player_low_frames, row.player_high_frames],
		framePoints: frames.map((frame) => [frame.lowPoints, frame.highPoints])
	};
}

export type ResultWriteMode =
	| 'submitted'
	| 'resubmitted'
	| 'direct'
	| 'retrospective'
	| 'confirmed'
	| 'sent_back'
	| 'corrected';

export interface ResultWriteOutcome {
	resultId: number;
	status: ResultStatus;
	revision: number;
	mode: ResultWriteMode;
	warnings: string[];
	/** Set when an admin correction changed a result an award depends on. */
	awardReviewNeeded: boolean;
}

/* ------------------------------------------------------------------ *
 * Submit / resubmit / direct entry
 * ------------------------------------------------------------------ */

export interface SubmitResultInput {
	fixtureId: number;
	actorPlayerId: number;
	values: ResultFormValues;
	/**
	 * Super-admin direct entry: confirmed immediately, no opponent approval,
	 * reason mandatory (HANDOFF §4).
	 */
	direct?: boolean;
	/** Mandatory for every admin write. */
	reason?: string | null;
	/** The player answered "is this correct?" to the soft warnings. */
	ackWarnings?: boolean;
}

/**
 * Record a league result.
 *
 * A participant's submission lands as `submitted` and does **not** move the
 * table; the opponent has to confirm the scoreline and the actual date played.
 * A sent-back result is corrected and resubmitted here (revision + 1). A
 * super-admin may enter a result directly, and an admin may record a genuine
 * retrospective result for a neutrally closed fixture — both are confirmed
 * immediately, with a mandatory reason and an audit entry.
 */
export function submitResult(
	db: Db,
	input: SubmitResultInput,
	options: { now?: Date } = {}
): ResultWriteOutcome {
	const now = options.now ?? new Date();

	return db.transaction((): ResultWriteOutcome => {
		const context = loadContext(db, input.fixtureId, input.actorPlayerId, now);
		const { facts, role } = context;
		const existing = loadResultRow(db, input.fixtureId);
		const permissions = resultPermissions(db, input.fixtureId, input.actorPlayerId);
		const admin = actorIsAdmin(role);
		const direct = Boolean(input.direct);

		if (direct && role !== 'super_admin') {
			throw new ResultPermissionError(
				'Only a super-admin can enter a result without the opponent’s approval.'
			);
		}
		const assessed = assess(context, input.values);
		assertPlayedDateAllowed(facts, assessed.actualPlayedDate, now);
		requireAcknowledged(assessed, Boolean(input.ackWarnings));

		/* ---- resubmission after a send-back ---- */
		if (existing && existing.status === 'sent_back') {
			if (!permissions.canResubmit) {
				throw new ResultPermissionError(
					permissions.resubmitReason ?? 'You cannot correct this result.'
				);
			}
			const adminChange = admin && input.actorPlayerId !== existing.submitted_by_player_id;
			const lockErrors = checkDetailsLock({
				original: {
					hasFramePoints: countRows(db, 'result_frames', existing.id) > 0,
					hasBreaks: countRows(db, 'result_breaks', existing.id) > 0
				},
				proposed: {
					hasFramePoints: assessed.hasFramePoints,
					hasBreaks: assessed.hasBreaks
				},
				isAdminChange: adminChange
			});
			if (lockErrors.length > 0) throw new ResultValidationError(lockErrors);
			const reason = adminChange ? normaliseReason(input.reason) : (input.reason ?? '').trim() || null;

			const resultId = writeResultRow(db, {
				fixtureId: facts.fixtureId,
				lowFrames: assessed.lowFrames,
				highFrames: assessed.highFrames,
				actualPlayedDate: assessed.actualPlayedDate,
				status: 'submitted',
				entrySource: existing.entry_source,
				submittedByPlayerId: existing.submitted_by_player_id,
				submittedAt: now.toISOString(),
				confirmedByPlayerId: null,
				confirmedAt: null,
				correctedByPlayerId: null,
				correctedAt: null,
				correctionReason: null,
				sentBackByPlayerId: null,
				sentBackAt: null,
				sendBackReason: null,
				revision: existing.revision + 1,
				frames: assessed.frames,
				breaks: assessed.breaks,
				frameWinners: frameWinnersFrom(context, assessed)
			});
			recordAudit(db, {
				entityType: 'result',
				entityId: resultId,
				action: 'resubmitted',
				actorPlayerId: input.actorPlayerId,
				reason,
				detail: {
					fixtureId: facts.fixtureId,
					roundId: facts.roundId,
					revision: existing.revision + 1,
					actualPlayedDate: assessed.actualPlayedDate,
					frames: [assessed.lowFrames, assessed.highFrames],
					frameWinners: frameWinnersFrom(context, assessed).map((winner) => winner.playerId),
					adminOverride: adminChange,
					before: resultSnapshot(existing, [])
				}
			});
			return {
				resultId,
				status: 'submitted',
				revision: existing.revision + 1,
				mode: 'resubmitted',
				warnings: assessed.warnings,
				awardReviewNeeded: false
			};
		}

		/* ---- a submitted result is waiting for review ---- */
		if (existing && existing.status === 'submitted' && !direct) {
			throw new ResultPermissionError(
				`This result is waiting for ${permissions.opponentName ?? 'the other player'} to review it. They can confirm it or send it back.`
			);
		}
		if (existing && existing.status === 'confirmed' && !direct) {
			throw new ResultPermissionError(
				'This result is confirmed. After approval only an admin can change it — use the correction form.'
			);
		}

		/* ---- a neutrally closed fixture: admin retrospective only ---- */
		if (facts.state === 'closed_unplayed') {
			if (!admin) {
				throw new ResultPermissionError(
					'This fixture closed neutrally. Only an admin can record a genuine retrospective result for it.'
				);
			}
			const reason = normaliseReason(input.reason);
			const resultId = writeResultRow(db, {
				fixtureId: facts.fixtureId,
				lowFrames: assessed.lowFrames,
				highFrames: assessed.highFrames,
				actualPlayedDate: assessed.actualPlayedDate,
				status: 'confirmed',
				entrySource: 'admin_retrospective',
				submittedByPlayerId: input.actorPlayerId,
				submittedAt: now.toISOString(),
				confirmedByPlayerId: input.actorPlayerId,
				confirmedAt: now.toISOString(),
				revision: (existing?.revision ?? 0) + 1,
				frames: assessed.frames,
				breaks: assessed.breaks,
				frameWinners: frameWinnersFrom(context, assessed)
			});
			recordAudit(db, {
				entityType: 'result',
				entityId: resultId,
				action: 'retrospective_recorded',
				actorPlayerId: input.actorPlayerId,
				reason,
				detail: {
					fixtureId: facts.fixtureId,
					roundId: facts.roundId,
					actualPlayedDate: assessed.actualPlayedDate,
					frames: [assessed.lowFrames, assessed.highFrames],
					before: resultSnapshot(existing, [])
				}
			});
			return {
				resultId,
				status: 'confirmed',
				revision: (existing?.revision ?? 0) + 1,
				mode: 'retrospective',
				warnings: assessed.warnings,
				awardReviewNeeded: false
			};
		}

		if (facts.state === 'awarded') {
			throw new ResultPermissionError(
				'This fixture was resolved by an administrative award, so no result can be recorded against it.'
			);
		}

		/* ---- a new submission, or a super-admin direct entry ---- */
		if (!existing && !permissions.canSubmit && !direct) {
			throw new ResultPermissionError(permissions.submitReason ?? 'You cannot record this result.');
		}
		if (facts.roundStatus !== 'open' && !direct && !admin) {
			throw new ResultPermissionError(
				`Round ${facts.roundNumber} is closed, so it no longer accepts player submissions.`
			);
		}

		const entrySource: EntrySource = direct ? 'admin_direct' : 'player';
		const status: ResultStatus = direct ? 'confirmed' : 'submitted';
		// A direct entry skips the opponent's check, so the reason carries the
		// justification into the audit trail.
		const reason = direct ? normaliseReason(input.reason) : (input.reason ?? '').trim() || null;
		const revision = existing ? existing.revision + 1 : 1;
		const resultId = writeResultRow(db, {
			fixtureId: facts.fixtureId,
			lowFrames: assessed.lowFrames,
			highFrames: assessed.highFrames,
			actualPlayedDate: assessed.actualPlayedDate,
			status,
			entrySource,
			submittedByPlayerId: input.actorPlayerId,
			submittedAt: now.toISOString(),
			confirmedByPlayerId: direct ? input.actorPlayerId : null,
			confirmedAt: direct ? now.toISOString() : null,
			revision,
			frames: assessed.frames,
			breaks: assessed.breaks,
			frameWinners: frameWinnersFrom(context, assessed)
		});
		recordAudit(db, {
			entityType: 'result',
			entityId: resultId,
			action: direct ? 'direct_entry' : 'submitted',
			actorPlayerId: input.actorPlayerId,
			reason,
			detail: {
				fixtureId: facts.fixtureId,
				roundId: facts.roundId,
				revision,
				actualPlayedDate: assessed.actualPlayedDate,
				frames: [assessed.lowFrames, assessed.highFrames],
				frameWinners: frameWinnersFrom(context, assessed).map((winner) => winner.playerId),
				framePoints: assessed.frames.map((frame) => [frame.lowPoints, frame.highPoints]),
				breaks: assessed.breaks,
				adminOverride: permissions.adminOverride || direct,
				warnings: assessed.warnings,
				before: resultSnapshot(existing, [])
			}
		});
		return {
			resultId,
			status,
			revision,
			mode: direct ? 'direct' : 'submitted',
			warnings: assessed.warnings,
			awardReviewNeeded: false
		};
	})();
}

/* ------------------------------------------------------------------ *
 * Opponent review
 * ------------------------------------------------------------------ */

export type ReviewDecision = 'confirm' | 'send_back';

export interface ReviewResultInput {
	fixtureId: number;
	actorPlayerId: number;
	decision: ReviewDecision;
	/** What the submitter should check; shown to them with the send-back. */
	reason?: string | null;
}

/**
 * The opponent's decision on a submitted result: confirm the scoreline **and
 * the actual date played** together, or send it back for correction.
 *
 * Confirmation is the only thing that moves the table. A submitter can never
 * confirm their own result — not even an admin who submitted one.
 */
export function reviewResult(
	db: Db,
	input: ReviewResultInput,
	options: { now?: Date } = {}
): ResultWriteOutcome {
	const now = options.now ?? new Date();

	return db.transaction((): ResultWriteOutcome => {
		const context = loadContext(db, input.fixtureId, input.actorPlayerId, now);
		const existing = loadResultRow(db, input.fixtureId);
		if (!existing) throw new Error('There is no result to review for this fixture.');
		if (existing.status !== 'submitted') {
			throw new ResultPermissionError(
				existing.status === 'confirmed'
					? 'This result is already confirmed.'
					: 'This result was sent back and is waiting for a corrected submission.'
			);
		}
		const permissions = resultPermissions(db, input.fixtureId, input.actorPlayerId);
		if (!permissions.canReview) {
			throw new ResultPermissionError(permissions.reviewReason ?? 'You cannot review this result.');
		}
		const adminOverride = !permissions.isReviewingOpponent;
		const frames = loadFrameDetails(db, existing.id);

		if (input.decision === 'confirm') {
			confirmResult(db, existing.id, input.actorPlayerId, { confirmedAt: now.toISOString() });
			recordAudit(db, {
				entityType: 'result',
				entityId: existing.id,
				action: 'confirmed',
				actorPlayerId: input.actorPlayerId,
				detail: {
					fixtureId: input.fixtureId,
					roundId: context.facts.roundId,
					revision: existing.revision,
					actualPlayedDate: existing.actual_played_date,
					frames: [existing.player_low_frames, existing.player_high_frames],
					adminOverride
				}
			});
			return {
				resultId: existing.id,
				status: 'confirmed',
				revision: existing.revision,
				mode: 'confirmed',
				warnings: [],
				awardReviewNeeded: false
			};
		}

		const reason = (input.reason ?? '').trim();
		if (reason.length > 300) {
			throw new ResultValidationError(['Keep the note under 300 characters.']);
		}
		sendBackResult(db, existing.id, {
			actorPlayerId: input.actorPlayerId,
			reason: reason || null,
			sentBackAt: now.toISOString()
		});
		recordAudit(db, {
			entityType: 'result',
			entityId: existing.id,
			action: 'sent_back',
			actorPlayerId: input.actorPlayerId,
			reason: reason || null,
			detail: {
				fixtureId: input.fixtureId,
				roundId: context.facts.roundId,
				revision: existing.revision,
				actualPlayedDate: existing.actual_played_date,
				frames: [existing.player_low_frames, existing.player_high_frames],
				framePoints: frames.map((frame) => [frame.lowPoints, frame.highPoints]),
				adminOverride
			}
		});
		return {
			resultId: existing.id,
			status: 'sent_back',
			revision: existing.revision,
			mode: 'sent_back',
			warnings: [],
			awardReviewNeeded: false
		};
	})();
}

/* ------------------------------------------------------------------ *
 * Post-approval corrections
 * ------------------------------------------------------------------ */

export interface CorrectResultInput {
	fixtureId: number;
	actorPlayerId: number;
	values: ResultFormValues;
	/** Mandatory after approval (PLAN §5 Q6 provisional default). */
	reason: string | null;
	ackWarnings?: boolean;
}

/**
 * An admin changes an approved result. The reason is mandatory, the original
 * confirmation is preserved (the opponent approved the earlier version), the
 * revision increases, and the audit trail records the before/after snapshot.
 *
 * If an administrative award takes its value from this result, the change is
 * flagged for review rather than silently rewriting a later table — Phase 7
 * turns that flag into the award review flow.
 */
export function correctResult(
	db: Db,
	input: CorrectResultInput,
	options: { now?: Date } = {}
): ResultWriteOutcome {
	const now = options.now ?? new Date();

	return db.transaction((): ResultWriteOutcome => {
		const context = loadContext(db, input.fixtureId, input.actorPlayerId, now);
		const { facts, role } = context;
		const existing = loadResultRow(db, input.fixtureId);
		if (!existing) throw new Error('There is no result to correct for this fixture.');
		if (existing.status !== 'confirmed') {
			throw new ResultPermissionError(
				'Only a confirmed result can be corrected here. A submitted result goes back to the players.'
			);
		}
		if (!actorIsAdmin(role)) {
			throw new ResultPermissionError('After approval only an admin can change a result.');
		}

		const reason = normaliseReason(input.reason);
		const assessed = assess(context, input.values);
		assertPlayedDateAllowed(facts, assessed.actualPlayedDate, now);
		requireAcknowledged(assessed, Boolean(input.ackWarnings));

		const beforeFrames = loadFrameDetails(db, existing.id);
		const beforeBreaks = loadBreakDetails(db, existing.id);
		const revision = existing.revision + 1;
		const resultId = writeResultRow(db, {
			fixtureId: facts.fixtureId,
			lowFrames: assessed.lowFrames,
			highFrames: assessed.highFrames,
			actualPlayedDate: assessed.actualPlayedDate,
			status: 'confirmed',
			entrySource: existing.entry_source,
			submittedByPlayerId: existing.submitted_by_player_id,
			submittedAt: existing.submitted_at,
			// The original approval stays on record: the opponent confirmed the
			// earlier version, and this change is an admin correction of it.
			confirmedByPlayerId: existing.confirmed_by_player_id,
			confirmedAt: existing.confirmed_at,
			correctedByPlayerId: input.actorPlayerId,
			correctedAt: now.toISOString(),
			correctionReason: reason,
			revision,
			frames: assessed.frames,
			breaks: assessed.breaks,
			frameWinners: frameWinnersFrom(context, assessed)
		});

		recordAudit(db, {
			entityType: 'result',
			entityId: resultId,
			action: 'corrected',
			actorPlayerId: input.actorPlayerId,
			reason,
			detail: {
				fixtureId: facts.fixtureId,
				roundId: facts.roundId,
				revision,
				before: {
					actualPlayedDate: existing.actual_played_date,
					frames: [existing.player_low_frames, existing.player_high_frames],
					framePoints: beforeFrames.map((frame) => [frame.lowPoints, frame.highPoints]),
					breaks: beforeBreaks
				},
				after: {
					actualPlayedDate: assessed.actualPlayedDate,
					frames: [assessed.lowFrames, assessed.highFrames],
					framePoints: assessed.frames.map((frame) => [frame.lowPoints, frame.highPoints]),
					breaks: assessed.breaks,
					frameWinners: frameWinnersFrom(context, assessed).map((winner) => winner.playerId)
				},
				warnings: assessed.warnings
			}
		});

		// A corrected source result must flag dependent awards for review instead
		// of silently rewriting a later table (HANDOFF §4; the award review flag
		// itself is Phase 7).
		const dependentAwards = db
			.prepare('SELECT id, player_id, table_points FROM awards WHERE source_result_id = ?')
			.all(resultId) as Array<{ id: number; player_id: number; table_points: number }>;
		let awardReviewNeeded = false;
		if (dependentAwards.length > 0) {
			awardReviewNeeded = true;
			recordAudit(db, {
				entityType: 'result',
				entityId: resultId,
				action: 'award_review_needed',
				actorPlayerId: input.actorPlayerId,
				reason: 'A source result was corrected; dependent administrative awards need review.',
				detail: { fixtureId: facts.fixtureId, awards: dependentAwards }
			});
		}

		return {
			resultId,
			status: 'confirmed',
			revision,
			mode: 'corrected',
			warnings: assessed.warnings,
			awardReviewNeeded
		};
	})();
}

function countRows(db: Db, table: 'result_frames' | 'result_breaks', resultId: number): number {
	const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE result_id = ?`).get(resultId) as {
		count: number;
	};
	return row.count;
}

function loadFrameDetails(db: Db, resultId: number): FramePointsView[] {
	return (
		db
			.prepare(
				'SELECT frame_number, player_low_points, player_high_points FROM result_frames WHERE result_id = ? ORDER BY frame_number'
			)
			.all(resultId) as Array<{
			frame_number: number;
			player_low_points: number;
			player_high_points: number;
		}>
	).map((frame) => ({
		frameNumber: frame.frame_number,
		lowPoints: frame.player_low_points,
		highPoints: frame.player_high_points
	}));
}

function loadBreakDetails(db: Db, resultId: number): ResultBreakView[] {
	return (
		db
			.prepare(
				`SELECT rb.player_id, rb.break_points, p.display_name
				 FROM result_breaks rb JOIN players p ON p.id = rb.player_id
				 WHERE rb.result_id = ? ORDER BY rb.break_points DESC`
			)
			.all(resultId) as Array<{ player_id: number; break_points: number; display_name: string }>
	).map((entry) => ({
		playerId: entry.player_id,
		playerName: entry.display_name,
		breakPoints: entry.break_points
	}));
}

/* ------------------------------------------------------------------ *
 * Review queue and activity (admin surfaces)
 * ------------------------------------------------------------------ */

export interface AwaitingReviewItem {
	fixtureId: number;
	resultId: number;
	roundNumber: number;
	roundStatus: 'open' | 'closed';
	seasonLabel: string;
	low: ResultParty;
	high: ResultParty;
	lowFrames: number;
	highFrames: number;
	actualPlayedDate: string;
	submittedByName: string;
	submittedAt: string;
	reviewerName: string;
	/** Whether the viewer is the player who has to review this submission. */
	needsMyReview: boolean;
	canReview: boolean;
	revision: number;
}

/**
 * Every submitted result waiting for an opponent, newest first. This is the
 * queue an admin watches and the "needs your review" list a player sees.
 */
export function loadAwaitingReview(
	db: Db,
	options: { viewerPlayerId: number | null; limit?: number }
): AwaitingReviewItem[] {
	const rows = db
		.prepare(
			`SELECT r.id AS result_id, r.fixture_id, r.player_low_frames, r.player_high_frames,
				r.actual_played_date, r.submitted_by_player_id, r.submitted_at, r.revision,
				ro.number AS round_number, ro.status AS round_status, s.label AS season_label,
				f.player_low_id, f.player_high_id
			 FROM results r
			 JOIN fixtures f ON f.id = r.fixture_id
			 JOIN rounds ro ON ro.id = f.round_id
			 JOIN seasons s ON s.id = ro.season_id
			 WHERE r.status = 'submitted'
			 ORDER BY r.submitted_at DESC, r.id DESC
			 LIMIT ?`
		)
		.all(options.limit ?? 100) as Array<{
		result_id: number;
		fixture_id: number;
		player_low_frames: number;
		player_high_frames: number;
		actual_played_date: string;
		submitted_by_player_id: number;
		submitted_at: string;
		revision: number;
		round_number: number;
		round_status: 'open' | 'closed';
		season_label: string;
		player_low_id: number;
		player_high_id: number;
	}>;

	return rows.map((row) => {
		const reviewerId =
			row.player_low_id === row.submitted_by_player_id ? row.player_high_id : row.player_low_id;
		return {
			fixtureId: row.fixture_id,
			resultId: row.result_id,
			roundNumber: row.round_number,
			roundStatus: row.round_status,
			seasonLabel: row.season_label,
			low: loadParty(db, row.player_low_id),
			high: loadParty(db, row.player_high_id),
			lowFrames: row.player_low_frames,
			highFrames: row.player_high_frames,
			actualPlayedDate: row.actual_played_date,
			submittedByName: playerName(db, row.submitted_by_player_id) ?? 'a player',
			submittedAt: row.submitted_at,
			reviewerName: playerName(db, reviewerId) ?? 'the other player',
			needsMyReview: options.viewerPlayerId !== null && options.viewerPlayerId === reviewerId,
			canReview:
				options.viewerPlayerId !== null &&
				resultPermissions(db, row.fixture_id, options.viewerPlayerId).canReview,
			revision: row.revision
		};
	});
}

export interface ResultActivityItem {
	id: number;
	fixtureId: number;
	resultId: number;
	action: string;
	actorName: string | null;
	reason: string | null;
	createdAt: string;
	roundNumber: number | null;
	players: string;
	actualPlayedDate: string | null;
	frames: string | null;
}

/** The league-wide result audit feed, newest first: submissions, reviews and corrections. */
export function loadResultActivity(db: Db, limit = 25): ResultActivityItem[] {
	const rows = db
		.prepare(
			`SELECT a.id, a.entity_id AS result_id, a.action, a.reason, a.created_at, a.detail,
				p.display_name AS actor_name,
				r.fixture_id, r.actual_played_date, r.player_low_frames, r.player_high_frames,
				ro.number AS round_number,
				low.display_name AS low_name, high.display_name AS high_name
			 FROM audit_log a
			 LEFT JOIN players p ON p.id = a.actor_player_id
			 LEFT JOIN results r ON r.id = a.entity_id
			 LEFT JOIN fixtures f ON f.id = r.fixture_id
			 LEFT JOIN rounds ro ON ro.id = f.round_id
			 LEFT JOIN players low ON low.id = f.player_low_id
			 LEFT JOIN players high ON high.id = f.player_high_id
			 WHERE a.entity_type = 'result'
			 ORDER BY a.id DESC
			 LIMIT ?`
		)
		.all(limit) as Array<{
		id: number;
		result_id: number;
		action: string;
		reason: string | null;
		created_at: string;
		detail: string | null;
		actor_name: string | null;
		fixture_id: number | null;
		actual_played_date: string | null;
		player_low_frames: number | null;
		player_high_frames: number | null;
		round_number: number | null;
		low_name: string | null;
		high_name: string | null;
	}>;

	return rows.map((row) => ({
		id: row.id,
		fixtureId: row.fixture_id ?? 0,
		resultId: row.result_id,
		action: row.action,
		actorName: row.actor_name,
		reason: row.reason,
		createdAt: row.created_at,
		roundNumber: row.round_number,
		players:
			row.low_name && row.high_name ? `${row.low_name} v ${row.high_name}` : 'Result no longer present',
		actualPlayedDate: row.actual_played_date,
		frames:
			row.player_low_frames === null || row.player_high_frames === null
				? null
				: `${row.player_low_frames}–${row.player_high_frames}`
	}));
}
