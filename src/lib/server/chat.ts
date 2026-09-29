/**
 * Chat & direct messages — the write and read paths (Phase 13).
 *
 * The acceptance criteria this module implements live in `docs/spec/chat.md`
 * (owner-confirmed 2026-09-29, Q5). The short version:
 *
 *   * one league channel plus 1:1 DM threads — a message belongs to exactly one
 *     destination (database CHECK), and a pair has exactly one thread
 *     (canonical low/high ordering plus UNIQUE);
 *   * only the two participants can read or post in a thread — a non-participant
 *     (admin included) gets the same answer as a nonexistent thread, so chat
 *     cannot leak who is talking to whom;
 *   * messages are append-only plain text: no editing, author soft-delete with a
 *     placeholder, and an admin hide only through a reported message with a
 *     mandatory audited note;
 *   * withdrawn members keep full chat access — withdrawal is a league-table
 *     matter, not an account lock (owner decision Q5e);
 *   * there is no blocking (owner decision Q5c) — reporting is the minimal
 *     control, and admins never gain general DM visibility;
 *   * nothing in this module reads or writes league state. Chat cannot move a
 *     table, create a result or alter a statistic.
 *
 * Every write takes an explicit `now` so tests are deterministic, matching
 * `results.ts`, `friendlies.ts` and `knockout-progression.ts`.
 */
import type { Db } from './db';
import { recordAudit } from './league';
import { canModerateChat, canUseChat, canViewDirectThread } from './permissions';
import type { ViewerPlayer } from './viewer';
import type {
	ChatBadgeSummary,
	ChatCandidate,
	ChatChannelView,
	ChatMessageView,
	ChatReportView,
	ChatThreadPartner,
	ChatThreadSummary,
	ChatThreadView
} from '../chat-view';
import {
	CHAT_MESSAGES_PER_MINUTE,
	CHAT_MESSAGE_WINDOW_MS,
	CHAT_NEW_THREADS_PER_HOUR,
	CHAT_REPORTS_PER_HOUR,
	CHAT_REPORT_WINDOW_MS,
	CHAT_THREAD_WINDOW_MS,
	normaliseChatBody,
	normaliseModerationNote,
	normaliseReportReason,
	type ChatMessageState
} from '../chat';

export type {
	ChatBadgeSummary,
	ChatCandidate,
	ChatChannelView,
	ChatMessageView,
	ChatReportView,
	ChatThreadPartner,
	ChatThreadSummary,
	ChatThreadView
} from '../chat-view';

export const LEAGUE_CHANNEL_KEY = 'league';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/* ------------------------------------------------------------------ *
 * Errors — mapped to fail(400/403/404) by the routes
 * ------------------------------------------------------------------ */

/** The actor may not do this (a non-participant reading a thread, a non-admin moderating). */
export class ChatPermissionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ChatPermissionError';
	}
}

/** The input breaks a hard rule; every message is returned so the form can show it. */
export class ChatValidationError extends Error {
	readonly errors: string[];
	constructor(errors: string[]) {
		super(errors.join(' '));
		this.name = 'ChatValidationError';
		this.errors = errors;
	}
}

/** A rate limit (docs/spec/chat.md §4 E). Ordinary, expected — not a failure to log. */
export class ChatRateLimitError extends Error {
	readonly retryAfterSeconds: number;
	constructor(message: string, retryAfterSeconds: number) {
		super(message);
		this.name = 'ChatRateLimitError';
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

/** The thread or message does not exist — or is not this viewer's to see. */
export class ChatNotFoundError extends Error {
	constructor(message = 'That conversation could not be found.') {
		super(message);
		this.name = 'ChatNotFoundError';
	}
}

/* ------------------------------------------------------------------ *
 * Views
 * ------------------------------------------------------------------ */

interface MessageRow {
	id: number;
	author_player_id: number;
	author_name: string;
	initials: string;
	avatar_tone: string;
	body: string;
	created_at: string;
	deleted_at: string | null;
	hidden_at: string | null;
}

const MESSAGE_SELECT = `
	SELECT m.id, m.author_player_id, p.display_name AS author_name, p.initials,
	       p.avatar_tone, m.body, m.created_at, m.deleted_at, m.hidden_at
	  FROM chat_messages m
	  JOIN players p ON p.id = m.author_player_id`;

function toMessageView(row: MessageRow, viewerPlayerId: number): ChatMessageView {
	const state: ChatMessageState = row.hidden_at ? 'hidden' : row.deleted_at ? 'deleted' : 'visible';
	return {
		id: row.id,
		authorPlayerId: row.author_player_id,
		authorName: row.author_name,
		authorInitials: row.initials,
		authorTone: row.avatar_tone,
		createdAt: row.created_at,
		state,
		body: state === 'visible' ? row.body : null,
		isOwn: row.author_player_id === viewerPlayerId,
		canDelete: state === 'visible' && row.author_player_id === viewerPlayerId,
		canReport: state === 'visible' && row.author_player_id !== viewerPlayerId
	};
}

/** The stored instant of the newest message in a destination, or 0. */
function latestMessageId(db: Db, destination: Destination): number {
	const row = destination.kind === 'channel'
		? (db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM chat_messages WHERE channel_id = ?').get(
				destination.id
			) as { id: number })
		: (db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM chat_messages WHERE thread_id = ?').get(
				destination.id
			) as { id: number });
	return row.id;
}

