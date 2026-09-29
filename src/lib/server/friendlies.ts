/**
 * Friendlies — scheduling, results, corrections and expiry (Phase 10).
 *
 * The shape (HANDOFF §5, Q3 decided 2026-09-29):
 *
 *   scheduled plan ──record──► saved result ──correct──► saved result (revision + 1)
 *        │                                                        ▲
 *        │ five days after the scheduled date,                    │ either participant,
 *        │ when no result exists                                  │ or an admin override
 *        ▼                                                        │ (audited; reason
 *     removed                                              mandatory for the override)
 *
 * Invariants this module exists to protect:
 *
 *   * **registered players only**: both sides of a friendly must be active
 *     player rows, and never the same player twice;
 *   * **flexible counts, draws allowed, 0–0 never saved** (the database CHECK
 *     rejects a 0–0 atomically; draws are ordinary results);
 *   * **the actual played date is entered with the result**, never inferred
 *     from the scheduled date and never in the future;
 *   * **no opponent approval and no reminders**: a saved result is final the
 *     moment it is written — there is no submitted/confirmed state machine;
 *   * **scheduled plans expire**: an entry with no result is removed once it
 *     is more than five league-local calendar days past its current scheduled
 *     date, and rescheduling moves that window because the window reads the
 *     current date. A saved result is never auto-deleted;
 *   * **expiry is server-side and idempotent**: only `expireStaleFriendlies`
 *     (called by the scheduler and the admin action) removes entries — a page
 *     load never does — and re-running it changes nothing;
 *   * **extreme values prompt "is this correct?"** and are never hard-rejected
 *     (HANDOFF §5: 34–3 frames, 100–50 frame points);
 *   * **separation**: these tables are never read by the standings engine,
 *     the stats loaders, the highlights or knockout (asserted in tests);
 *   * **every change is audited** (entity `friendly`) with who, what, when
 *     and why.
 *
 * Optional per-frame point scores and highest breaks are offered on friendly
 * results exactly like league results, and stay out of every league statistic.
 * Unlike league results there is no optional-details lock: with no
 * opponent-approved version to protect, a correction may change anything.
 */
import type { Db } from './db';
import { normaliseTime } from './bookings';
import { orderedPair, recordAudit } from './league';
import { isIsoDate, localDateString } from './league-time';
// Relative import (not `$lib/...`): vitest runs without the SvelteKit plugin, so
// only type-only `$lib` imports survive erasure in tests.
import {
	assessFriendlyForm,
	type AssessedFriendlyForm,
	type FriendlyBreakDetail,
	type FriendlyFormValues
} from '../friendly-entry';

export type { FriendlyFormValues };

/** Thrown when the actor is not allowed to make this friendly change. */
export class FriendlyPermissionError extends Error {}

/** Thrown when the entered friendly breaks a hard rule; carries every error. */
export class FriendlyValidationError extends Error {
	readonly errors: string[];

	constructor(errors: string[]) {
		super(errors.join(' '));
		this.name = 'FriendlyValidationError';
		this.errors = errors;
	}
}

/**
 * Thrown when the friendly is plausible but surprising: the player has to answer
 * "is this correct?" before it is saved. Never a rejection (HANDOFF §5).
 */
export class FriendlyNeedsConfirmationError extends Error {
	readonly warnings: string[];

	constructor(warnings: string[]) {
		super(warnings.join(' '));
		this.name = 'FriendlyNeedsConfirmationError';
		this.warnings = warnings;
	}
}

export type FriendlyRole = 'player' | 'admin' | 'super_admin';
export type FriendlyStatus = 'scheduled' | 'played';

/**
 * How long an unsaved scheduled entry survives: it is removed once it is more
 * than this many league-local calendar days past its scheduled date.
 */
export const FRIENDLY_EXPIRY_DAYS = 5;

/** Cap on note/reason lengths, mirroring the booking and league reason limits. */
const NOTE_LIMIT = 200;
const REASON_LIMIT = 300;

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

export function loadFriendlyRole(db: Db, playerId: number | null): FriendlyRole | null {
	if (playerId == null) return null;
	const row = db.prepare('SELECT role FROM players WHERE id = ? AND is_active = 1').get(playerId) as
		| { role: FriendlyRole }
		| undefined;
	return row?.role ?? null;
}

function actorIsAdmin(role: FriendlyRole | null): boolean {
	return role === 'admin' || role === 'super_admin';
}

function isActivePlayer(db: Db, playerId: number): boolean {
	const row = db
		.prepare('SELECT 1 AS ok FROM players WHERE id = ? AND is_active = 1')
		.get(playerId) as { ok: number } | undefined;
	return Boolean(row);
}

function playerName(db: Db, playerId: number | null): string | null {
	if (playerId == null) return null;
	const row = db.prepare('SELECT display_name FROM players WHERE id = ?').get(playerId) as
		| { display_name: string }
		| undefined;
	return row?.display_name ?? null;
}

/** Friendlies use the league timezone: the latest season's, or the confirmed default. */
export function loadFriendlyTimezone(db: Db): string {
	const row = db.prepare('SELECT timezone FROM seasons ORDER BY id DESC LIMIT 1').get() as
		| { timezone: string }
		| undefined;
	return row?.timezone ?? 'Europe/London';
}

