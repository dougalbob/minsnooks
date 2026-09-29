/**
 * Knockout invitation, opt-in, entrant selection, consensual swaps and first draw.
 *
 * Phase 11 stays separate from league fixtures/results: every write is a
 * transaction, selection/draw randomness is generated on the server, and the
 * complete outcome is recorded in the knockout tables and audit_log.
 */
import { randomInt as cryptoRandomInt } from 'node:crypto';
import type { Db } from './db';
import { canConfigureKnockout, canOptInKnockout } from './permissions';
import { recordAudit } from './league';
import type { ViewerPlayer, ViewerRole } from './viewer';

export type KnockoutStatus = 'inviting' | 'abandoned' | 'selected' | 'drawn';
export type KnockoutEntryStatus = 'selected' | 'waiting';
export type KnockoutTieType = 'match' | 'bye';

export const KNOCKOUT_MIN_ENTRANTS = 6;
export const KNOCKOUT_MAX_ENTRANTS = 8;
export const KNOCKOUT_FRAMES_TO_WIN = [2, 3, 4] as const;

export type RandomInt = (maxExclusive: number) => number;

export class KnockoutPermissionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'KnockoutPermissionError';
	}
}

export class KnockoutValidationError extends Error {
	readonly errors: string[];

	constructor(errors: string[]) {
		super(errors.join(' '));
		this.name = 'KnockoutValidationError';
		this.errors = errors;
	}
}

interface CompetitionRow {
	id: number;
	title: string;
	announcement: string;
	created_by_player_id: number;
	created_at: string;
	reply_deadline_at: string;
	frames_to_win: number;
	status: KnockoutStatus;
	selection_closed_at: string | null;
	drawn_at: string | null;
}

interface ActorRow {
	id: number;
	display_name: string;
	initials: string;
	avatar_tone: string;
	email: string;
	role: ViewerRole;
	phone: string | null;
	contact_visible: number;
}

function loadActor(db: Db, playerId: number | null): ViewerPlayer | null {
	if (playerId === null) return null;
	const row = db
		.prepare(
			`SELECT id, display_name, initials, avatar_tone, email, role, phone, contact_visible
			 FROM players WHERE id = ? AND is_active = 1`
		)
		.get(playerId) as ActorRow | undefined;
	if (!row) return null;
	return {
		playerId: row.id,
		name: row.display_name,
		initials: row.initials,
		tone: row.avatar_tone,
		email: row.email,
		role: row.role,
		phone: row.phone,
		contactVisible: row.contact_visible === 1
	};
}

function assertAdmin(db: Db, actorPlayerId: number | null): ViewerPlayer {
	const actor = loadActor(db, actorPlayerId);
	const check = canConfigureKnockout(actor);
	if (!check.allowed || !actor) {
		throw new KnockoutPermissionError(check.reason ?? 'Administrator privileges are required.');
	}
	return actor;
}

function assertCompetition(db: Db, competitionId: number): CompetitionRow {
	const row = db.prepare('SELECT * FROM knockout_competitions WHERE id = ?').get(competitionId) as
		| CompetitionRow
		| undefined;
	if (!row) throw new KnockoutValidationError(['That knockout invitation no longer exists.']);
	return row;
}

function checkedNow(value?: Date): Date {
	const now = value ?? new Date();
	if (!Number.isFinite(now.getTime())) throw new KnockoutValidationError(['The current time is invalid.']);
	return now;
}

function validateTitle(value: string): string {
	const title = value.trim();
	if (!title) throw new KnockoutValidationError(['Give the knockout a title.']);
	if (title.length > 80) throw new KnockoutValidationError(['Keep the title to 80 characters or fewer.']);
	return title;
}

function validateAnnouncement(value: string | null | undefined): string {
	const announcement = (value ?? '').trim();
	if (announcement.length > 500) {
		throw new KnockoutValidationError(['Keep the invitation announcement to 500 characters or fewer.']);
	}
	return announcement;
}

function validateFramesToWin(value: number): void {
	if (!KNOCKOUT_FRAMES_TO_WIN.includes(value as (typeof KNOCKOUT_FRAMES_TO_WIN)[number])) {
		throw new KnockoutValidationError(['Choose first to 2, 3, or 4 frames for this competition.']);
	}
}

function validateDeadline(value: string, now: Date): string {
	const deadline = new Date(value);
	if (!Number.isFinite(deadline.getTime())) {
		throw new KnockoutValidationError(['Enter a valid reply deadline.']);
	}
	if (deadline.getTime() <= now.getTime()) {
		throw new KnockoutValidationError(['The reply deadline must be in the future.']);
	}
	return deadline.toISOString();
}