interface Destination {
	kind: 'channel' | 'thread';
	id: number;
}

interface LoadMessagesOptions {
	afterId?: number;
	beforeId?: number;
	limit?: number;
}

function loadMessages(
	db: Db,
	destination: Destination,
	viewerPlayerId: number,
	options: LoadMessagesOptions = {}
): { messages: ChatMessageView[]; hasEarlier: boolean; latestId: number } {
	const limit = Math.min(Math.max(options.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
	const column = destination.kind === 'channel' ? 'm.channel_id' : 'm.thread_id';
	const params: Array<number> = [destination.id];

	if (options.afterId !== undefined) {
		params.push(options.afterId, limit);
		const rows = db
			.prepare(`${MESSAGE_SELECT} WHERE ${column} = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`)
			.all(...params) as MessageRow[];
		return {
			messages: rows.map((row) => toMessageView(row, viewerPlayerId)),
			hasEarlier: false,
			latestId: latestMessageId(db, destination)
		};
	}

	if (options.beforeId !== undefined) {
		params.push(options.beforeId, limit);
	} else {
		params.push(limit);
	}
	const where = options.beforeId !== undefined ? ` AND m.id < ?` : '';
	const rows = db
		.prepare(`${MESSAGE_SELECT} WHERE ${column} = ?${where} ORDER BY m.id DESC LIMIT ?`)
		.all(...params) as MessageRow[];
	const earliest = rows.length > 0 ? rows[rows.length - 1].id : null;
	const hasEarlier =
		earliest !== null &&
		Boolean(
			db
				.prepare(`SELECT 1 FROM chat_messages m WHERE ${column} = ? AND m.id < ? LIMIT 1`)
				.get(destination.id, earliest)
		);
	return {
		messages: rows.reverse().map((row) => toMessageView(row, viewerPlayerId)),
		hasEarlier,
		latestId: latestMessageId(db, destination)
	};
}

/* ------------------------------------------------------------------ *
 * Gates
 * ------------------------------------------------------------------ */

export function chatGate(db: Db, viewer: ViewerPlayer | null): { allowed: boolean; reason: string | null } {
	const check = canUseChat(viewer);
	if (!check.allowed) return check;
	if (!leagueChannel(db)) {
		return { allowed: false, reason: 'Chat has not been set up on this database yet.' };
	}
	return check;
}

export function leagueChannel(db: Db): { id: number; name: string } | null {
	const row = db
		.prepare('SELECT id, name FROM chat_channels WHERE key = ?')
		.get(LEAGUE_CHANNEL_KEY) as { id: number; name: string } | undefined;
	return row ?? null;
}

/** Every registered member except the viewer — the DM picker (AC-B1). */
export function loadChatCandidates(db: Db, viewerPlayerId: number): ChatCandidate[] {
	const rows = db
		.prepare(
			`SELECT p.id AS player_id, p.display_name AS name, p.initials, p.avatar_tone AS tone,
			        t.id AS thread_id
			   FROM players p
			   LEFT JOIN chat_threads t
			     ON (t.player_low_id = @me AND t.player_high_id = p.id)
			     OR (t.player_high_id = @me AND t.player_low_id = p.id)
			  WHERE p.is_active = 1 AND p.id <> @me
			  ORDER BY p.display_name COLLATE NOCASE`
		)
		.all({ me: viewerPlayerId }) as Array<{
		player_id: number;
		name: string;
		initials: string;
		tone: string;
		thread_id: number | null;
	}>;
	return rows.map((row) => ({
		playerId: row.player_id,
		name: row.name,
		initials: row.initials,
		tone: row.tone,
		threadId: row.thread_id
	}));
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export function loadLeagueChannel(
	db: Db,
	viewer: ViewerPlayer,
	options: LoadMessagesOptions = {}
): ChatChannelView {
	const channel = leagueChannel(db);
	if (!channel) throw new ChatNotFoundError('Chat has not been set up on this database yet.');
	const loaded = loadMessages(db, { kind: 'channel', id: channel.id }, viewer.playerId, options);
	return {
		channelId: channel.id,
		channelName: channel.name,
		messages: loaded.messages,
		hasEarlier: loaded.hasEarlier,
		latestId: loaded.latestId
	};
}

/** The thread row plus its partner, or null when this viewer is not a participant. */
function loadThreadRow(
	db: Db,
	viewerPlayerId: number,
	threadId: number
): { id: number; partner: ChatThreadPartner } | null {
	const row = db
		.prepare(
			`SELECT t.id, t.player_low_id, t.player_high_id,
			        p.id AS partner_id, p.display_name AS partner_name, p.initials, p.avatar_tone
			   FROM chat_threads t
			   JOIN players p
			     ON p.id = CASE WHEN t.player_low_id = ? THEN t.player_high_id ELSE t.player_low_id END
			  WHERE t.id = ? AND (t.player_low_id = ? OR t.player_high_id = ?)`
		)
		.get(viewerPlayerId, threadId, viewerPlayerId, viewerPlayerId) as
		| {
				id: number;
				player_low_id: number;
				player_high_id: number;
				partner_id: number;
				partner_name: string;
				initials: string;
				avatar_tone: string;
		  }
		| undefined;
	if (!row) return null;
	return {
		id: row.id,
		partner: {
			playerId: row.partner_id,
			name: row.partner_name,
			initials: row.initials,
			tone: row.avatar_tone
		}
	};
}

/**
 * A thread view, or null for anyone who is not one of the two participants —
 * including admins (AC-B2/AC-C6: the same answer as a nonexistent thread).
 */
export function loadDirectThread(
	db: Db,
	viewer: ViewerPlayer | null,
	threadId: number,
	options: LoadMessagesOptions = {}
): ChatThreadView | null {
	if (!viewer || !Number.isInteger(threadId) || threadId < 1) return null;
	const participants = db
		.prepare('SELECT player_low_id, player_high_id FROM chat_threads WHERE id = ?')
		.get(threadId) as { player_low_id: number; player_high_id: number } | undefined;
	if (!participants) return null;
	const gate = canViewDirectThread(viewer, [participants.player_low_id, participants.player_high_id]);
	if (!gate.allowed) return null;
	const thread = loadThreadRow(db, viewer.playerId, threadId);
	if (!thread) return null;
	const loaded = loadMessages(db, { kind: 'thread', id: thread.id }, viewer.playerId, options);
	return {
		threadId: thread.id,
		partner: thread.partner,
		messages: loaded.messages,
		hasEarlier: loaded.hasEarlier,
		latestId: loaded.latestId
	};
}

/** Unread counts, excluding the viewer's own, deleted and admin-hidden messages (AC-F2). */
export function loadChatBadge(db: Db, viewer: ViewerPlayer | null): ChatBadgeSummary {
	if (!viewer) return { league: 0, direct: 0, total: 0 };
	const channel = leagueChannel(db);
	const league = channel
		? (db
				.prepare(
					`SELECT COUNT(*) AS n
					   FROM chat_messages m
					   LEFT JOIN chat_read_state rs
					     ON rs.player_id = ? AND rs.scope = 'channel' AND rs.scope_id = m.channel_id
					  WHERE m.channel_id = ?
					    AND m.author_player_id <> ?
					    AND m.deleted_at IS NULL AND m.hidden_at IS NULL
					    AND m.id > COALESCE(rs.last_read_message_id, 0)`
				)
				.get(viewer.playerId, channel.id, viewer.playerId) as { n: number }).n
		: 0;
	const direct = (
		db
			.prepare(
				`SELECT COUNT(*) AS n
				   FROM chat_messages m
				   JOIN chat_threads t ON t.id = m.thread_id
				   LEFT JOIN chat_read_state rs
				     ON rs.player_id = ? AND rs.scope = 'thread' AND rs.scope_id = m.thread_id
				  WHERE (t.player_low_id = ? OR t.player_high_id = ?)
				    AND m.author_player_id <> ?
				    AND m.deleted_at IS NULL AND m.hidden_at IS NULL
				    AND m.id > COALESCE(rs.last_read_message_id, 0)`
			)
			.get(viewer.playerId, viewer.playerId, viewer.playerId, viewer.playerId) as { n: number }
	).n;
	return { league, direct, total: league + direct };
}

export function loadDirectThreads(
	db: Db,
	viewer: ViewerPlayer | null
): { threads: ChatThreadSummary[]; unreadTotal: number } {
	if (!viewer) return { threads: [], unreadTotal: 0 };
	const rows = db
		.prepare(
			`SELECT t.id AS thread_id,
			        p.id AS partner_id, p.display_name AS partner_name, p.initials, p.avatar_tone,
			        m.id AS last_message_id, m.body AS last_body, m.created_at AS last_created_at,
			        m.deleted_at AS last_deleted_at, m.hidden_at AS last_hidden_at,
			        m.author_player_id AS last_author_id,
			        (SELECT COUNT(*)
			           FROM chat_messages um
			           LEFT JOIN chat_read_state rs
			             ON rs.player_id = ? AND rs.scope = 'thread' AND rs.scope_id = t.id
			          WHERE um.thread_id = t.id
			            AND um.author_player_id <> ?
			            AND um.deleted_at IS NULL AND um.hidden_at IS NULL
			            AND um.id > COALESCE(rs.last_read_message_id, 0)) AS unread
			   FROM chat_threads t
			   JOIN players p
			     ON p.id = CASE WHEN t.player_low_id = ? THEN t.player_high_id ELSE t.player_low_id END
			   LEFT JOIN chat_messages m
			     ON m.id = (SELECT id FROM chat_messages WHERE thread_id = t.id ORDER BY id DESC LIMIT 1)
			  WHERE t.player_low_id = ? OR t.player_high_id = ?
			  ORDER BY COALESCE(m.id, 0) DESC, t.id DESC`
		)
		.all(
			viewer.playerId,
			viewer.playerId,
			viewer.playerId,
			viewer.playerId,
			viewer.playerId
		) as Array<{
		thread_id: number;
		partner_id: number;
		partner_name: string;
		initials: string;
		avatar_tone: string;
		last_message_id: number | null;
		last_body: string | null;
		last_created_at: string | null;
		last_deleted_at: string | null;
		last_hidden_at: string | null;
		last_author_id: number | null;
		unread: number;
	}>;

	const threads: ChatThreadSummary[] = rows.map((row) => {
		const state: ChatMessageState = row.last_hidden_at
			? 'hidden'
			: row.last_deleted_at
				? 'deleted'
				: 'visible';
		return {
			threadId: row.thread_id,
			partner: {
				playerId: row.partner_id,
				name: row.partner_name,
				initials: row.initials,
				tone: row.avatar_tone
			},
			unread: row.unread,
			lastMessage:
				row.last_message_id === null || row.last_created_at === null
					? null
					: {
							id: row.last_message_id,
							createdAt: row.last_created_at,
							authorIsMe: row.last_author_id === viewer.playerId,
							state,
							preview: state === 'visible' ? (row.last_body ?? '') : ''
						}
		};
	});
	return {
		threads,
		unreadTotal: threads.reduce((sum, thread) => sum + thread.unread, 0)
	};
}

/* ------------------------------------------------------------------ *
 * Read cursors (AC-F1)
 * ------------------------------------------------------------------ */

export function markChannelRead(
	db: Db,
	playerId: number,
	channelId: number,
	upToMessageId: number,
	options: { now?: Date } = {}
): void {
	if (upToMessageId < 1) return;
	const now = options.now ?? new Date();
	db.prepare(
		`INSERT INTO chat_read_state (player_id, scope, scope_id, last_read_message_id, updated_at)
		 VALUES (?, 'channel', ?, ?, ?)
		 ON CONFLICT (player_id, scope, scope_id) DO UPDATE SET
		   last_read_message_id = MAX(chat_read_state.last_read_message_id, excluded.last_read_message_id),
		   updated_at = excluded.updated_at`
	).run(playerId, channelId, upToMessageId, now.toISOString());
}

export function markThreadRead(
	db: Db,
	playerId: number,
	threadId: number,
	upToMessageId: number,
	options: { now?: Date } = {}
): void {
	if (upToMessageId < 1) return;
	const now = options.now ?? new Date();
	db.prepare(
		`INSERT INTO chat_read_state (player_id, scope, scope_id, last_read_message_id, updated_at)
		 VALUES (?, 'thread', ?, ?, ?)
		 ON CONFLICT (player_id, scope, scope_id) DO UPDATE SET
		   last_read_message_id = MAX(chat_read_state.last_read_message_id, excluded.last_read_message_id),
		   updated_at = excluded.updated_at`
	).run(playerId, threadId, upToMessageId, now.toISOString());
}

/* ------------------------------------------------------------------ *
 * Write paths
 * ------------------------------------------------------------------ */

interface WriteOptions {
	now?: Date;
}

function requireMember(db: Db, viewer: ViewerPlayer | null): ViewerPlayer {
	const gate = canUseChat(viewer);
	if (!gate.allowed || !viewer) {
		throw new ChatPermissionError(gate.reason ?? 'Sign in as a registered league player to use chat.');
	}
	return viewer;
}

function countSince(db: Db, sql: string, params: Array<number | string>, since: string): number {
	return (db.prepare(sql).get(...params, since) as { n: number }).n;
}

function assertMessageRateLimit(db: Db, playerId: number, now: Date): void {
	const since = new Date(now.getTime() - CHAT_MESSAGE_WINDOW_MS).toISOString();
	const sent = countSince(
		db,
		'SELECT COUNT(*) AS n FROM chat_messages WHERE author_player_id = ? AND created_at > ?',
		[playerId],
		since
	);
	if (sent >= CHAT_MESSAGES_PER_MINUTE) {
		throw new ChatRateLimitError(
			`That's ${CHAT_MESSAGES_PER_MINUTE} messages in a minute — give it a moment and try again.`,
			Math.ceil(CHAT_MESSAGE_WINDOW_MS / 1000)
		);
	}
}

function assertThreadRateLimit(db: Db, playerId: number, now: Date): void {
	const since = new Date(now.getTime() - CHAT_THREAD_WINDOW_MS).toISOString();
	const started = countSince(
		db,
		'SELECT COUNT(*) AS n FROM chat_threads WHERE created_by_player_id = ? AND created_at > ?',
		[playerId],
		since
	);
	if (started >= CHAT_NEW_THREADS_PER_HOUR) {
		throw new ChatRateLimitError(
			'You have started several new conversations this hour — try again a little later.',
			Math.ceil(CHAT_THREAD_WINDOW_MS / 1000)
		);
	}
}

function assertReportRateLimit(db: Db, playerId: number, now: Date): void {
	const since = new Date(now.getTime() - CHAT_REPORT_WINDOW_MS).toISOString();
	const reported = countSince(
		db,
		'SELECT COUNT(*) AS n FROM chat_reports WHERE reporter_player_id = ? AND created_at > ?',
		[playerId],
		since
	);
	if (reported >= CHAT_REPORTS_PER_HOUR) {
		throw new ChatRateLimitError(
			'You have sent several reports recently — an admin will see them. Try again later if needed.',
			Math.ceil(CHAT_REPORT_WINDOW_MS / 1000)
		);
	}
}

/** Post into the league channel. Everyone signed in can post (Q5e). */
export function postChannelMessage(
	db: Db,
	input: { actorPlayerId: number; body: string },
	options: WriteOptions = {}
): { messageId: number } {
	const now = options.now ?? new Date();
	const actor = requireMember(db, loadViewer(db, input.actorPlayerId));
	const channel = leagueChannel(db);
	if (!channel) throw new ChatNotFoundError('Chat has not been set up on this database yet.');
	const checked = normaliseChatBody(input.body);
	if (!checked.ok) throw new ChatValidationError([checked.error]);
	assertMessageRateLimit(db, actor.playerId, now);
	const result = db
		.prepare(
			`INSERT INTO chat_messages (channel_id, author_player_id, body, created_at)
			 VALUES (?, ?, ?, ?)`
		)
		.run(channel.id, actor.playerId, checked.value, now.toISOString());
	return { messageId: Number(result.lastInsertRowid) };
}

/**
 * Open (or find) the one thread between two registered members. Opening an
 * existing thread never counts against the new-thread rate limit and never
 * creates a second row (AC-B1).
 */
export function openDirectThread(
	db: Db,
	input: { actorPlayerId: number; otherPlayerId: number },
	options: WriteOptions = {}
): { threadId: number; created: boolean } {
	const now = options.now ?? new Date();
	const actor = requireMember(db, loadViewer(db, input.actorPlayerId));
	if (!Number.isInteger(input.otherPlayerId) || input.otherPlayerId < 1) {
		throw new ChatValidationError(['Choose who to message.']);
	}
	if (input.otherPlayerId === actor.playerId) {
		throw new ChatValidationError(['You cannot message yourself.']);
	}
	const other = db
		.prepare('SELECT id, display_name FROM players WHERE id = ? AND is_active = 1')
		.get(input.otherPlayerId) as { id: number; display_name: string } | undefined;
	if (!other) {
		throw new ChatValidationError(['That player is no longer in the league.']);
	}
	const [low, high] = actor.playerId < other.id ? [actor.playerId, other.id] : [other.id, actor.playerId];
	const existing = db
		.prepare('SELECT id FROM chat_threads WHERE player_low_id = ? AND player_high_id = ?')
		.get(low, high) as { id: number } | undefined;
	if (existing) return { threadId: existing.id, created: false };

	assertThreadRateLimit(db, actor.playerId, now);
	const result = db
		.prepare(
			`INSERT INTO chat_threads (player_low_id, player_high_id, created_by_player_id, created_at)
			 VALUES (?, ?, ?, ?)`
		)
		.run(low, high, actor.playerId, now.toISOString());
	return { threadId: Number(result.lastInsertRowid), created: true };
}

/** Post into a DM thread. Participants only; there is no admin override (AC-B3). */
export function postDirectMessage(
	db: Db,
	input: { actorPlayerId: number; threadId: number; body: string },
	options: WriteOptions = {}
): { messageId: number } {
	const now = options.now ?? new Date();
	const actor = requireMember(db, loadViewer(db, input.actorPlayerId));
	const thread = loadThreadRow(db, actor.playerId, input.threadId);
	if (!thread) throw new ChatNotFoundError();
	const checked = normaliseChatBody(input.body);
	if (!checked.ok) throw new ChatValidationError([checked.error]);
	assertMessageRateLimit(db, actor.playerId, now);
	const result = db
		.prepare(
			`INSERT INTO chat_messages (thread_id, author_player_id, body, created_at)
			 VALUES (?, ?, ?, ?)`
		)
		.run(thread.id, actor.playerId, checked.value, now.toISOString());
	return { messageId: Number(result.lastInsertRowid) };
}

/**
 * Soft-delete your own message (AC-D2). Nobody else can — there is no admin
 * delete, only a documented hide through a report. Idempotent: deleting twice
 * changes nothing.
 */
export function deleteOwnMessage(
	db: Db,
	input: { actorPlayerId: number; messageId: number },
	options: WriteOptions = {}
): { deleted: boolean } {
	const now = options.now ?? new Date();
	const actor = requireMember(db, loadViewer(db, input.actorPlayerId));
	const message = loadMessageRow(db, input.messageId);
	if (!message) throw new ChatNotFoundError('That message could not be found.');
	if (!actorCanReadMessage(db, actor.playerId, message)) throw new ChatNotFoundError('That message could not be found.');
	if (message.author_player_id !== actor.playerId) {
		throw new ChatPermissionError('Only the author can delete their own message.');
	}
	if (message.hidden_at) {
		throw new ChatPermissionError('An admin decision on this message cannot be removed by deleting it.');
	}
	if (message.deleted_at) return { deleted: false };
	db.prepare(
		`UPDATE chat_messages SET deleted_at = ?, deleted_by_player_id = ?
		  WHERE id = ? AND deleted_at IS NULL`
	).run(now.toISOString(), actor.playerId, message.id);
	return { deleted: true };
}

/** Report a message you can read (AC-C1). Never deletes, never notifies the author. */
export function reportMessage(
	db: Db,
	input: { actorPlayerId: number; messageId: number; reason: string },
	options: WriteOptions = {}
): { reportId: number; duplicate: boolean } {
	const now = options.now ?? new Date();
	const actor = requireMember(db, loadViewer(db, input.actorPlayerId));
	const message = loadMessageRow(db, input.messageId);
	if (!message) throw new ChatNotFoundError('That message could not be found.');
	if (!actorCanReadMessage(db, actor.playerId, message)) {
		throw new ChatNotFoundError('That message could not be found.');
	}
	if (message.hidden_at) {
		throw new ChatValidationError(['This message has already been hidden by an admin.']);
	}
	const checked = normaliseReportReason(input.reason);
	if (!checked.ok) throw new ChatValidationError([checked.error]);
	const existing = db
		.prepare(
			`SELECT id FROM chat_reports
			  WHERE message_id = ? AND reporter_player_id = ? AND status = 'open'`
		)
		.get(message.id, actor.playerId) as { id: number } | undefined;
	if (existing) return { reportId: existing.id, duplicate: true };
	assertReportRateLimit(db, actor.playerId, now);
	const result = db
		.prepare(
			`INSERT INTO chat_reports (message_id, reporter_player_id, reason, created_at, status)
			 VALUES (?, ?, ?, ?, 'open')`
		)
		.run(message.id, actor.playerId, checked.value, now.toISOString());
	return { reportId: Number(result.lastInsertRowid), duplicate: false };
}

/**
 * Resolve a report: hide the message (mandatory note, audited) or keep it
 * (mandatory note, audited). Admin/super-admin only (AC-C3/AC-C5).
 */
export function reviewReport(
	db: Db,
	input: {
		actorPlayerId: number;
		reportId: number;
		decision: 'hide' | 'keep';
		note: string;
	},
	options: WriteOptions = {}
): { resolution: 'hidden' | 'kept' } {
	const now = options.now ?? new Date();
	const actor = loadViewer(db, input.actorPlayerId);
	const gate = canModerateChat(actor);
	if (!gate.allowed || !actor) {
		throw new ChatPermissionError(gate.reason ?? 'Administrator privileges are required to review reports.');
	}
	const checked = normaliseModerationNote(input.note);
	if (!checked.ok) throw new ChatValidationError([checked.error]);
	const report = db
		.prepare('SELECT id, message_id, reporter_player_id, status FROM chat_reports WHERE id = ?')
		.get(input.reportId) as
		| { id: number; message_id: number; reporter_player_id: number; status: 'open' | 'resolved' }
		| undefined;
	if (!report) throw new ChatNotFoundError('That report could not be found.');
	if (report.status !== 'open') {
		throw new ChatValidationError(['That report has already been resolved.']);
	}
	const message = loadMessageRow(db, report.message_id);
	if (!message) throw new ChatNotFoundError('That message could not be found.');

	const resolution: 'hidden' | 'kept' = input.decision === 'hide' ? 'hidden' : 'kept';
	const run = db.transaction(() => {
		if (resolution === 'hidden' && !message.hidden_at) {
			db.prepare(
				`UPDATE chat_messages SET hidden_at = ?, hidden_by_player_id = ?, hidden_reason = ?
				  WHERE id = ? AND hidden_at IS NULL`
			).run(now.toISOString(), actor.playerId, checked.value, message.id);
		}
		db.prepare(
			`UPDATE chat_reports
			    SET status = 'resolved', reviewed_by_player_id = ?, reviewed_at = ?,
			        resolution = ?, review_note = ?
			  WHERE id = ? AND status = 'open'`
		).run(actor.playerId, now.toISOString(), resolution, checked.value, report.id);
		recordAudit(db, {
			entityType: 'chat_report',
			entityId: report.id,
			action: resolution === 'hidden' ? 'chat_report_hidden' : 'chat_report_kept',
			actorPlayerId: actor.playerId,
			reason: checked.value,
			detail: {
				messageId: message.id,
				messageAuthorId: message.author_player_id,
				reporterPlayerId: report.reporter_player_id
			}
		});
		if (resolution === 'hidden') {
			recordAudit(db, {
				entityType: 'chat_message',
				entityId: message.id,
				action: 'chat_message_hidden',
				actorPlayerId: actor.playerId,
				reason: checked.value,
				detail: { reportId: report.id, messageAuthorId: message.author_player_id }
			});
		}
	});
	run();
	return { resolution };
}

/* ------------------------------------------------------------------ *
 * Message lookups shared by the writes
 * ------------------------------------------------------------------ */

interface MessageLookupRow extends MessageRow {
	channel_id: number | null;
	thread_id: number | null;
}

function loadMessageRow(db: Db, messageId: number): MessageLookupRow | null {
	const row = db
		.prepare(
			`SELECT m.id, m.author_player_id, p.display_name AS author_name, p.initials,
			        p.avatar_tone, m.body, m.created_at, m.deleted_at, m.hidden_at,
			        m.channel_id, m.thread_id
			   FROM chat_messages m
			   JOIN players p ON p.id = m.author_player_id
			  WHERE m.id = ?`
		)
		.get(messageId) as MessageLookupRow | undefined;
	return row ?? null;
}

/** Channel messages are readable by every member; thread messages by participants only. */
function actorCanReadMessage(db: Db, playerId: number, message: { channel_id: number | null; thread_id: number | null }): boolean {
	if (message.channel_id !== null) return true;
	if (message.thread_id === null) return false;
	return loadThreadRow(db, playerId, message.thread_id) !== null;
}

/* ------------------------------------------------------------------ *
 * Admin report queue
 * ------------------------------------------------------------------ */

export function loadReportQueue(
	db: Db,
	viewer: ViewerPlayer | null
): { open: ChatReportView[]; resolved: ChatReportView[] } {
	const gate = canModerateChat(viewer);
	if (!gate.allowed) return { open: [], resolved: [] };
	const rows = db
		.prepare(
			`SELECT r.id, r.message_id, r.reporter_player_id, r.reason, r.created_at, r.status,
			        r.resolution, r.reviewed_at, r.review_note,
			        m.body, m.created_at AS message_created_at, m.deleted_at, m.hidden_at,
			        m.channel_id, m.thread_id,
			        author.display_name AS author_name,
			        reporter.display_name AS reporter_name,
			        reviewer.display_name AS reviewer_name
			   FROM chat_reports r
			   JOIN chat_messages m ON m.id = r.message_id
			   JOIN players author ON author.id = m.author_player_id
			   JOIN players reporter ON reporter.id = r.reporter_player_id
			   LEFT JOIN players reviewer ON reviewer.id = r.reviewed_by_player_id
			  ORDER BY r.created_at ASC, r.id ASC`
		)
		.all() as Array<{
		id: number;
		message_id: number;
		reporter_player_id: number;
		reason: string;
		created_at: string;
		status: 'open' | 'resolved';
		resolution: 'hidden' | 'kept' | null;
		reviewed_at: string | null;
		review_note: string | null;
		body: string;
		message_created_at: string;
		deleted_at: string | null;
		hidden_at: string | null;
		channel_id: number | null;
		thread_id: number | null;
		author_name: string;
		reporter_name: string;
		reviewer_name: string | null;
	}>;

	const views = rows.map((row) => {
		const state: ChatMessageState = row.hidden_at ? 'hidden' : row.deleted_at ? 'deleted' : 'visible';
		return {
			id: row.id,
			messageId: row.message_id,
			// The original text stays visible *here only* so a moderation decision
			// can be reviewed (AC-C4).
			messageBody: row.body,
			messageState: state,
			messageAuthorName: row.author_name,
			messageCreatedAt: row.message_created_at,
			destination: row.channel_id !== null ? ('channel' as const) : ('thread' as const),
			reporterName: row.reporter_name,
			reporterPlayerId: row.reporter_player_id,
			reason: row.reason,
			createdAt: row.created_at,
			status: row.status,
			resolution: row.resolution,
			reviewedByName: row.reviewer_name,
			reviewedAt: row.reviewed_at,
			reviewNote: row.review_note
		};
	});
	return {
		open: views.filter((view) => view.status === 'open'),
		resolved: views.filter((view) => view.status === 'resolved').reverse().slice(0, 20)
	};
}

/* ------------------------------------------------------------------ *
 * Internal: a ViewerPlayer for a player id
 * ------------------------------------------------------------------ */

/**
 * Resolve a player id to the viewer shape the permission helpers expect. The
 * routes already hold a verified viewer; tests and the seed call the write paths
 * with an id, so this keeps one definition of "a registered member".
 */
function loadViewer(db: Db, playerId: number): ViewerPlayer | null {
	const row = db
		.prepare(
			`SELECT id, display_name, initials, avatar_tone, email, role, phone, contact_visible
			   FROM players WHERE id = ? AND is_active = 1`
		)
		.get(playerId) as
		| {
				id: number;
				display_name: string;
				initials: string;
				avatar_tone: string;
				email: string;
				role: ViewerPlayer['role'];
				phone: string | null;
				contact_visible: number;
		  }
		| undefined;
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
