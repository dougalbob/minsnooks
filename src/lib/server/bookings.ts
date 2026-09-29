/**
 * Planned dates (bookings) — Phase 5.
 *
 * A booking is a **plan**, deliberately separate from the actual date played
 * (HANDOFF §4). Nothing in this module can create or change a result:
 *
 *   * proposing a date writes only to `bookings` (plus the `fixtures.booked_date`
 *     mirror) and records an audit entry;
 *   * the fixture keeps its state — an unplayed fixture stays unplayed, so it
 *     still appears as outstanding and still needs a genuine result;
 *   * the standings engine never reads this table, so a plan cannot move a
 *     table position.
 *
 * Permissions (provisional until the Phase 8 permission matrix is confirmed):
 * the two players in the fixture may propose, change and cancel the planned
 * date. An admin or super-admin may also do it for support, and the audit trail
 * records that the change came from an admin override.
 */
import type { Db } from './db';
import { gracePeriodEndsAt, isIsoDate, localDateString, sqliteInstant } from './league-time';
import { recordAudit } from './league';

export type BookingStatus = 'proposed' | 'cancelled';

/** Thrown when the actor is not allowed to touch this fixture's planned date. */
export class BookingPermissionError extends Error {}

export interface BookingRecord {
	bookingId: number;
	fixtureId: number;
	proposedDate: string;
	proposedTime: string | null;
	status: BookingStatus;
	note: string | null;
	proposedByPlayerId: number;
	proposedByName: string;
	createdAt: string;
	updatedAt: string | null;
	cancelledAt: string | null;
	cancelledByPlayerId: number | null;
	cancelledByName: string | null;
	cancelReason: string | null;
}

interface BookingRow {
	id: number;
	fixture_id: number;
	proposed_date: string;
	proposed_time: string | null;
	status: BookingStatus;
	note: string | null;
	proposed_by_player_id: number;
	proposed_by_name: string;
	created_at: string;
	updated_at: string | null;
	cancelled_at: string | null;
	cancelled_by_player_id: number | null;
	cancelled_by_name: string | null;
	cancel_reason: string | null;
}

const BOOKING_SELECT = `
	SELECT b.id, b.fixture_id, b.proposed_date, b.proposed_time, b.status, b.note,
		b.proposed_by_player_id, proposer.display_name AS proposed_by_name,
		b.created_at, b.updated_at, b.cancelled_at,
		b.cancelled_by_player_id, canceller.display_name AS cancelled_by_name,
		b.cancel_reason
	FROM bookings b
	JOIN players proposer ON proposer.id = b.proposed_by_player_id
	LEFT JOIN players canceller ON canceller.id = b.cancelled_by_player_id
`;

function toRecord(row: BookingRow): BookingRecord {
	return {
		bookingId: row.id,
		fixtureId: row.fixture_id,
		proposedDate: row.proposed_date,
		proposedTime: row.proposed_time,
		status: row.status,
		note: row.note,
		proposedByPlayerId: row.proposed_by_player_id,
		proposedByName: row.proposed_by_name,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		cancelledAt: row.cancelled_at,
		cancelledByPlayerId: row.cancelled_by_player_id,
		cancelledByName: row.cancelled_by_name,
		cancelReason: row.cancel_reason
	};
}

export interface FixtureContext {
	fixtureId: number;
	roundId: number;
	roundNumber: number;
	roundStatus: 'open' | 'closed';
	roundOpenedAt: string;
	deadlineAt: string | null;
	graceDays: number;
	timezone: string;
	state: string;
	playerLowId: number;
	playerHighId: number;
}