/** Shift a YYYY-MM-DD calendar date by whole days (no timezone involved). */
export function shiftIsoDate(date: string, days: number): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!match) throw new Error(`Not a calendar date: ${date}.`);
	const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * The first league-local calendar date on which a scheduled entry with no
 * result is gone: the scheduled date plus the five surviving days, plus one.
 */
export function friendlyExpiryDate(scheduledDate: string): string {
	return shiftIsoDate(scheduledDate, FRIENDLY_EXPIRY_DAYS + 1);
}

function normaliseNote(note: string | null | undefined): string | null {
	const trimmed = (note ?? '').trim();
	if (trimmed.length > NOTE_LIMIT) {
		throw new FriendlyValidationError([`Keep the note under ${NOTE_LIMIT} characters.`]);
	}
	return trimmed || null;
}

function normaliseReason(reason: string | null | undefined, mandatory: boolean): string | null {
	const trimmed = (reason ?? '').trim();
	if (!trimmed) {
		if (!mandatory) return null;
		throw new FriendlyValidationError([
			'A reason is required for this change, so the audit record says why.'
		]);
	}
	if (trimmed.length < 3) {
		throw new FriendlyValidationError([
			'A reason is required for this change, so the audit record says why.'
		]);
	}
	if (trimmed.length > REASON_LIMIT) {
		throw new FriendlyValidationError([`Keep the reason under ${REASON_LIMIT} characters.`]);
	}
	return trimmed;
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

interface FriendlyRow {
	id: number;
	player_low_id: number;
	player_high_id: number;
	created_by_player_id: number;
	created_at: string;
	scheduled_date: string | null;
	scheduled_time: string | null;
	note: string | null;
	status: FriendlyStatus;
}

interface FriendlyResultRow {
	id: number;
	friendly_id: number;
	player_low_frames: number;
	player_high_frames: number;
	actual_played_date: string;
	submitted_by_player_id: number;
	submitted_at: string;
	revision: number;
	corrected_by_player_id: number | null;
	corrected_at: string | null;
	correction_reason: string | null;
}

function loadFriendlyRow(db: Db, friendlyId: number): FriendlyRow | null {
	const row = db.prepare('SELECT * FROM friendlies WHERE id = ?').get(friendlyId) as
		| FriendlyRow
		| undefined;
	return row ?? null;
}

function loadFriendlyResultRow(db: Db, friendlyId: number): FriendlyResultRow | null {
	const row = db
		.prepare('SELECT * FROM friendly_results WHERE friendly_id = ?')
		.get(friendlyId) as FriendlyResultRow | undefined;
	return row ?? null;
}

export interface FriendlyParty {
	playerId: number;
	name: string;
	initials: string;
	tone: string;
}

function loadParty(db: Db, playerId: number): FriendlyParty {
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

export interface FriendlyFrameView {
	frameNumber: number;
	lowPoints: number;
	highPoints: number;
}

export interface FriendlyBreakView {
	playerId: number;
	playerName: string;
	breakPoints: number;
}

export interface FriendlyAuditView {
	id: number;
	action: string;
	actorPlayerId: number | null;
	actorName: string | null;
	reason: string | null;
	detail: unknown;
	createdAt: string;
}

function loadFriendlyFrames(db: Db, resultId: number): FriendlyFrameView[] {
	return (
		db
			.prepare(
				'SELECT frame_number, player_low_points, player_high_points FROM friendly_result_frames WHERE result_id = ? ORDER BY frame_number'
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

function loadFriendlyBreaks(db: Db, resultId: number): FriendlyBreakView[] {
	return (
		db
			.prepare(
				`SELECT rb.player_id, rb.break_points, p.display_name
				 FROM friendly_result_breaks rb JOIN players p ON p.id = rb.player_id
				 WHERE rb.result_id = ? ORDER BY rb.break_points DESC`
			)
			.all(resultId) as Array<{ player_id: number; break_points: number; display_name: string }>
	).map((entry) => ({
		playerId: entry.player_id,
		playerName: entry.display_name,
		breakPoints: entry.break_points
	}));
}

/** The append-only history of one friendly, oldest first. */
export function loadFriendlyAudit(db: Db, friendlyId: number): FriendlyAuditView[] {
	const rows = db
		.prepare(
			`SELECT a.id, a.action, a.actor_player_id, p.display_name AS actor_name, a.reason,
				a.detail, a.created_at
			 FROM audit_log a LEFT JOIN players p ON p.id = a.actor_player_id
			 WHERE a.entity_type = 'friendly' AND a.entity_id = ?
			 ORDER BY a.id ASC`
		)
		.all(friendlyId) as Array<{
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

export interface FriendlyDetail {
	friendlyId: number;
	status: FriendlyStatus;
	low: FriendlyParty;
	high: FriendlyParty;
	scheduledDate: string | null;
	scheduledTime: string | null;
	note: string | null;
	createdByName: string | null;
	createdAt: string;
	/** First date the entry is gone when it still has no result (scheduled only). */
	expiryDate: string | null;
	hasResult: boolean;
	lowFrames: number | null;
	highFrames: number | null;
	isDraw: boolean;
	winner: FriendlyParty | null;
	actualPlayedDate: string | null;
	submittedByName: string | null;
	submittedAt: string | null;
	revision: number | null;
	correctedByName: string | null;
	correctedAt: string | null;
	correctionReason: string | null;
	frames: FriendlyFrameView[];
	breaks: FriendlyBreakView[];
	hasFramePoints: boolean;
	hasBreaks: boolean;
	history: FriendlyAuditView[];
}

/** The full friendly record for a detail page, or null when it does not exist. */
export function loadFriendlyDetail(db: Db, friendlyId: number): FriendlyDetail | null {
	const row = loadFriendlyRow(db, friendlyId);
	if (!row) return null;
	const result = loadFriendlyResultRow(db, friendlyId);
	const low = loadParty(db, row.player_low_id);
	const high = loadParty(db, row.player_high_id);
	const frames = result ? loadFriendlyFrames(db, result.id) : [];
	const breaks = result ? loadFriendlyBreaks(db, result.id) : [];
	const isDraw = result ? result.player_low_frames === result.player_high_frames : false;
	return {
		friendlyId: row.id,
		status: row.status,
		low,
		high,
		scheduledDate: row.scheduled_date,
		scheduledTime: row.scheduled_time,
		note: row.note,
		createdByName: playerName(db, row.created_by_player_id),
		createdAt: row.created_at,
		expiryDate: !result && row.scheduled_date ? friendlyExpiryDate(row.scheduled_date) : null,
		hasResult: Boolean(result),
		lowFrames: result?.player_low_frames ?? null,
		highFrames: result?.player_high_frames ?? null,
		isDraw,
		winner: !result || isDraw ? null : result.player_low_frames > result.player_high_frames ? low : high,
		actualPlayedDate: result?.actual_played_date ?? null,
		submittedByName: result ? playerName(db, result.submitted_by_player_id) : null,
		submittedAt: result?.submitted_at ?? null,
		revision: result?.revision ?? null,
		correctedByName: result ? playerName(db, result.corrected_by_player_id) : null,
		correctedAt: result?.corrected_at ?? null,
		correctionReason: result?.correction_reason ?? null,
		frames,
		breaks,
		hasFramePoints: frames.length > 0,
		hasBreaks: breaks.length > 0,
		history: loadFriendlyAudit(db, row.id)
	};
}

export interface FriendlyListItem {
	friendlyId: number;
	status: FriendlyStatus;
	low: FriendlyParty;
	high: FriendlyParty;
	scheduledDate: string | null;
	scheduledTime: string | null;
	expiryDate: string | null;
	hasResult: boolean;
	lowFrames: number | null;
	highFrames: number | null;
	isDraw: boolean;
	actualPlayedDate: string | null;
	hasFramePoints: boolean;
	hasBreaks: boolean;
	isParticipant: boolean;
}

export interface FriendlyList {
	scheduled: FriendlyListItem[];
	played: FriendlyListItem[];
	timezone: string;
	today: string;
}

/**
 * The friendlies overview: upcoming plans (soonest first) and saved results
 * (newest actual date first). Saved results are capped; scheduled plans are
 * short-lived by construction.
 */
export function loadFriendlyList(
	db: Db,
	options: { viewerPlayerId: number | null; playedLimit?: number; now?: Date } = {
		viewerPlayerId: null
	}
): FriendlyList {
	const now = options.now ?? new Date();
	const timezone = loadFriendlyTimezone(db);
	const rows = db
		.prepare(
			`SELECT f.id, f.player_low_id, f.player_high_id, f.scheduled_date, f.scheduled_time,
				f.status, r.player_low_frames, r.player_high_frames, r.actual_played_date,
				EXISTS (SELECT 1 FROM friendly_results fr WHERE fr.friendly_id = f.id) AS has_result,
				EXISTS (
					SELECT 1 FROM friendly_result_frames ff
					JOIN friendly_results fr ON fr.id = ff.result_id
					WHERE fr.friendly_id = f.id
				) AS has_frame_points,
				EXISTS (
					SELECT 1 FROM friendly_result_breaks fb
					JOIN friendly_results fr ON fr.id = fb.result_id
					WHERE fr.friendly_id = f.id
				) AS has_breaks
			 FROM friendlies f
			 LEFT JOIN friendly_results r ON r.friendly_id = f.id
			 ORDER BY
				CASE WHEN r.id IS NULL THEN 0 ELSE 1 END,
				f.scheduled_date ASC NULLS LAST,
				r.actual_played_date DESC,
				f.id DESC`
		)
		.all() as Array<{
		id: number;
		player_low_id: number;
		player_high_id: number;
		scheduled_date: string | null;
		scheduled_time: string | null;
		status: FriendlyStatus;
		player_low_frames: number | null;
		player_high_frames: number | null;
		actual_played_date: string | null;
		has_result: number;
		has_frame_points: number;
		has_breaks: number;
	}>;

	const viewer = options.viewerPlayerId;
	const toItem = (row: (typeof rows)[number]): FriendlyListItem => {
		const hasResult = row.has_result === 1;
		const low = loadParty(db, row.player_low_id);
		const high = loadParty(db, row.player_high_id);
		return {
			friendlyId: row.id,
			status: row.status,
			low,
			high,
			scheduledDate: row.scheduled_date,
			scheduledTime: row.scheduled_time,
			expiryDate: !hasResult && row.scheduled_date ? friendlyExpiryDate(row.scheduled_date) : null,
			hasResult,
			lowFrames: row.player_low_frames,
			highFrames: row.player_high_frames,
			isDraw:
				row.player_low_frames !== null &&
				row.player_high_frames !== null &&
				row.player_low_frames === row.player_high_frames,
			actualPlayedDate: row.actual_played_date,
			hasFramePoints: row.has_frame_points === 1,
			hasBreaks: row.has_breaks === 1,
			isParticipant: viewer !== null && (viewer === row.player_low_id || viewer === row.player_high_id)
		};
	};

	const items = rows.map(toItem);
	return {
		scheduled: items.filter((item) => !item.hasResult),
		played: items.filter((item) => item.hasResult).slice(0, options.playedLimit ?? 50),
		timezone,
		today: localDateString(now, timezone)
	};
}

/** Active registered players other than the viewer, for the opponent picker. */
export function loadFriendlyOpponents(
	db: Db,
	viewerPlayerId: number | null
): Array<FriendlyParty & { email: string }> {
	const rows = db
		.prepare(
			`SELECT id, display_name, initials, avatar_tone, email FROM players
			 WHERE is_active = 1 AND id IS NOT ?
			 ORDER BY display_name COLLATE NOCASE`
		)
		.all(viewerPlayerId) as Array<{
		id: number;
		display_name: string;
		initials: string;
		avatar_tone: string;
		email: string;
	}>;
	return rows.map((row) => ({
		playerId: row.id,
		name: row.display_name,
		initials: row.initials,
		tone: row.avatar_tone,
		email: row.email
	}));
}

/* ------------------------------------------------------------------ *
 * Permissions (HANDOFF §5; Q3 admin override decided 2026-09-29)
 * ------------------------------------------------------------------ */

export interface FriendlyPermissions {
	viewerPlayerId: number | null;
	role: FriendlyRole | null;
	isParticipant: boolean;
	isAdmin: boolean;
	/** True when the viewer would be acting as an admin rather than a player. */
	adminOverride: boolean;
	canRecord: boolean;
	recordReason: string | null;
	canCorrect: boolean;
	correctReason: string | null;
	canReschedule: boolean;
	rescheduleReason: string | null;
	canCancel: boolean;
	cancelReason: string | null;
}

/** Who may arrange a friendly at all: any signed-in registered player. */
export function friendlyScheduleGate(
	db: Db,
	viewerPlayerId: number | null
): { allowed: boolean; reason: string | null } {
	if (viewerPlayerId == null) {
		return { allowed: false, reason: 'Sign in as a registered league player to arrange friendlies.' };
	}
	if (!isActivePlayer(db, viewerPlayerId)) {
		return { allowed: false, reason: 'Only registered league players can arrange friendlies.' };
	}
	return { allowed: true, reason: null };
}

/**
 * Who may do what with this friendly, right now.
 *
 * The two participants act on their own friendly; an admin or super-admin may
 * act for support and the audit trail records the override. A signed-out
 * visitor and an uninvolved player can only read. Every write path re-checks
 * before it touches anything.
 */
export function friendlyPermissions(
	db: Db,
	friendlyId: number,
	viewerPlayerId: number | null
): FriendlyPermissions {
	const row = loadFriendlyRow(db, friendlyId);
	if (!row) throw new Error(`Friendly ${friendlyId} does not exist.`);
	const hasResult = loadFriendlyResultRow(db, friendlyId) !== null;

	const role = loadFriendlyRole(db, viewerPlayerId);
	const isAdmin = actorIsAdmin(role);
	const isParticipant =
		viewerPlayerId !== null &&
		(viewerPlayerId === row.player_low_id || viewerPlayerId === row.player_high_id);
	const adminOverride = isAdmin && !isParticipant;
	const mayAct = isParticipant || isAdmin;

	const signedOutReason = 'Sign in as one of the two players to change this friendly.';
	const outsiderReason = 'Only the two players in this friendly (or an admin) can change it.';
	const gateReason = viewerPlayerId === null ? signedOutReason : mayAct ? null : outsiderReason;

	const base = { viewerPlayerId, role, isParticipant, isAdmin, adminOverride };

	if (hasResult) {
		return {
			...base,
			canRecord: false,
			recordReason: 'This friendly already has a saved result — correct it instead.',
			canCorrect: gateReason === null,
			correctReason: gateReason,
			canReschedule: false,
			rescheduleReason: 'A friendly with a saved result cannot be rescheduled.',
			canCancel: false,
			cancelReason: 'A saved friendly result is never removed.'
		};
	}
	return {
		...base,
		canRecord: gateReason === null,
		recordReason: gateReason,
		canCorrect: false,
		correctReason: 'There is no saved result to correct yet.',
		canReschedule: gateReason === null,
		rescheduleReason: gateReason,
		canCancel: gateReason === null,
		cancelReason: gateReason
	};
}

/* ------------------------------------------------------------------ *
 * Shared write plumbing
 * ------------------------------------------------------------------ */

interface FriendlyContext {
	low: FriendlyParty;
	high: FriendlyParty;
	timezone: string;
	today: string;
}

function loadContext(db: Db, lowId: number, highId: number, now: Date): FriendlyContext {
	const timezone = loadFriendlyTimezone(db);
	return {
		low: loadParty(db, lowId),
		high: loadParty(db, highId),
		timezone,
		today: localDateString(now, timezone)
	};
}

/**
 * Assess the entered form. Hard rule breaks are thrown; soft "is this
 * correct?" warnings are returned and gated by `requireAcknowledged`, so a
 * player always sees the real blocking problem first.
 */
function assess(
	context: FriendlyContext,
	lowId: number,
	highId: number,
	values: FriendlyFormValues
): AssessedFriendlyForm {
	const assessed = assessFriendlyForm(values, {
		lowPlayerId: lowId,
		highPlayerId: highId,
		lowPlayerName: context.low.name,
		highPlayerName: context.high.name,
		today: context.today
	});
	if (!assessed.ok) throw new FriendlyValidationError(assessed.errors);
	return assessed;
}

/**
 * Extreme but plausible input prompts "is this correct?" and is never rejected
 * outright (HANDOFF §5): the player has to say yes, they checked.
 */
function requireAcknowledged(assessed: AssessedFriendlyForm, ackWarnings: boolean): void {
	if (assessed.warnings.length > 0 && !ackWarnings) {
		throw new FriendlyNeedsConfirmationError(assessed.warnings);
	}
}

/** The pair as the tables store it: distinct, ordered, and both registered. */
function resolvePair(db: Db, playerAId: number, playerBId: number): [number, number] {
	if (!Number.isInteger(playerAId) || !Number.isInteger(playerBId)) {
		throw new FriendlyValidationError(['Choose two registered league players for this friendly.']);
	}
	if (playerAId === playerBId) {
		throw new FriendlyValidationError(['A friendly needs two different players — nobody can play themselves.']);
	}
	if (!isActivePlayer(db, playerAId) || !isActivePlayer(db, playerBId)) {
		throw new FriendlyValidationError(['Friendlies are only between registered league players.']);
	}
	return orderedPair(playerAId, playerBId);
}

/** The participant-or-admin gate every friendly write path shares. */
function assertMayAct(
	db: Db,
	lowId: number,
	highId: number,
	actorPlayerId: number,
	action: string
): { adminOverride: boolean } {
	const role = loadFriendlyRole(db, actorPlayerId);
	const isParticipant = actorPlayerId === lowId || actorPlayerId === highId;
	const isAdmin = actorIsAdmin(role);
	if (!isParticipant && !isAdmin) {
		if (role === null) {
			throw new FriendlyPermissionError('Sign in as one of the two players to change this friendly.');
		}
		throw new FriendlyPermissionError(
			`Only the two players in this friendly (or an admin) can ${action}.`
		);
	}
	return { adminOverride: isAdmin && !isParticipant };
}

function resultSnapshot(result: FriendlyResultRow | null): unknown {
	if (!result) return null;
	return {
		revision: result.revision,
		actualPlayedDate: result.actual_played_date,
		frames: [result.player_low_frames, result.player_high_frames]
	};
}

function writeFriendlyResultRow(
	db: Db,
	input: {
		friendlyId: number;
		lowFrames: number;
		highFrames: number;
		actualPlayedDate: string;
		submittedByPlayerId: number;
		submittedAt: string;
		revision: number;
		correctedByPlayerId?: number | null;
		correctedAt?: string | null;
		correctionReason?: string | null;
		frames: Array<{ frameNumber: number; lowPoints: number; highPoints: number }>;
		breaks: FriendlyBreakDetail[];
	}
): number {
	db.prepare(
		`INSERT INTO friendly_results (
			friendly_id, player_low_frames, player_high_frames, actual_played_date,
			submitted_by_player_id, submitted_at, revision,
			corrected_by_player_id, corrected_at, correction_reason
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (friendly_id) DO UPDATE SET
			player_low_frames = excluded.player_low_frames,
			player_high_frames = excluded.player_high_frames,
			actual_played_date = excluded.actual_played_date,
			submitted_by_player_id = excluded.submitted_by_player_id,
			submitted_at = excluded.submitted_at,
			revision = excluded.revision,
			corrected_by_player_id = excluded.corrected_by_player_id,
			corrected_at = excluded.corrected_at,
			correction_reason = excluded.correction_reason`
	).run(
		input.friendlyId,
		input.lowFrames,
		input.highFrames,
		input.actualPlayedDate,
		input.submittedByPlayerId,
		input.submittedAt,
		input.revision,
		input.correctedByPlayerId ?? null,
		input.correctedAt ?? null,
		input.correctionReason ?? null
	);
	// Resolve by natural key: lastInsertRowid is not reliable after an upsert
	// that took the UPDATE branch (SANDBOX.md §3).
	const resultId = (
		db.prepare('SELECT id FROM friendly_results WHERE friendly_id = ?').get(input.friendlyId) as {
			id: number;
		}
	).id;

	db.prepare('DELETE FROM friendly_result_frames WHERE result_id = ?').run(resultId);
	const addFrame = db.prepare(
		`INSERT INTO friendly_result_frames (result_id, frame_number, player_low_points, player_high_points)
		 VALUES (?, ?, ?, ?)`
	);
	for (const frame of input.frames) {
		addFrame.run(resultId, frame.frameNumber, frame.lowPoints, frame.highPoints);
	}

	db.prepare('DELETE FROM friendly_result_breaks WHERE result_id = ?').run(resultId);
	const addBreak = db.prepare(
		'INSERT INTO friendly_result_breaks (result_id, player_id, break_points) VALUES (?, ?, ?)'
	);
	for (const breakEntry of input.breaks) {
		addBreak.run(resultId, breakEntry.playerId, breakEntry.breakPoints);
	}

	db.prepare(`UPDATE friendlies SET status = 'played' WHERE id = ?`).run(input.friendlyId);
	return resultId;
}

export type FriendlyWriteMode = 'scheduled' | 'rescheduled' | 'recorded' | 'corrected';

export interface FriendlyWriteOutcome {
	friendlyId: number;
	resultId: number | null;
	revision: number | null;
	mode: FriendlyWriteMode;
	warnings: string[];
	adminOverride: boolean;
}

/* ------------------------------------------------------------------ *
 * Schedule / reschedule / cancel a plan
 * ------------------------------------------------------------------ */

export interface ScheduleFriendlyInput {
	actorPlayerId: number;
	playerAId: number;
	playerBId: number;
	/** League-local calendar date, YYYY-MM-DD. */
	date: string;
	/** Optional league-local wall-clock time, HH:MM (24-hour). */
	time?: string | null;
	note?: string | null;
}

/**
 * Arrange a friendly: a scheduled plan with no result. Either of the two
 * players arranges their own game; an admin may arrange for support and the
 * audit trail records the override.
 */
export function scheduleFriendly(
	db: Db,
	input: ScheduleFriendlyInput,
	options: { now?: Date } = {}
): FriendlyWriteOutcome {
	const now = options.now ?? new Date();
	const [lowId, highId] = resolvePair(db, input.playerAId, input.playerBId);
	const { adminOverride } = assertMayAct(db, lowId, highId, input.actorPlayerId, 'arrange this friendly');

	if (!isIsoDate(input.date)) throw new FriendlyValidationError(['Choose a valid scheduled date.']);
	const time = normaliseTime(input.time);
	const note = normaliseNote(input.note);

	const timezone = loadFriendlyTimezone(db);
	const today = localDateString(now, timezone);
	if (input.date < today) {
		throw new FriendlyValidationError([
			'A scheduled date cannot be in the past. To record a friendly you already played, use “record a played friendly” instead.'
		]);
	}

	return db.transaction((): FriendlyWriteOutcome => {
		const info = db
			.prepare(
				`INSERT INTO friendlies (
					player_low_id, player_high_id, created_by_player_id, created_at,
					scheduled_date, scheduled_time, note, status
				) VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')`
			)
			.run(lowId, highId, input.actorPlayerId, now.toISOString(), input.date, time, note);
		const friendlyId = Number(info.lastInsertRowid);
		recordAudit(db, {
			entityType: 'friendly',
			entityId: friendlyId,
			action: 'scheduled',
			actorPlayerId: input.actorPlayerId,
			reason: note,
			detail: {
				players: [lowId, highId],
				date: input.date,
				time,
				adminOverride,
				expiryDate: friendlyExpiryDate(input.date)
			}
		});
		return { friendlyId, resultId: null, revision: null, mode: 'scheduled', warnings: [], adminOverride };
	})();
}

export interface RescheduleFriendlyInput {
	friendlyId: number;
	actorPlayerId: number;
	date: string;
	time?: string | null;
	note?: string | null;
}

/**
 * Move a scheduled plan to a newer date. The five-day expiry window follows
 * the newest scheduled date because expiry reads the current row.
 */
export function rescheduleFriendly(
	db: Db,
	input: RescheduleFriendlyInput,
	options: { now?: Date } = {}
): FriendlyWriteOutcome {
	const now = options.now ?? new Date();

	return db.transaction((): FriendlyWriteOutcome => {
		const row = loadFriendlyRow(db, input.friendlyId);
		if (!row) throw new Error(`Friendly ${input.friendlyId} does not exist.`);
		if (loadFriendlyResultRow(db, input.friendlyId)) {
			throw new FriendlyPermissionError('A friendly with a saved result cannot be rescheduled.');
		}
		const { adminOverride } = assertMayAct(
			db,
			row.player_low_id,
			row.player_high_id,
			input.actorPlayerId,
			'reschedule this friendly'
		);

		if (!isIsoDate(input.date)) throw new FriendlyValidationError(['Choose a valid scheduled date.']);
		const time = normaliseTime(input.time);
		const note = normaliseNote(input.note);

		const timezone = loadFriendlyTimezone(db);
		const today = localDateString(now, timezone);
		if (input.date < today) {
			throw new FriendlyValidationError(['A scheduled date cannot be in the past.']);
		}

		const before = { date: row.scheduled_date, time: row.scheduled_time };
		db.prepare(
			`UPDATE friendlies SET scheduled_date = ?, scheduled_time = ?, note = ? WHERE id = ?`
		).run(input.date, time, note, input.friendlyId);
		recordAudit(db, {
			entityType: 'friendly',
			entityId: input.friendlyId,
			action: 'rescheduled',
			actorPlayerId: input.actorPlayerId,
			reason: note,
			detail: {
				players: [row.player_low_id, row.player_high_id],
				before,
				after: { date: input.date, time },
				adminOverride,
				expiryDate: friendlyExpiryDate(input.date)
			}
		});
		return {
			friendlyId: input.friendlyId,
			resultId: null,
			revision: null,
			mode: 'rescheduled',
			warnings: [],
			adminOverride
		};
	})();
}

/**
 * Withdraw a scheduled plan that has no result. The empty entry is removed and
 * the audit trail keeps the story; the players can arrange another later.
 */
export function cancelScheduledFriendly(
	db: Db,
	input: { friendlyId: number; actorPlayerId: number; reason?: string | null },
	options: { now?: Date } = {}
): { cancelled: boolean; adminOverride: boolean } {
	const now = options.now ?? new Date();

	return db.transaction((): { cancelled: boolean; adminOverride: boolean } => {
		const row = loadFriendlyRow(db, input.friendlyId);
		if (!row) throw new Error(`Friendly ${input.friendlyId} does not exist.`);
		if (loadFriendlyResultRow(db, input.friendlyId)) {
			throw new FriendlyPermissionError('A saved friendly result is never removed.');
		}
		const { adminOverride } = assertMayAct(
			db,
			row.player_low_id,
			row.player_high_id,
			input.actorPlayerId,
			'cancel this friendly'
		);
		const reason = normaliseReason(input.reason, false);

		db.prepare('DELETE FROM friendlies WHERE id = ?').run(input.friendlyId);
		recordAudit(db, {
			entityType: 'friendly',
			entityId: input.friendlyId,
			action: 'cancelled',
			actorPlayerId: input.actorPlayerId,
			reason,
			detail: {
				players: [row.player_low_id, row.player_high_id],
				date: row.scheduled_date,
				time: row.scheduled_time,
				adminOverride,
				cancelledAt: now.toISOString()
			}
		});
		return { cancelled: true, adminOverride };
	})();
}

/* ------------------------------------------------------------------ *
 * Record / correct a result (no opponent approval)
 * ------------------------------------------------------------------ */

export interface RecordFriendlyResultInput {
	actorPlayerId: number;
	/** Record against an existing scheduled plan … */
	friendlyId?: number;
	/** … or record a played friendly directly between two players. */
	playerAId?: number;
	playerBId?: number;
	values: FriendlyFormValues;
	/** The player answered "is this correct?" to the soft warnings. */
	ackWarnings?: boolean;
	reason?: string | null;
}

/**
 * Save a friendly result — either against a scheduled plan or directly as a
 * played friendly. There is no opponent approval: the result is final the
 * moment it is written. Either participant may record; an admin may record for
 * support and the audit trail records the override.
 */
export function recordFriendlyResult(
	db: Db,
	input: RecordFriendlyResultInput,
	options: { now?: Date } = {}
): FriendlyWriteOutcome {
	const now = options.now ?? new Date();
	const hasFriendly = input.friendlyId !== undefined && input.friendlyId !== null;
	const hasPair = input.playerAId !== undefined && input.playerBId !== undefined;
	if (hasFriendly === hasPair) {
		throw new FriendlyValidationError([
			'Record against a scheduled friendly, or name the two players — not both.'
		]);
	}

	return db.transaction((): FriendlyWriteOutcome => {
		let friendlyId: number;
		let lowId: number;
		let highId: number;
		let scheduledDate: string | null = null;
		if (hasFriendly) {
			const row = loadFriendlyRow(db, input.friendlyId!);
			if (!row) throw new Error(`Friendly ${input.friendlyId} does not exist.`);
			if (loadFriendlyResultRow(db, input.friendlyId!)) {
				throw new FriendlyPermissionError(
					'This friendly already has a saved result — correct it instead.'
				);
			}
			friendlyId = row.id;
			lowId = row.player_low_id;
			highId = row.player_high_id;
			scheduledDate = row.scheduled_date;
		} else {
			[lowId, highId] = resolvePair(db, input.playerAId!, input.playerBId!);
			const info = db
				.prepare(
					`INSERT INTO friendlies (
						player_low_id, player_high_id, created_by_player_id, created_at, status
					) VALUES (?, ?, ?, ?, 'scheduled')`
				)
				.run(lowId, highId, input.actorPlayerId, now.toISOString());
			friendlyId = Number(info.lastInsertRowid);
		}

		const { adminOverride } = assertMayAct(db, lowId, highId, input.actorPlayerId, 'record this friendly');
		const context = loadContext(db, lowId, highId, now);
		const assessed = assess(context, lowId, highId, input.values);
		requireAcknowledged(assessed, Boolean(input.ackWarnings));
		const reason = normaliseReason(input.reason, false);

		const resultId = writeFriendlyResultRow(db, {
			friendlyId,
			lowFrames: assessed.lowFrames,
			highFrames: assessed.highFrames,
			actualPlayedDate: assessed.actualPlayedDate,
			submittedByPlayerId: input.actorPlayerId,
			submittedAt: now.toISOString(),
			revision: 1,
			frames: assessed.frames,
			breaks: assessed.breaks
		});
		recordAudit(db, {
			entityType: 'friendly',
			entityId: friendlyId,
			action: 'result_recorded',
			actorPlayerId: input.actorPlayerId,
			reason,
			detail: {
				players: [lowId, highId],
				scheduledDate,
				actualPlayedDate: assessed.actualPlayedDate,
				frames: [assessed.lowFrames, assessed.highFrames],
				framePoints: assessed.frames.map((frame) => [frame.lowPoints, frame.highPoints]),
				breaks: assessed.breaks,
				adminOverride,
				warnings: assessed.warnings
			}
		});
		return {
			friendlyId,
			resultId,
			revision: 1,
			mode: 'recorded',
			warnings: assessed.warnings,
			adminOverride
		};
	})();
}

export interface CorrectFriendlyResultInput {
	friendlyId: number;
	actorPlayerId: number;
	values: FriendlyFormValues;
	ackWarnings?: boolean;
	/**
	 * Optional for a participant's own correction; mandatory for an admin
	 * override, mirroring league post-approval corrections.
	 */
	reason?: string | null;
}

/**
 * Correct a saved friendly result. Either participant may correct at any time;
 * an admin may override for support with a mandatory reason. There is no
 * optional-details lock (HANDOFF §5 sets none, and with no opponent-approved
 * version to protect a correction may change anything); the before/after
 * snapshot in the audit trail keeps the change honest.
 */
export function correctFriendlyResult(
	db: Db,
	input: CorrectFriendlyResultInput,
	options: { now?: Date } = {}
): FriendlyWriteOutcome {
	const now = options.now ?? new Date();

	return db.transaction((): FriendlyWriteOutcome => {
		const row = loadFriendlyRow(db, input.friendlyId);
		if (!row) throw new Error(`Friendly ${input.friendlyId} does not exist.`);
		const existing = loadFriendlyResultRow(db, input.friendlyId);
		if (!existing) {
			throw new FriendlyPermissionError('There is no saved result to correct yet.');
		}
		const { adminOverride } = assertMayAct(
			db,
			row.player_low_id,
			row.player_high_id,
			input.actorPlayerId,
			'correct this friendly'
		);
		const reason = normaliseReason(input.reason, adminOverride);

		const context = loadContext(db, row.player_low_id, row.player_high_id, now);
		const assessed = assess(context, row.player_low_id, row.player_high_id, input.values);
		requireAcknowledged(assessed, Boolean(input.ackWarnings));

		const beforeFrames = loadFriendlyFrames(db, existing.id);
		const beforeBreaks = loadFriendlyBreaks(db, existing.id);
		const revision = existing.revision + 1;
		const resultId = writeFriendlyResultRow(db, {
			friendlyId: row.id,
			lowFrames: assessed.lowFrames,
			highFrames: assessed.highFrames,
			actualPlayedDate: assessed.actualPlayedDate,
			submittedByPlayerId: existing.submitted_by_player_id,
			submittedAt: existing.submitted_at,
			revision,
			correctedByPlayerId: input.actorPlayerId,
			correctedAt: now.toISOString(),
			correctionReason: reason,
			frames: assessed.frames,
			breaks: assessed.breaks
		});
		recordAudit(db, {
			entityType: 'friendly',
			entityId: row.id,
			action: 'result_corrected',
			actorPlayerId: input.actorPlayerId,
			reason,
			detail: {
				players: [row.player_low_id, row.player_high_id],
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
					breaks: assessed.breaks
				},
				adminOverride,
				warnings: assessed.warnings
			}
		});
		return {
			friendlyId: row.id,
			resultId,
			revision,
			mode: 'corrected',
			warnings: assessed.warnings,
			adminOverride
		};
	})();
}

/* ------------------------------------------------------------------ *
 * Expiry (server-side, idempotent — the scheduler calls this)
 * ------------------------------------------------------------------ */

export interface FriendlyExpiryOutcome {
	expiredIds: number[];
	count: number;
}

/**
 * Remove scheduled entries with no result once they are more than five
 * league-local calendar days past their current scheduled date. Saved results
 * are never touched — the `NOT EXISTS` guard protects them even if a row's
 * status ever disagreed with its result.
 *
 * A page load never calls this: the scheduler (`runRoundLifecycle`) and the
 * admin scheduler action do. Re-running is a no-op.
 */
export function expireStaleFriendlies(
	db: Db,
	options: { now?: Date; timezone?: string } = {}
): FriendlyExpiryOutcome {
	const now = options.now ?? new Date();
	if (!Number.isFinite(now.getTime())) throw new Error('Scheduler time is invalid.');
	const timezone = options.timezone ?? loadFriendlyTimezone(db);
	const today = localDateString(now, timezone);
	const cutoff = shiftIsoDate(today, -FRIENDLY_EXPIRY_DAYS);

	return db.transaction((): FriendlyExpiryOutcome => {
		const stale = db
			.prepare(
				`SELECT id, player_low_id, player_high_id, scheduled_date, scheduled_time
				 FROM friendlies
				 WHERE status = 'scheduled'
				   AND scheduled_date IS NOT NULL
				   AND scheduled_date < ?
				   AND NOT EXISTS (SELECT 1 FROM friendly_results WHERE friendly_id = friendlies.id)
				 ORDER BY id`
			)
			.all(cutoff) as Array<{
			id: number;
			player_low_id: number;
			player_high_id: number;
			scheduled_date: string;
			scheduled_time: string | null;
		}>;

		const expiredIds: number[] = [];
		const remove = db.prepare('DELETE FROM friendlies WHERE id = ?');
		for (const row of stale) {
			remove.run(row.id);
			expiredIds.push(row.id);
			recordAudit(db, {
				entityType: 'friendly',
				entityId: row.id,
				action: 'expired',
				actorPlayerId: null,
				detail: {
					players: [row.player_low_id, row.player_high_id],
					scheduledDate: row.scheduled_date,
					scheduledTime: row.scheduled_time,
					evaluatedAt: now.toISOString(),
					timezone
				}
			});
		}
		return { expiredIds, count: expiredIds.length };
	})();
}