/**
 * Create and announce a knockout competition. The selected frame target and
 * reply deadline are immutable after announcement.
 */
export function createKnockoutCompetition(
	db: Db,
	input: {
		actorPlayerId: number;
		title: string;
		announcement?: string | null;
		replyDeadlineAt: string;
		framesToWin: number;
	},
	options: { now?: Date } = {}
): number {
	const now = checkedNow(options.now);
	const title = validateTitle(input.title);
	const announcement = validateAnnouncement(input.announcement);
	validateFramesToWin(input.framesToWin);
	const replyDeadlineAt = validateDeadline(input.replyDeadlineAt, now);

	return db.transaction((): number => {
		const actor = assertAdmin(db, input.actorPlayerId);
		const info = db
			.prepare(
				`INSERT INTO knockout_competitions (
					title, announcement, created_by_player_id, created_at,
					reply_deadline_at, frames_to_win, status
				) VALUES (?, ?, ?, ?, ?, ?, 'inviting')`
			)
			.run(title, announcement, actor.playerId, now.toISOString(), replyDeadlineAt, input.framesToWin);
		const competitionId = Number(info.lastInsertRowid);
		recordAudit(db, {
			entityType: 'knockout_competition',
			entityId: competitionId,
			action: 'announced',
			actorPlayerId: actor.playerId,
			detail: { title, announcement, replyDeadlineAt, framesToWin: input.framesToWin }
		});
		return competitionId;
	})();
}

/**
 * Save the current player's yes/no response before the immutable reply deadline.
 * An unchanged repeat is idempotent and does not add a duplicate audit event.
 */
export function respondToKnockoutInvitation(
	db: Db,
	input: { competitionId: number; actorPlayerId: number; optedIn: boolean },
	options: { now?: Date } = {}
): { changed: boolean; optedIn: boolean } {
	const now = checkedNow(options.now);
	if (typeof input.optedIn !== 'boolean') {
		throw new KnockoutValidationError(['Choose whether to enter this knockout.']);
	}

	return db.transaction((): { changed: boolean; optedIn: boolean } => {
		const competition = assertCompetition(db, input.competitionId);
		if (competition.status !== 'inviting') {
			throw new KnockoutValidationError(['This knockout is no longer accepting replies.']);
		}
		if (now.getTime() >= new Date(competition.reply_deadline_at).getTime()) {
			throw new KnockoutValidationError(['The reply deadline has passed; entry is locked.']);
		}

		const actor = loadActor(db, input.actorPlayerId);
		const permission = canOptInKnockout(actor, input.actorPlayerId);
		if (!permission.allowed || !actor) {
			throw new KnockoutPermissionError(permission.reason ?? 'An active league player must sign in to reply.');
		}
		const current = db
			.prepare('SELECT opted_in FROM knockout_responses WHERE competition_id = ? AND player_id = ?')
			.get(input.competitionId, actor.playerId) as { opted_in: number } | undefined;
		if (current?.opted_in === Number(input.optedIn)) {
			return { changed: false, optedIn: input.optedIn };
		}

		db.prepare(
			`INSERT INTO knockout_responses (competition_id, player_id, opted_in, responded_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT (competition_id, player_id) DO UPDATE SET
				opted_in = excluded.opted_in,
				responded_at = excluded.responded_at`
		).run(input.competitionId, actor.playerId, Number(input.optedIn), now.toISOString());
		recordAudit(db, {
			entityType: 'knockout_competition',
			entityId: input.competitionId,
			action: input.optedIn ? 'player_opted_in' : 'player_opted_out',
			actorPlayerId: actor.playerId,
			detail: { playerId: actor.playerId, optedIn: input.optedIn, respondedAt: now.toISOString() }
		});
		return { changed: true, optedIn: input.optedIn };
	})();
}

/** Fisher–Yates shuffle using an injected range source (crypto in production). */
function shuffled<T>(items: readonly T[], nextInt: RandomInt): T[] {
	const result = [...items];
	for (let index = result.length - 1; index > 0; index--) {
		const swapIndex = nextInt(index + 1);
		if (!Number.isInteger(swapIndex) || swapIndex < 0 || swapIndex > index) {
			throw new KnockoutValidationError(['The server draw source returned an invalid value.']);
		}
		[result[index], result[swapIndex]] = [result[swapIndex], result[index]];
	}
	return result;
}