/** The fixture plus the round facts that decide whether it can be booked. */
export function loadFixtureContext(db: Db, fixtureId: number): FixtureContext | null {
	const row = db
		.prepare(
			`SELECT f.id AS fixture_id, f.round_id, f.state, f.player_low_id, f.player_high_id,
				ro.number AS round_number, ro.status AS round_status, ro.opened_at,
				ro.deadline_at, ro.grace_days, s.timezone
			 FROM fixtures f
			 JOIN rounds ro ON ro.id = f.round_id
			 JOIN seasons s ON s.id = ro.season_id
			 WHERE f.id = ?`
		)
		.get(fixtureId) as
		| {
				fixture_id: number;
				round_id: number;
				state: string;
				player_low_id: number;
				player_high_id: number;
				round_number: number;
				round_status: 'open' | 'closed';
				opened_at: string;
				deadline_at: string | null;
				grace_days: number;
				timezone: string;
		  }
		| undefined;
	if (!row) return null;
	return {
		fixtureId: row.fixture_id,
		roundId: row.round_id,
		roundNumber: row.round_number,
		roundStatus: row.round_status,
		roundOpenedAt: row.opened_at,
		deadlineAt: row.deadline_at,
		graceDays: row.grace_days,
		timezone: row.timezone,
		state: row.state,
		playerLowId: row.player_low_id,
		playerHighId: row.player_high_id
	};
}

export function isFixtureParticipant(db: Db, fixtureId: number, playerId: number | null): boolean {
	if (playerId == null) return false;
	const row = db
		.prepare('SELECT player_low_id, player_high_id FROM fixtures WHERE id = ?')
		.get(fixtureId) as { player_low_id: number; player_high_id: number } | undefined;
	if (!row) return false;
	return row.player_low_id === playerId || row.player_high_id === playerId;
}

export function isAdminPlayer(db: Db, playerId: number | null): boolean {
	if (playerId == null) return false;
	const row = db
		.prepare("SELECT role FROM players WHERE id = ? AND is_active = 1")
		.get(playerId) as { role: string } | undefined;
	return row?.role === 'admin' || row?.role === 'super_admin';
}

/**
 * Who may manage this fixture's planned date.
 * `reason` explains a refusal so the UI can say why, not just hide the action.
 */
export function canManageBooking(
	db: Db,
	fixtureId: number,
	playerId: number | null
): { allowed: boolean; participant: boolean; adminOverride: boolean; reason: string | null } {
	const participant = isFixtureParticipant(db, fixtureId, playerId);
	const admin = isAdminPlayer(db, playerId);
	if (participant) return { allowed: true, participant, adminOverride: false, reason: null };
	if (admin) return { allowed: true, participant, adminOverride: true, reason: null };
	return {
		allowed: false,
		participant,
		adminOverride: false,
		reason:
			playerId == null
				? 'Sign in as one of the two players to arrange this date.'
				: 'Only the two players in this fixture (or an admin) can arrange this date.'
	};
}

/** The single active proposal for a fixture, if there is one. */
export function loadActiveBooking(db: Db, fixtureId: number): BookingRecord | null {
	const row = db
		.prepare(`${BOOKING_SELECT} WHERE b.fixture_id = ? AND b.status = 'proposed'`)
		.get(fixtureId) as BookingRow | undefined;
	return row ? toRecord(row) : null;
}

/** Every proposal ever made for a fixture, newest first (plan history). */
export function loadBookingHistory(db: Db, fixtureId: number): BookingRecord[] {
	const rows = db
		.prepare(`${BOOKING_SELECT} WHERE b.fixture_id = ? ORDER BY b.id DESC`)
		.all(fixtureId) as unknown as BookingRow[];
	return rows.map(toRecord);
}

export interface ProposeBookingInput {
	fixtureId: number;
	actorPlayerId: number;
	/** League-local calendar date, YYYY-MM-DD. */
	date: string;
	/** Optional league-local wall-clock time, HH:MM (24-hour). */
	time?: string | null;
	note?: string | null;
}

export interface ProposeBookingResult {
	bookingId: number;
	/** True when an earlier active proposal was superseded by this one. */
	replaced: boolean;
	/**
	 * True when the proposed date falls after this round's deadline + grace
	 * window: the plan is still saved, but the fixture will close neutrally
	 * unless a genuine result is recorded in time.
	 */
	afterWindow: boolean;
}

