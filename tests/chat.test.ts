/**
 * Chat & direct messages (Phase 13) — the acceptance criteria in
 * `docs/spec/chat.md` §4 and §9, asserted against isolated databases.
 *
 * The interesting invariants are authorization (a DM thread belongs to its two
 * participants and to nobody else — admins included), the append-only message
 * lifecycle (no editing; author deletion leaves a placeholder; only a reported
 * message can be hidden, with a reason), the rate limits, and the fact that no
 * chat write can touch league state.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { runMigrations } from '../src/lib/server/migrate';
import { createSeason, openRound, saveLeagueResult } from '../src/lib/server/league';
import { computeStandings } from '../src/lib/server/standings';
import { loadViewerPlayer, type ViewerPlayer } from '../src/lib/server/viewer';
import {
	CHAT_MAX_LENGTH,
	CHAT_MESSAGES_PER_MINUTE,
	CHAT_NEW_THREADS_PER_HOUR,
	CHAT_REPORTS_PER_HOUR,
	chatDayLabel,
	chatMessageText,
	chatTimeLabel,
	groupMessagesByDay,
	normaliseChatBody,
	normaliseModerationNote,
	normaliseReportReason
} from '../src/lib/chat';
import {
	ChatNotFoundError,
	ChatPermissionError,
	ChatRateLimitError,
	ChatValidationError,
	chatGate,
	deleteOwnMessage,
	leagueChannel,
	loadChatBadge,
	loadChatCandidates,
	loadDirectThread,
	loadDirectThreads,
	loadLeagueChannel,
	loadReportQueue,
	markChannelRead,
	markThreadRead,
	openDirectThread,
	postChannelMessage,
	postDirectMessage,
	reportMessage,
	reviewReport
} from '../src/lib/server/chat';

const migrations = path.resolve(process.cwd(), 'migrations');
const openDbs: Db[] = [];

const NOW = new Date('2026-09-29T12:00:00.000Z');
const TODAY = '2026-09-29';

function freshDb(): Db {
	const file = path.join(os.tmpdir(), `minsnooks-chat-${Date.now()}-${Math.random()}.db`);
	const db = openDb(file);
	openDbs.push(db);
	runMigrations(db, migrations);
	return db;
}

afterEach(() => {
	while (openDbs.length) {
		const db = openDbs.pop()!;
		try {
			const file = db.name;
			db.close();
			for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true });
		} catch {
			/* best effort */
		}
	}
});

let playerCounter = 0;