const secureRandomInt: RandomInt = (maxExclusive) => cryptoRandomInt(maxExclusive);

export interface KnockoutSelectionOutcome {
	status: 'abandoned' | 'selected';
	entrantCount: number;
	selectedPlayerIds: number[];
	waitingPlayerIds: number[];
}

/**
 * Close replies only after the deadline. Fewer than six abandons the attempt;
 * otherwise randomly select up to eight and keep a separately randomized
 * waiting list. Randomness is injectable for deterministic tests only.
 */
export function finaliseKnockoutEntry(
	db: Db,
	input: { competitionId: number; actorPlayerId: number },
	options: { now?: Date; randomInt?: RandomInt } = {}
): KnockoutSelectionOutcome {
	const now = checkedNow(options.now);
	const nextInt = options.randomInt ?? secureRandomInt;

	return db.transaction((): KnockoutSelectionOutcome => {
		const actor = assertAdmin(db, input.actorPlayerId);
		const competition = assertCompetition(db, input.competitionId);
		if (competition.status !== 'inviting') {
			throw new KnockoutValidationError(['This invitation has already been closed.']);
		}
		if (now.getTime() < new Date(competition.reply_deadline_at).getTime()) {
			throw new KnockoutValidationError(['Wait until the reply deadline has passed before closing entry.']);
		}

		const entrants = db
			.prepare(
				`SELECT r.player_id FROM knockout_responses r
				 JOIN players p ON p.id = r.player_id
				 WHERE r.competition_id = ? AND r.opted_in = 1 AND p.is_active = 1
				 ORDER BY r.player_id`
			)
			.all(input.competitionId) as Array<{ player_id: number }>;
		const entrantIds = entrants.map((row) => row.player_id);
		if (entrantIds.length < KNOCKOUT_MIN_ENTRANTS) {
			db.prepare(
				`UPDATE knockout_competitions
				 SET status = 'abandoned', selection_closed_at = ? WHERE id = ?`
			).run(now.toISOString(), input.competitionId);
			recordAudit(db, {
				entityType: 'knockout_competition',
				entityId: input.competitionId,
				action: 'entry_abandoned',
				actorPlayerId: actor.playerId,
				detail: {
					entrantCount: entrantIds.length,
					minimum: KNOCKOUT_MIN_ENTRANTS,
					replyDeadlineAt: competition.reply_deadline_at
				}
			});
			return { status: 'abandoned', entrantCount: entrantIds.length, selectedPlayerIds: [], waitingPlayerIds: [] };
		}

		const selectionOrder = shuffled(entrantIds, nextInt);
		const selectedCount = Math.min(KNOCKOUT_MAX_ENTRANTS, selectionOrder.length);
		const selectedPlayerIds = selectionOrder.slice(0, selectedCount);
		const waitingPlayerIds = selectionOrder.slice(selectedCount);
		const insertEntry = db.prepare(
			`INSERT INTO knockout_entries (competition_id, player_id, entry_status, selection_order, selected_at)
			 VALUES (?, ?, ?, ?, ?)`
		);
		selectionOrder.forEach((playerId, index) => {
			insertEntry.run(
				input.competitionId,
				playerId,
				index < selectedCount ? 'selected' : 'waiting',
				index + 1,
				now.toISOString()
			);
		});
		db.prepare(
			`UPDATE knockout_competitions
			 SET status = 'selected', selection_closed_at = ? WHERE id = ?`
		).run(now.toISOString(), input.competitionId);
		recordAudit(db, {
			entityType: 'knockout_competition',
			entityId: input.competitionId,
			action: 'entrants_selected',
			actorPlayerId: actor.playerId,
			detail: {
				entrantCount: entrantIds.length,
				selectionOrder,
				selectedPlayerIds,
				waitingPlayerIds,
				selectedLimit: KNOCKOUT_MAX_ENTRANTS
			}
		});
		return { status: 'selected', entrantCount: entrantIds.length, selectedPlayerIds, waitingPlayerIds };
	})();
}

/**
 * Record a voluntary selected-player / waiting-list swap. The actor must be an
 * admin, must attest that both players consented, and the first draw must not
 * have happened. Existing random selection order is retained; no re-selection
 * takes place.
 */