export function normaliseTime(value: string | null | undefined): string | null {
	const raw = (value ?? '').trim();
	if (!raw) return null;
	if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
		throw new Error('Enter a valid time as HH:MM (24-hour), or leave the time blank.');
	}
	return raw;
}

/** The final league-local calendar day on which this fixture may still be played. */
export function lastPlayableDate(context: FixtureContext): string | null {
	if (!context.deadlineAt) return null;
	// Grace is added as local calendar days (HANDOFF §4), including across DST.
	return localDateString(
		gracePeriodEndsAt(context.deadlineAt, context.graceDays, context.timezone),
		context.timezone
	);
}

/**
 * Propose or change the planned date for a fixture.
 *
 * The previous active proposal (if any) is superseded — marked cancelled with a
 * reason — and a new active row is inserted, so the plan history stays honest.
 * No result is created and the fixture state is untouched.
 */
export function proposeBooking(
	db: Db,
	input: ProposeBookingInput,
	options: { now?: Date } = {}
): ProposeBookingResult {
	const now = options.now ?? new Date();
	const context = loadFixtureContext(db, input.fixtureId);
	if (!context) throw new Error(`Fixture ${input.fixtureId} does not exist.`);

	const permission = canManageBooking(db, input.fixtureId, input.actorPlayerId);
	if (!permission.allowed) {
		throw new BookingPermissionError(permission.reason ?? 'You cannot arrange this date.');
	}
	if (context.roundStatus !== 'open') {
		throw new Error(`Round ${context.roundNumber} is closed; its fixtures no longer take new dates.`);
	}
	if (context.state !== 'unplayed') {
		throw new Error('This fixture is already resolved, so its planned date cannot be changed.');
	}

	if (!isIsoDate(input.date)) throw new Error('Choose a valid planned date.');
	const time = normaliseTime(input.time);
	const note = (input.note ?? '').trim();
	if (note.length > 200) throw new Error('Keep the note under 200 characters.');

	const today = localDateString(now, context.timezone);
	const openedDate = localDateString(sqliteInstant(context.roundOpenedAt), context.timezone);
	if (input.date < openedDate) {
		throw new Error(`A planned date cannot be before Round ${context.roundNumber} opened (${openedDate}).`);
	}
	if (input.date < today) {
		throw new Error('A planned date cannot be in the past. The actual date played is recorded with the result.');
	}

	const windowEnd = lastPlayableDate(context);

	return db.transaction(() => {
		const existing = db
			.prepare("SELECT id, proposed_date, proposed_time FROM bookings WHERE fixture_id = ? AND status = 'proposed'")
			.get(input.fixtureId) as
			| { id: number; proposed_date: string; proposed_time: string | null }
			| undefined;

		let replaced = false;
		if (existing) {
			replaced = true;
			db.prepare(
				`UPDATE bookings
				 SET status = 'cancelled', cancelled_at = ?, cancelled_by_player_id = ?,
					cancel_reason = 'Replaced by a newer planned date'
				 WHERE id = ?`
			).run(now.toISOString(), input.actorPlayerId, existing.id);
			recordAudit(db, {
				entityType: 'booking',
				entityId: existing.id,
				action: 'superseded',
				actorPlayerId: input.actorPlayerId,
				detail: {
					fixtureId: input.fixtureId,
					from: { date: existing.proposed_date, time: existing.proposed_time },
					to: { date: input.date, time }
				}
			});
		}

		const info = db
			.prepare(
				`INSERT INTO bookings (fixture_id, proposed_date, proposed_time, status, note, proposed_by_player_id, created_at)
				 VALUES (?, ?, ?, 'proposed', ?, ?, ?)`
			)
			.run(input.fixtureId, input.date, time, note || null, input.actorPlayerId, now.toISOString());
		const bookingId = Number(info.lastInsertRowid);

		// Mirror on the fixture: the planned date is convenient there, but it is
		// never read as a played date.
		db.prepare('UPDATE fixtures SET booked_date = ? WHERE id = ?').run(input.date, input.fixtureId);

		recordAudit(db, {
			entityType: 'booking',
			entityId: bookingId,
			action: replaced ? 'changed' : 'proposed',
			actorPlayerId: input.actorPlayerId,
			reason: note || null,
			detail: {
				fixtureId: input.fixtureId,
				roundId: context.roundId,
				date: input.date,
				time,
				adminOverride: permission.adminOverride,
				afterWindow: Boolean(windowEnd && input.date > windowEnd)
			}
		});

		return {
			bookingId,
			replaced,
			afterWindow: Boolean(windowEnd && input.date > windowEnd)
		};
	})();
}