function addPlayer(
	db: Db,
	name: string,
	role: 'player' | 'admin' | 'super_admin' = 'player'
): ViewerPlayer {
	playerCounter += 1;
	const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}.${playerCounter}@example.test`;
	db.prepare(
		`INSERT INTO players (email, display_name, initials, avatar_tone, role)
		 VALUES (?, ?, ?, 'maya', ?)`
	).run(
		email,
		name,
		name
			.split(' ')
			.map((part) => part[0])
			.join('')
			.toUpperCase(),
		role
	);
	return loadViewerPlayer(db, email)!;
}

/** A cast with enough members to exercise every rule in one test. */
function cast(db: Db): {
	maya: ViewerPlayer;
	leon: ViewerPlayer;
	priya: ViewerPlayer;
	owen: ViewerPlayer;
	noah: ViewerPlayer;
	sam: ViewerPlayer;
	ella: ViewerPlayer;
	admin: ViewerPlayer;
} {
	return {
		maya: addPlayer(db, 'Maya Chen'),
		leon: addPlayer(db, 'Leon Park'),
		priya: addPlayer(db, 'Priya Desai'),
		owen: addPlayer(db, 'Owen Brooks'),
		noah: addPlayer(db, 'Noah Kim'),
		sam: addPlayer(db, 'Sam Wilson'),
		ella: addPlayer(db, 'Ella Thompson'),
		admin: addPlayer(db, 'Ada Admin', 'admin')
	};
}

/* ------------------------------------------------------------------ *
 * Pure rules
 * ------------------------------------------------------------------ */

describe('chat validation (pure rules)', () => {
	it('normalises whitespace, keeps line breaks, and rejects empty or oversized bodies', () => {
		expect(normaliseChatBody('  hello   there  ')).toEqual({ ok: true, value: 'hello there' });
		expect(normaliseChatBody('line one\r\nline two')).toEqual({
			ok: true,
			value: 'line one\nline two'
		});
		expect(normaliseChatBody('\n\n  \n')).toEqual({
			ok: false,
			error: 'Write a message before sending.'
		});
		expect(normaliseChatBody('x'.repeat(CHAT_MAX_LENGTH))).toEqual({
			ok: true,
			value: 'x'.repeat(CHAT_MAX_LENGTH)
		});
		const tooLong = normaliseChatBody('x'.repeat(CHAT_MAX_LENGTH + 1));
		expect(tooLong.ok).toBe(false);
	});

	it('requires a real reason and a real moderation note', () => {
		expect(normaliseReportReason(' needs   a look ')).toEqual({
			ok: true,
			value: 'needs a look'
		});
		expect(normaliseReportReason('ab').ok).toBe(false);
		expect(normaliseReportReason('   ').ok).toBe(false);
		expect(normaliseModerationNote('').ok).toBe(false);
		expect(normaliseModerationNote('kept — nothing wrong').ok).toBe(true);
	});

	it('renders placeholders instead of removed text', () => {
		expect(chatMessageText({ state: 'visible', body: 'hello' })).toBe('hello');
		expect(chatMessageText({ state: 'deleted', body: null })).toBe('This message was deleted.');
		expect(chatMessageText({ state: 'hidden', body: null })).toBe(
			'This message was hidden by an admin.'
		);
	});

	it('labels days in the league timezone and groups an ordered list', () => {
		expect(chatDayLabel('2026-09-29', TODAY)).toBe('Today');
		expect(chatDayLabel('2026-09-28', TODAY)).toBe('Yesterday');
		expect(chatDayLabel('2026-09-26', TODAY)).toBe('Sat 26 Sep 2026');
		// 23:30 UTC on the 28th is already the 29th in London (BST).
		expect(chatTimeLabel('2026-09-28T23:30:00.000Z', 'Europe/London')).toBe('12:30 am');
		const groups = groupMessagesByDay(
			[
				{ id: 1, createdAt: '2026-09-28T08:00:00.000Z' },
				{ id: 2, createdAt: '2026-09-28T09:00:00.000Z' },
				{ id: 3, createdAt: '2026-09-29T09:00:00.000Z' }
			],
			'Europe/London',
			TODAY
		);
		expect(groups.map((group) => [group.label, group.messages.length])).toEqual([
			['Yesterday', 2],
			['Today', 1]
		]);
	});
});

/* ------------------------------------------------------------------ *
 * League channel
 * ------------------------------------------------------------------ */

describe('league channel', () => {
	it('refuses visitors and hides all content from them (AC-A1)', () => {
		const db = freshDb();
		const gate = chatGate(db, null);
		expect(gate.allowed).toBe(false);
		expect(loadChatBadge(db, null)).toEqual({ league: 0, direct: 0, total: 0 });
		expect(loadDirectThreads(db, null).threads).toEqual([]);
	});

	it('keeps strict order, tie-breaking on id, and preserves text literally (AC-A2/A5/D4)', () => {
		const db = freshDb();
		const { maya, leon } = cast(db);
		const first = postChannelMessage(
			db,
			{ actorPlayerId: maya.playerId, body: '<script>alert(1)</script>' },
			{ now: NOW }
		);
		const second = postChannelMessage(
			db,
			{ actorPlayerId: leon.playerId, body: '**bold** and  double  spaces' },
			{ now: NOW }
		);
		const channel = loadLeagueChannel(db, maya);
		expect(channel.messages.map((message) => message.id)).toEqual([
			first.messageId,
			second.messageId
		]);
		expect(channel.messages[0].body).toBe('<script>alert(1)</script>');
		expect(channel.messages[1].body).toBe('**bold** and double spaces');
		expect(channel.latestId).toBe(second.messageId);
	});

	it('lets a withdrawn member keep posting — chat is not a league action (AC-A4)', () => {
		const db = freshDb();
		const { maya, leon } = cast(db);
		const seasonId = createSeason(db, {
			label: 'chat-season',
			framesPerMatch: 3,
			pointsPerFrame: 1,
			matchWinBonus: 0,
			timezone: 'Europe/London'
		});
		db.prepare(
			`INSERT INTO player_withdrawals (player_id, effective_from_season_id, effective_from_round, reason)
			 VALUES (?, ?, 2, 'Fictional test withdrawal')`
		).run(leon.playerId, seasonId);

		const channel = leagueChannel(db)!;
		const posted = postChannelMessage(
			db,
			{ actorPlayerId: leon.playerId, body: 'Still here!' },
			{ now: NOW }
		);
		expect(loadLeagueChannel(db, leon).messages.at(-1)?.id).toBe(posted.messageId);
		// And they can still be messaged.
		const thread = openDirectThread(
			db,
			{ actorPlayerId: maya.playerId, otherPlayerId: leon.playerId },
			{ now: NOW }
		);
		expect(thread.created).toBe(true);
		expect(leagueChannel(db)!.id).toBe(channel.id);
	});

	it('refuses empty and oversized messages without storing anything (AC-A3)', () => {
		const db = freshDb();
		const { maya } = cast(db);
		expect(() =>
			postChannelMessage(db, { actorPlayerId: maya.playerId, body: '   ' }, { now: NOW })
		).toThrow(ChatValidationError);
		expect(() =>
			postChannelMessage(
				db,
				{ actorPlayerId: maya.playerId, body: 'x'.repeat(CHAT_MAX_LENGTH + 1) },
				{ now: NOW }
			)
		).toThrow(ChatValidationError);
		const count = db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get() as { n: number };
		expect(count.n).toBe(0);
		// Simulated inactive accounts cannot post at all.
		expect(() =>
			postChannelMessage(db, { actorPlayerId: 9999, body: 'hello' }, { now: NOW })
		).toThrow(ChatPermissionError);
	});
});

/* ------------------------------------------------------------------ *
 * Direct messages
 * ------------------------------------------------------------------ */

describe('direct messages', () => {
	it('creates exactly one thread per pair, from either side (AC-B1)', () => {
		const db = freshDb();
		const { maya, leon } = cast(db);
		const first = openDirectThread(
			db,
			{ actorPlayerId: maya.playerId, otherPlayerId: leon.playerId },
			{ now: NOW }
		);
		const reverse = openDirectThread(
			db,
			{ actorPlayerId: leon.playerId, otherPlayerId: maya.playerId },
			{ now: NOW }
		);
		expect(first.created).toBe(true);
		expect(reverse.created).toBe(false);
		expect(reverse.threadId).toBe(first.threadId);
		const count = db.prepare('SELECT COUNT(*) AS n FROM chat_threads').get() as { n: number };
		expect(count.n).toBe(1);
	});

	it('hides a thread from everybody except its two participants (AC-B2/B3/C6)', () => {
		const db = freshDb();
		const { maya, leon, priya, admin } = cast(db);
		const { threadId } = openDirectThread(
			db,
			{ actorPlayerId: maya.playerId, otherPlayerId: leon.playerId },
			{ now: NOW }
		);
		postDirectMessage(
			db,
			{ actorPlayerId: maya.playerId, threadId, body: 'Private note' },
			{ now: NOW }
		);

		expect(loadDirectThread(db, maya, threadId)?.messages).toHaveLength(1);
		expect(loadDirectThread(db, leon, threadId)?.messages).toHaveLength(1);
		// Same answer as a nonexistent thread, for a peer *and* for an admin.
		expect(loadDirectThread(db, priya, threadId)).toBeNull();
		expect(loadDirectThread(db, admin, threadId)).toBeNull();
		expect(loadDirectThread(db, maya, 999)).toBeNull();
		expect(loadDirectThread(db, null, threadId)).toBeNull();

		expect(() =>
			postDirectMessage(
				db,
				{ actorPlayerId: priya.playerId, threadId, body: 'Let me in' },
				{ now: NOW }
			)
		).toThrow(ChatNotFoundError);
	});

	it('refuses self-messaging and lists candidates without the viewer (AC-B6)', () => {
		const db = freshDb();
		const { maya, leon } = cast(db);
		expect(() =>
			openDirectThread(db, { actorPlayerId: maya.playerId, otherPlayerId: maya.playerId }, { now: NOW })
		).toThrow(ChatValidationError);
		const candidates = loadChatCandidates(db, maya.playerId);
		expect(candidates.map((candidate) => candidate.name)).not.toContain('Maya Chen');
		expect(candidates).toHaveLength(7);
		// Starting a conversation marks the candidate as already-open.
		openDirectThread(db, { actorPlayerId: maya.playerId, otherPlayerId: leon.playerId }, { now: NOW });
		const after = loadChatCandidates(db, maya.playerId).find(
			(candidate) => candidate.playerId === leon.playerId
		);
		expect(after?.threadId).toBeGreaterThan(0);
	});

	it('orders the inbox by activity and shows placeholders for removed last messages (AC-B4/B5)', () => {
		const db = freshDb();
		const { maya, leon, priya } = cast(db);
		const older = openDirectThread(
			db,
			{ actorPlayerId: maya.playerId, otherPlayerId: priya.playerId },
			{ now: NOW }
		);
		const newer = openDirectThread(
			db,
			{ actorPlayerId: maya.playerId, otherPlayerId: leon.playerId },
			{ now: NOW }
		);
		postDirectMessage(
			db,
			{ actorPlayerId: maya.playerId, threadId: older.threadId, body: 'first thread' },
			{ now: NOW }
		);
		const last = postDirectMessage(
			db,
			{ actorPlayerId: leon.playerId, threadId: newer.threadId, body: 'newest thread' },
			{ now: new Date(NOW.getTime() + 60_000) }
		);
		let inbox = loadDirectThreads(db, maya);
		expect(inbox.threads.map((thread) => thread.threadId)).toEqual([
			newer.threadId,
			older.threadId
		]);
		expect(inbox.threads[0].lastMessage?.preview).toBe('newest thread');
		expect(inbox.threads[0].unread).toBe(1);
		expect(inbox.unreadTotal).toBe(1);

		deleteOwnMessage(
			db,
			{ actorPlayerId: leon.playerId, messageId: last.messageId },
			{ now: new Date(NOW.getTime() + 120_000) }
		);
		inbox = loadDirectThreads(db, maya);
		expect(inbox.threads[0].lastMessage?.state).toBe('deleted');
		// A deleted message cannot inflate an unread badge either.
		expect(inbox.threads[0].unread).toBe(0);
	});
});

/* ------------------------------------------------------------------ *
 * Reports & moderation
 * ------------------------------------------------------------------ */

describe('reports and moderation', () => {
	it('records one open report per reporter and never touches the message (AC-C1/C2)', () => {
		const db = freshDb();
		const { maya, leon, priya } = cast(db);
		const { messageId } = postChannelMessage(
			db,
			{ actorPlayerId: maya.playerId, body: 'A message to report' },
			{ now: NOW }
		);
		const first = reportMessage(
			db,
			{ actorPlayerId: leon.playerId, messageId, reason: 'Test report one' },
			{ now: NOW }
		);
		const again = reportMessage(
			db,
			{ actorPlayerId: leon.playerId, messageId, reason: 'Test report two' },
			{ now: NOW }
		);
		expect(first.duplicate).toBe(false);
		expect(again.duplicate).toBe(true);
		expect(again.reportId).toBe(first.reportId);
		const reports = db.prepare('SELECT COUNT(*) AS n FROM chat_reports').get() as { n: number };
		expect(reports.n).toBe(1);
		// Still visible and unchanged, for everyone.
		expect(loadLeagueChannel(db, priya).messages[0].state).toBe('visible');

		expect(() =>
			reportMessage(db, { actorPlayerId: leon.playerId, messageId, reason: 'no' }, { now: NOW })
		).toThrow(ChatValidationError);
	});

	it('refuses to report a message the actor cannot read', () => {
		const db = freshDb();
		const { maya, leon, priya } = cast(db);
		const { threadId } = openDirectThread(
			db,
			{ actorPlayerId: maya.playerId, otherPlayerId: leon.playerId },
			{ now: NOW }
		);
		const { messageId } = postDirectMessage(
			db,
			{ actorPlayerId: maya.playerId, threadId, body: 'Private' },
			{ now: NOW }
		);
		expect(() =>
			reportMessage(db, { actorPlayerId: priya.playerId, messageId, reason: 'Butting in' }, { now: NOW })
		).toThrow(ChatNotFoundError);
	});

	it('hides a reported message with a mandatory audited note and keeps the text reviewable (AC-C3/C4/C5)', () => {
		const db = freshDb();
		const { maya, leon, priya, admin } = cast(db);
		const { messageId } = postChannelMessage(
			db,
			{ actorPlayerId: maya.playerId, body: 'Something regrettable' },
			{ now: NOW }
		);
		const { reportId } = reportMessage(
			db,
			{ actorPlayerId: leon.playerId, messageId, reason: 'It reads badly' },
			{ now: NOW }
		);

		// A player cannot moderate.
		expect(() =>
			reviewReport(
				db,
				{ actorPlayerId: priya.playerId, reportId, decision: 'hide', note: 'Let me decide' },
				{ now: NOW }
			)
		).toThrow(ChatPermissionError);
		// A note is mandatory.
		expect(() =>
			reviewReport(
				db,
				{ actorPlayerId: admin.playerId, reportId, decision: 'hide', note: '  ' },
				{ now: NOW }
			)
		).toThrow(ChatValidationError);

		expect(
			reviewReport(
				db,
				{ actorPlayerId: admin.playerId, reportId, decision: 'hide', note: 'Hidden after review' },
				{ now: NOW }
			).resolution
		).toBe('hidden');

		// Everyone sees the placeholder — the author included.
		const channel = loadLeagueChannel(db, maya);
		expect(channel.messages[0].state).toBe('hidden');
		expect(channel.messages[0].body).toBeNull();
		expect(chatMessageText(channel.messages[0])).toBe('This message was hidden by an admin.');
		expect(channel.messages[0].canDelete).toBe(false);

		// The admin queue still shows the original text and the decision.
		const queue = loadReportQueue(db, admin);
		expect(queue.open).toHaveLength(0);
		expect(queue.resolved[0].messageBody).toBe('Something regrettable');
		expect(queue.resolved[0].resolution).toBe('hidden');
		expect(queue.resolved[0].reviewNote).toBe('Hidden after review');
		expect(loadReportQueue(db, priya)).toEqual({ open: [], resolved: [] });

		const audits = db
			.prepare("SELECT action, actor_player_id, reason FROM audit_log WHERE entity_type = 'chat_message'")
			.all() as Array<{ action: string; actor_player_id: number; reason: string }>;
		expect(audits).toEqual([
			{
				action: 'chat_message_hidden',
				actor_player_id: admin.playerId,
				reason: 'Hidden after review'
			}
		]);
		// A resolved report cannot be reviewed twice.
		expect(() =>
			reviewReport(
				db,
				{ actorPlayerId: admin.playerId, reportId, decision: 'keep', note: 'Changed my mind' },
				{ now: NOW }
			)
		).toThrow(ChatValidationError);
	});

	it('lets an admin keep a message, with the decision audited (AC-C3)', () => {
		const db = freshDb();
		const { maya, leon, admin } = cast(db);
		const { messageId } = postChannelMessage(
			db,
			{ actorPlayerId: maya.playerId, body: 'Harmless' },
			{ now: NOW }
		);
		const { reportId } = reportMessage(
			db,
			{ actorPlayerId: leon.playerId, messageId, reason: 'Misread it' },
			{ now: NOW }
		);
		expect(
			reviewReport(
				db,
				{ actorPlayerId: admin.playerId, reportId, decision: 'keep', note: 'Nothing wrong here' },
				{ now: NOW }
			).resolution
		).toBe('kept');
		expect(loadLeagueChannel(db, maya).messages[0].state).toBe('visible');
		const audit = db
			.prepare("SELECT action FROM audit_log WHERE entity_type = 'chat_report'")
			.get() as { action: string };
		expect(audit.action).toBe('chat_report_kept');
	});

	it('excludes hidden messages from unread counts (AC-F2)', () => {
		const db = freshDb();
		const { maya, leon, admin } = cast(db);
		postChannelMessage(db, { actorPlayerId: maya.playerId, body: 'One' }, { now: NOW });
		const second = postChannelMessage(
			db,
			{ actorPlayerId: maya.playerId, body: 'Two' },
			{ now: NOW }
		);
		expect(loadChatBadge(db, leon).league).toBe(2);
		const { reportId } = reportMessage(
			db,
			{ actorPlayerId: leon.playerId, messageId: second.messageId, reason: 'Reported for the test' },
			{ now: NOW }
		);
		reviewReport(
			db,
			{ actorPlayerId: admin.playerId, reportId, decision: 'hide', note: 'Hidden for the test' },
			{ now: NOW }
		);
		expect(loadChatBadge(db, leon).league).toBe(1);
	});
});

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

describe('message lifecycle', () => {
	it('lets only the author delete, keeps order, and shows a placeholder (AC-D2)', () => {
		const db = freshDb();
		const { maya, leon, priya } = cast(db);
		const first = postChannelMessage(
			db,
			{ actorPlayerId: maya.playerId, body: 'First' },
			{ now: NOW }
		);
		postChannelMessage(db, { actorPlayerId: leon.playerId, body: 'Second' }, { now: NOW });

		expect(() =>
			deleteOwnMessage(
				db,
				{ actorPlayerId: priya.playerId, messageId: first.messageId },
				{ now: NOW }
			)
		).toThrow(ChatPermissionError);

		expect(
			deleteOwnMessage(db, { actorPlayerId: maya.playerId, messageId: first.messageId }, { now: NOW })
				.deleted
		).toBe(true);
		// Idempotent: deleting twice is not an error and changes nothing further.
		expect(
			deleteOwnMessage(db, { actorPlayerId: maya.playerId, messageId: first.messageId }, { now: NOW })
				.deleted
		).toBe(false);

		const channel = loadLeagueChannel(db, leon);
		expect(channel.messages.map((message) => message.state)).toEqual(['deleted', 'visible']);
		expect(chatMessageText(channel.messages[0])).toBe('This message was deleted.');
	});

	it('has no edit path and no scheduled deletion (AC-D1/D3)', () => {
		const schema = fs.readFileSync(path.resolve(process.cwd(), 'migrations/0011_chat.sql'), 'utf8');
		expect(schema).not.toMatch(/updated_at\s+TEXT[^)]*body/i);
		const server = fs.readFileSync(
			path.resolve(process.cwd(), 'src/lib/server/chat.ts'),
			'utf8'
		);
		// The only UPDATE of a message writes the soft-delete / hidden columns.
		const messageUpdates = server.match(/UPDATE chat_messages[^`]*/g) ?? [];
		expect(messageUpdates.length).toBeGreaterThan(0);
		for (const statement of messageUpdates) expect(statement).not.toMatch(/SET\s+body/);
		expect(server).not.toMatch(/DELETE FROM chat_messages/);
		const lifecycle = fs.readFileSync(
			path.resolve(process.cwd(), 'src/lib/server/lifecycle.ts'),
			'utf8'
		);
		expect(lifecycle).not.toMatch(/chat_/);
	});
});