export function recordKnockoutSwap(
	db: Db,
	input: {
		competitionId: number;
		actorPlayerId: number;
		selectedPlayerId: number;
		waitingPlayerId: number;
		consentConfirmed: boolean;
		reason?: string | null;
	},
	options: { now?: Date } = {}
): number {
	const now = checkedNow(options.now);
	const reason = (input.reason ?? '').trim();
	if (reason.length > 300) throw new KnockoutValidationError(['Keep the swap note to 300 characters or fewer.']);
	if (input.selectedPlayerId === input.waitingPlayerId) {
		throw new KnockoutValidationError(['Choose two different players for the swap.']);
	}
	if (input.consentConfirmed !== true) {
		throw new KnockoutValidationError(['Confirm that both players agreed to this swap.']);
	}

	return db.transaction((): number => {
		const actor = assertAdmin(db, input.actorPlayerId);
		const competition = assertCompetition(db, input.competitionId);
		if (db.prepare('SELECT 1 FROM knockout_stages WHERE competition_id = ?').get(input.competitionId)) {
			throw new KnockoutValidationError(['The first draw is already saved; entrants can no longer be swapped.']);
		}
		if (competition.status !== 'selected') {
			throw new KnockoutValidationError(['Swaps are available only after entry selection and before the first draw.']);
		}
		const selected = db
			.prepare('SELECT entry_status FROM knockout_entries WHERE competition_id = ? AND player_id = ?')
			.get(input.competitionId, input.selectedPlayerId) as { entry_status: KnockoutEntryStatus } | undefined;
		const waiting = db
			.prepare('SELECT entry_status FROM knockout_entries WHERE competition_id = ? AND player_id = ?')
			.get(input.competitionId, input.waitingPlayerId) as { entry_status: KnockoutEntryStatus } | undefined;
		if (selected?.entry_status !== 'selected' || waiting?.entry_status !== 'waiting') {
			throw new KnockoutValidationError(['Choose one currently selected player and one current waiting-list player.']);
		}

		const info = db
			.prepare(
				`INSERT INTO knockout_swaps (
					competition_id, selected_player_id, waiting_player_id,
					recorded_by_player_id, recorded_at, reason, consent_confirmed
				) VALUES (?, ?, ?, ?, ?, ?, 1)`
			)
			.run(
				input.competitionId,
				input.selectedPlayerId,
				input.waitingPlayerId,
				actor.playerId,
				now.toISOString(),
				reason || null
			);
		db.prepare(
			`UPDATE knockout_entries SET entry_status = 'waiting'
			 WHERE competition_id = ? AND player_id = ?`
		).run(input.competitionId, input.selectedPlayerId);
		db.prepare(
			`UPDATE knockout_entries SET entry_status = 'selected'
			 WHERE competition_id = ? AND player_id = ?`
		).run(input.competitionId, input.waitingPlayerId);
		recordAudit(db, {
			entityType: 'knockout_competition',
			entityId: input.competitionId,
			action: 'entrant_swap',
			actorPlayerId: actor.playerId,
			reason: reason || null,
			detail: {
				selectedPlayerId: input.selectedPlayerId,
				waitingPlayerId: input.waitingPlayerId,
				consentConfirmed: true,
				selectionOrderPreserved: true,
				swapId: Number(info.lastInsertRowid)
			}
		});
		return Number(info.lastInsertRowid);
	})();
}

export interface KnockoutDrawOutcome {
	stageId: number;
	matchups: Array<[number, number]>;
	byePlayerIds: number[];
	framesToWin: number;
}