/** Agree to the CURRENT proposal. Only the OTHER fixture participant can accept;
 * admins cannot impersonate a player. A later change requires fresh acceptance.
 */
export function acceptBooking(db: Db, input: { fixtureId: number; actorPlayerId: number }, options: { now?: Date } = {}): boolean {
  return db.transaction(() => {
    const context = loadFixtureContext(db, input.fixtureId);
    if (!context || context.roundStatus !== 'open' || context.state !== 'unplayed') throw new Error('This fixture cannot accept a date.');
    if (![context.playerLowId, context.playerHighId].includes(input.actorPlayerId)) throw new BookingPermissionError('Only the other player can agree to a date.');
    const active = loadActiveBooking(db, input.fixtureId);
    if (!active) throw new Error('There is no current proposal to agree to.');
    if (active.proposedByPlayerId === input.actorPlayerId) throw new BookingPermissionError('The other player must agree to your proposal.');
    const result = db.prepare(`INSERT OR IGNORE INTO booking_acceptances (booking_id,accepted_by_player_id,accepted_at) VALUES (?,?,?)`)
      .run(active.bookingId, input.actorPlayerId, (options.now ?? new Date()).toISOString());
    if (result.changes) recordAudit(db, { entityType: 'booking', entityId: active.bookingId, action: 'accepted', actorPlayerId: input.actorPlayerId });
    return result.changes > 0;
  })();
}

/**
 * Cancel the active planned date. The fixture becomes "no date arranged" again;
 * the cancelled proposal stays in the history.
 */
export function cancelBooking(
	db: Db,
	input: { fixtureId: number; actorPlayerId: number; reason?: string | null },
	options: { now?: Date } = {}
): { cancelled: boolean } {
	const now = options.now ?? new Date();
	const context = loadFixtureContext(db, input.fixtureId);
	if (!context) throw new Error(`Fixture ${input.fixtureId} does not exist.`);
	const permission = canManageBooking(db, input.fixtureId, input.actorPlayerId);
	if (!permission.allowed) {
		throw new BookingPermissionError(permission.reason ?? 'You cannot cancel this date.');
	}

	const reason = (input.reason ?? '').trim();
	if (reason.length > 200) throw new Error('Keep the cancellation note under 200 characters.');

	return db.transaction(() => {
		const active = db
			.prepare("SELECT id, proposed_date, proposed_time FROM bookings WHERE fixture_id = ? AND status = 'proposed'")
			.get(input.fixtureId) as
			| { id: number; proposed_date: string; proposed_time: string | null }
			| undefined;
		if (!active) return { cancelled: false };

		db.prepare(
			`UPDATE bookings
			 SET status = 'cancelled', cancelled_at = ?, cancelled_by_player_id = ?, cancel_reason = ?
			 WHERE id = ?`
		).run(now.toISOString(), input.actorPlayerId, reason || 'Cancelled by a player', active.id);
		db.prepare('UPDATE fixtures SET booked_date = NULL WHERE id = ?').run(input.fixtureId);

		recordAudit(db, {
			entityType: 'booking',
			entityId: active.id,
			action: 'cancelled',
			actorPlayerId: input.actorPlayerId,
			reason: reason || null,
			detail: {
				fixtureId: input.fixtureId,
				date: active.proposed_date,
				time: active.proposed_time,
				adminOverride: permission.adminOverride
			}
		});
		return { cancelled: true };
	})();
}