/* ------------------------------------------------------------------ *
 * Rate limits
 * ------------------------------------------------------------------ */

describe('rate limits', () => {
	it('stops at twenty messages a minute and frees up in the next window (AC-E1/E4)', () => {
		const db = freshDb();
		const { maya } = cast(db);
		for (let index = 0; index < CHAT_MESSAGES_PER_MINUTE; index += 1) {
			postChannelMessage(db, { actorPlayerId: maya.playerId, body: `Message ${index}` }, { now: NOW });
		}
		expect(() =>
			postChannelMessage(db, { actorPlayerId: maya.playerId, body: 'One too many' }, { now: NOW })
		).toThrow(ChatRateLimitError);
		const stored = db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get() as { n: number };
		expect(stored.n).toBe(CHAT_MESSAGES_PER_MINUTE);
		// A minute later the window has moved on.
		expect(() =>
			postChannelMessage(
				db,
				{ actorPlayerId: maya.playerId, body: 'Next window' },
				{ now: new Date(NOW.getTime() + 61_000) }
			)
		).not.toThrow();
	});

	it('limits new conversations per hour but reopening an existing one is free (AC-E2)', () => {
		const db = freshDb();
		const { maya, leon, priya, owen, noah, sam, ella } = cast(db);
		const others = [leon, priya, owen, noah, sam];
		for (const other of others) {
			openDirectThread(
				db,
				{ actorPlayerId: maya.playerId, otherPlayerId: other.playerId },
				{ now: NOW }
			);
		}
		// Reopening one of the existing five costs nothing.
		expect(
			openDirectThread(
				db,
				{ actorPlayerId: maya.playerId, otherPlayerId: leon.playerId },
				{ now: NOW }
			).created
		).toBe(false);
		expect(() =>
			openDirectThread(
				db,
				{ actorPlayerId: maya.playerId, otherPlayerId: ella.playerId },
				{ now: NOW }
			)
		).toThrow(ChatRateLimitError);
		expect(others).toHaveLength(CHAT_NEW_THREADS_PER_HOUR);
		const threads = db.prepare('SELECT COUNT(*) AS n FROM chat_threads').get() as { n: number };
		expect(threads.n).toBe(CHAT_NEW_THREADS_PER_HOUR);
	});

	it('caps reports per hour without stacking duplicates (AC-E3)', () => {
		const db = freshDb();
		const { maya, leon } = cast(db);
		const messages: number[] = [];
		for (let index = 0; index < CHAT_REPORTS_PER_HOUR + 1; index += 1) {
			const { messageId } = postChannelMessage(
				db,
				{ actorPlayerId: maya.playerId, body: `Reportable ${index}` },
				{ now: NOW }
			);
			messages.push(messageId);
		}
		for (const messageId of messages.slice(0, CHAT_REPORTS_PER_HOUR)) {
			reportMessage(
				db,
				{ actorPlayerId: leon.playerId, messageId, reason: `Reason for message ${messageId}` },
				{ now: NOW }
			);
		}
		expect(() =>
			reportMessage(
				db,
				{ actorPlayerId: leon.playerId, messageId: messages[CHAT_REPORTS_PER_HOUR], reason: 'One report too many' },
				{ now: NOW }
			)
		).toThrow(ChatRateLimitError);
		const stored = db.prepare('SELECT COUNT(*) AS n FROM chat_reports').get() as { n: number };
		expect(stored.n).toBe(CHAT_REPORTS_PER_HOUR);
	});
});