/** Persist the server-randomized first-stage pairings and byes exactly once. */
export function drawKnockoutOpeningStage(
	db: Db,
	input: { competitionId: number; actorPlayerId: number },
	options: { now?: Date; randomInt?: RandomInt } = {}
): KnockoutDrawOutcome {
	const now = checkedNow(options.now);
	const nextInt = options.randomInt ?? secureRandomInt;

	return db.transaction((): KnockoutDrawOutcome => {
		const actor = assertAdmin(db, input.actorPlayerId);
		const competition = assertCompetition(db, input.competitionId);
		if (db.prepare('SELECT 1 FROM knockout_stages WHERE competition_id = ?').get(input.competitionId)) {
			throw new KnockoutValidationError(['The first-stage draw has already been saved.']);
		}
		if (competition.status !== 'selected') {
			throw new KnockoutValidationError(['Complete entry selection before drawing the first stage.']);
		}
		const entrants = db
			.prepare(
				`SELECT player_id FROM knockout_entries
				 WHERE competition_id = ? AND entry_status = 'selected'
				 ORDER BY selection_order`
			)
			.all(input.competitionId) as Array<{ player_id: number }>;
		const entrantIds = entrants.map((row) => row.player_id);
		if (entrantIds.length < KNOCKOUT_MIN_ENTRANTS || entrantIds.length > KNOCKOUT_MAX_ENTRANTS) {
			throw new KnockoutValidationError(['A first draw needs six, seven, or eight selected entrants.']);
		}

		const drawOrder = shuffled(entrantIds, nextInt);
		const byeCount = KNOCKOUT_MAX_ENTRANTS - drawOrder.length;
		const byePlayerIds = drawOrder.slice(0, byeCount);
		const playersToPair = drawOrder.slice(byeCount);
		const matchups: Array<[number, number]> = [];
		for (let index = 0; index < playersToPair.length; index += 2) {
			const first = playersToPair[index];
			const second = playersToPair[index + 1];
			matchups.push(first < second ? [first, second] : [second, first]);
		}

		const stageInfo = db
			.prepare(
				'INSERT INTO knockout_stages (competition_id, stage_number, drawn_by_player_id, drawn_at) VALUES (?, 1, ?, ?)'
			)
			.run(input.competitionId, actor.playerId, now.toISOString());
		const stageId = Number(stageInfo.lastInsertRowid);
		const addTie = db.prepare(
			`INSERT INTO knockout_ties (
				stage_id, tie_number, tie_type, player_low_id, player_high_id, bye_player_id
			) VALUES (?, ?, ?, ?, ?, ?)`
		);
		let tieNumber = 1;
		for (const [low, high] of matchups) {
			addTie.run(stageId, tieNumber++, 'match', low, high, null);
		}
		for (const playerId of byePlayerIds) {
			addTie.run(stageId, tieNumber++, 'bye', null, null, playerId);
		}
		db.prepare("UPDATE knockout_competitions SET status = 'drawn', drawn_at = ? WHERE id = ?").run(
			now.toISOString(),
			input.competitionId
		);
		recordAudit(db, {
			entityType: 'knockout_competition',
			entityId: input.competitionId,
			action: 'opening_draw_saved',
			actorPlayerId: actor.playerId,
			detail: {
				stageId,
				stageNumber: 1,
				framesToWin: competition.frames_to_win,
				drawOrder,
				matchups,
				byePlayerIds,
				tieCount: matchups.length,
				byeCount
			}
		});
		return { stageId, matchups, byePlayerIds, framesToWin: competition.frames_to_win };
	})();
}

export interface KnockoutPlayerView {
	playerId: number;
	name: string;
	initials: string;
	tone: string;
}

export interface KnockoutEntryView extends KnockoutPlayerView {
	entryStatus: KnockoutEntryStatus;
	selectionOrder: number;
}

export interface KnockoutSwapView {
	selectedPlayer: KnockoutPlayerView;
	waitingPlayer: KnockoutPlayerView;
	recordedByName: string;
	recordedAt: string;
	reason: string | null;
}

export interface KnockoutTieView {
	tieNumber: number;
	type: KnockoutTieType;
	playerLow: KnockoutPlayerView | null;
	playerHigh: KnockoutPlayerView | null;
	byePlayer: KnockoutPlayerView | null;
}

export interface KnockoutStageView {
	stageNumber: number;
	drawnAt: string;
	drawnByName: string;
	ties: KnockoutTieView[];
}

export interface KnockoutCompetitionView {
	competitionId: number;
	title: string;
	announcement: string;
	createdByName: string;
	createdAt: string;
	replyDeadlineAt: string;
	framesToWin: number;
	status: KnockoutStatus;
	selectionClosedAt: string | null;
	drawnAt: string | null;
	viewerOptedIn: boolean | null;
	optedInPlayers: KnockoutPlayerView[];
	selectedPlayers: KnockoutEntryView[];
	waitingPlayers: KnockoutEntryView[];
	swaps: KnockoutSwapView[];
	stages: KnockoutStageView[];
}