/* ------------------------------------------------------------------ *
 * Unread state
 * ------------------------------------------------------------------ */

describe('unread state', () => {
	it('counts only other people’s visible messages and clears when read (AC-F1/F2)', () => {
		const db = freshDb();
		const { maya, leon } = cast(db);
		postChannelMessage(db, { actorPlayerId: maya.playerId, body: 'Mine' }, { now: NOW });
		const fromLeon = postChannelMessage(
			db,
			{ actorPlayerId: leon.playerId, body: 'Yours to read' },
			{ now: NOW }
		);
		expect(loadChatBadge(db, maya).league).toBe(1);
		markChannelRead(db, maya.playerId, leagueChannel(db)!.id, fromLeon.messageId, { now: NOW });
		expect(loadChatBadge(db, maya).league).toBe(0);

		const { threadId } = openDirectThread(
			db,
			{ actorPlayerId: maya.playerId, otherPlayerId: leon.playerId },
			{ now: NOW }
		);
		postDirectMessage(db, { actorPlayerId: leon.playerId, threadId, body: 'DM' }, { now: NOW });
		expect(loadChatBadge(db, maya).direct).toBe(1);
		markThreadRead(db, maya.playerId, threadId, 0, { now: NOW });
		expect(loadChatBadge(db, maya).direct).toBe(1);
		const lastMessage = loadDirectThread(db, maya, threadId)!.latestId;
		markThreadRead(db, maya.playerId, threadId, lastMessage, { now: NOW });
		expect(loadChatBadge(db, maya)).toEqual({ league: 0, direct: 0, total: 0 });
		// A read cursor never moves backwards.
		markThreadRead(db, maya.playerId, threadId, 1, { now: NOW });
		expect(loadChatBadge(db, maya).direct).toBe(0);
	});
});

/* ------------------------------------------------------------------ *
 * Separation from league state
 * ------------------------------------------------------------------ */

describe('separation from league state', () => {
	it('leaves the standings and results untouched no matter what chat does (AC-A6)', () => {
		const db = freshDb();
		const { maya, leon, admin } = cast(db);
		const seasonId = createSeason(db, {
			label: 'chat-separation',
			framesPerMatch: 3,
			pointsPerFrame: 1,
			matchWinBonus: 0,
			timezone: 'Europe/London'
		});
		const roundId = openRound(db, {
			seasonId,
			number: 1,
			playerIds: [maya.playerId, leon.playerId],
			deadlineAt: '2026-12-31T23:59:59.000Z',
			graceDays: 3,
			openedAt: '2026-09-01T00:00:00.000Z'
		});
		const fixture = db.prepare('SELECT id FROM fixtures WHERE round_id = ?').get(roundId) as {
			id: number;
		};
		saveLeagueResult(db, {
			fixtureId: fixture.id,
			submittedByPlayerId: maya.playerId,
			lowFrames: 2,
			highFrames: 1,
			actualPlayedDate: '2026-09-10',
			entrySource: 'admin_direct'
		});
		const before = computeStandings(db, { seasonId });
		const resultsBefore = db.prepare('SELECT COUNT(*) AS n FROM results').get() as { n: number };

		postChannelMessage(db, { actorPlayerId: maya.playerId, body: 'Good luck tonight' }, { now: NOW });
		const { messageId } = postChannelMessage(
			db,
			{ actorPlayerId: leon.playerId, body: 'You too' },
			{ now: NOW }
		);
		const { threadId } = openDirectThread(
			db,
			{ actorPlayerId: maya.playerId, otherPlayerId: leon.playerId },
			{ now: NOW }
		);
		postDirectMessage(db, { actorPlayerId: leon.playerId, threadId, body: 'Shall we play again?' }, { now: NOW });
		const { reportId } = reportMessage(
			db,
			{ actorPlayerId: leon.playerId, messageId, reason: 'Testing the separation rule' },
			{ now: NOW }
		);
		reviewReport(
			db,
			{ actorPlayerId: admin.playerId, reportId, decision: 'keep', note: 'Nothing wrong here' },
			{ now: NOW }
		);
		deleteOwnMessage(db, { actorPlayerId: leon.playerId, messageId }, { now: NOW });

		expect(computeStandings(db, { seasonId })).toEqual(before);
		expect(db.prepare('SELECT COUNT(*) AS n FROM results').get()).toEqual(resultsBefore);
		expect(db.prepare('SELECT COUNT(*) AS n FROM awards').get()).toEqual({ n: 0 });
		const chatRows = db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get() as { n: number };
		expect(chatRows.n).toBe(3);
	});
});