function loadKnockoutPlayer(db: Db, playerId: number): KnockoutPlayerView {
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

/** Public read model for the in-app invitation, selection and first-draw view. */
export function loadKnockoutCompetitions(
	db: Db,
	viewerPlayerId: number | null = null
): KnockoutCompetitionView[] {
	const competitions = db
		.prepare('SELECT * FROM knockout_competitions ORDER BY id DESC')
		.all() as CompetitionRow[];
	return competitions.map((competition) => {
		const creator = loadKnockoutPlayer(db, competition.created_by_player_id);
		const response = viewerPlayerId === null
			? undefined
			: (db
					.prepare('SELECT opted_in FROM knockout_responses WHERE competition_id = ? AND player_id = ?')
					.get(competition.id, viewerPlayerId) as { opted_in: number } | undefined);
		const optedInPlayers = (
			db
				.prepare(
					`SELECT p.id FROM knockout_responses r JOIN players p ON p.id = r.player_id
					 WHERE r.competition_id = ? AND r.opted_in = 1 AND p.is_active = 1
					 ORDER BY p.display_name COLLATE NOCASE, p.id`
				)
				.all(competition.id) as Array<{ id: number }>
		).map((row) => loadKnockoutPlayer(db, row.id));
		const entries = db
			.prepare(
				`SELECT player_id, entry_status, selection_order FROM knockout_entries
				 WHERE competition_id = ? ORDER BY selection_order`
			)
			.all(competition.id) as Array<{
			player_id: number;
			entry_status: KnockoutEntryStatus;
			selection_order: number;
		}>;
		const toEntry = (row: (typeof entries)[number]): KnockoutEntryView => ({
			...loadKnockoutPlayer(db, row.player_id),
			entryStatus: row.entry_status,
			selectionOrder: row.selection_order
		});
		const swaps = db
			.prepare(
				`SELECT selected_player_id, waiting_player_id, recorded_by_player_id, recorded_at, reason
				 FROM knockout_swaps WHERE competition_id = ? ORDER BY id`
			)
			.all(competition.id) as Array<{
			selected_player_id: number;
			waiting_player_id: number;
			recorded_by_player_id: number;
			recorded_at: string;
			reason: string | null;
		}>;
		const stages = db
			.prepare(
				`SELECT s.stage_number, s.drawn_at, s.drawn_by_player_id,
					t.tie_number, t.tie_type, t.player_low_id, t.player_high_id, t.bye_player_id
				 FROM knockout_stages s LEFT JOIN knockout_ties t ON t.stage_id = s.id
				 WHERE s.competition_id = ? ORDER BY s.stage_number, t.tie_number`
			)
			.all(competition.id) as Array<{
			stage_number: number;
			drawn_at: string;
			drawn_by_player_id: number;
			tie_number: number | null;
			tie_type: KnockoutTieType | null;
			player_low_id: number | null;
			player_high_id: number | null;
			bye_player_id: number | null;
		}>;
		const stageViews: KnockoutStageView[] = [];
		for (const row of stages) {
			let stage = stageViews.find((item) => item.stageNumber === row.stage_number);
			if (!stage) {
				stage = {
					stageNumber: row.stage_number,
					drawnAt: row.drawn_at,
					drawnByName: loadKnockoutPlayer(db, row.drawn_by_player_id).name,
					ties: []
				};
				stageViews.push(stage);
			}
			if (row.tie_number === null || row.tie_type === null) continue;
			stage.ties.push({
				tieNumber: row.tie_number,
				type: row.tie_type,
				playerLow: row.player_low_id === null ? null : loadKnockoutPlayer(db, row.player_low_id),
				playerHigh: row.player_high_id === null ? null : loadKnockoutPlayer(db, row.player_high_id),
				byePlayer: row.bye_player_id === null ? null : loadKnockoutPlayer(db, row.bye_player_id)
			});
		}

		return {
			competitionId: competition.id,
			title: competition.title,
			announcement: competition.announcement,
			createdByName: creator.name,
			createdAt: competition.created_at,
			replyDeadlineAt: competition.reply_deadline_at,
			framesToWin: competition.frames_to_win,
			status: competition.status,
			selectionClosedAt: competition.selection_closed_at,
			drawnAt: competition.drawn_at,
			viewerOptedIn: response ? response.opted_in === 1 : null,
			optedInPlayers,
			selectedPlayers: entries.filter((entry) => entry.entry_status === 'selected').map(toEntry),
			waitingPlayers: entries.filter((entry) => entry.entry_status === 'waiting').map(toEntry),
			swaps: swaps.map((swap) => ({
				selectedPlayer: loadKnockoutPlayer(db, swap.selected_player_id),
				waitingPlayer: loadKnockoutPlayer(db, swap.waiting_player_id),
				recordedByName: loadKnockoutPlayer(db, swap.recorded_by_player_id).name,
				recordedAt: swap.recorded_at,
				reason: swap.reason
			})),
			stages: stageViews
		};
	});
}
