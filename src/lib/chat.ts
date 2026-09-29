/**
 * Chat & direct messages — pure, client-safe rules (Phase 13, docs/spec/chat.md).
 *
 * No database and no Svelte: the browser validates a message with exactly the
 * rules the server enforces (`src/lib/server/chat.ts`), and both sides format a
 * message the same way. Kept deliberately small — chat has one kind of content
 * (plain text) and no editing, so most of the interesting logic is
 * authorization, which lives server-side.
 */

/** A message is one piece of plain text, 1–2000 characters after normalising. */
export const CHAT_MAX_LENGTH = 2000;
export const CHAT_MIN_LENGTH = 1;

/** Rate limits (owner-confirmed Q5 defaults, docs/spec/chat.md §4 E). */
export const CHAT_MESSAGES_PER_MINUTE = 20;
export const CHAT_MESSAGE_WINDOW_MS = 60_000;
export const CHAT_NEW_THREADS_PER_HOUR = 5;
export const CHAT_THREAD_WINDOW_MS = 60 * 60_000;
export const CHAT_REPORTS_PER_HOUR = 5;
export const CHAT_REPORT_WINDOW_MS = 60 * 60_000;

/** How often an open chat view quietly re-reads the newest messages. */
export const CHAT_POLL_INTERVAL_MS = 10_000;

export const CHAT_DELETED_PLACEHOLDER = 'This message was deleted.';
export const CHAT_HIDDEN_PLACEHOLDER = 'This message was hidden by an admin.';

export type ChatMessageState = 'visible' | 'deleted' | 'hidden';

export type ChatBodyResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * Normalise a typed message into what will be stored and displayed: line breaks
 * are preserved (a message may be a short list), runs of spaces or tabs inside a
 * line collapse to one space, and leading/trailing blank lines are dropped.
 *
 * Everything is plain text — `<script>` and `**bold**` are stored and shown
 * exactly as typed, never interpreted (AC-D4).
 */
export function normaliseChatBody(raw: unknown): ChatBodyResult {
	if (typeof raw !== 'string') {
		return { ok: false, error: 'Write a message before sending.' };
	}
	const lines = raw
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim());
	while (lines.length > 0 && lines[0] === '') lines.shift();
	while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
	const value = lines.join('\n');

	if (value.length < CHAT_MIN_LENGTH) {
		return { ok: false, error: 'Write a message before sending.' };
	}
	if (value.length > CHAT_MAX_LENGTH) {
		return {
			ok: false,
			error: `Messages are limited to ${CHAT_MAX_LENGTH} characters — this one is ${value.length}.`
		};
	}
	return { ok: true, value };
}

/** The report reason has to say *something*; the schema allows 3–500 characters. */
export function normaliseReportReason(raw: unknown): ChatBodyResult {
	if (typeof raw !== 'string') {
		return { ok: false, error: 'Add a short reason for the report.' };
	}
	const value = raw.replace(/\s+/g, ' ').trim();
	if (value.length < 3) {
		return { ok: false, error: 'Add a short reason (at least 3 characters) so an admin can review it.' };
	}
	if (value.length > 500) {
		return { ok: false, error: 'Keep the report reason under 500 characters.' };
	}
	return { ok: true, value };
}

/** An admin's hide/keep note is mandatory and follows the same shape. */
export function normaliseModerationNote(raw: unknown): ChatBodyResult {
	if (typeof raw !== 'string') {
		return { ok: false, error: 'Add a short note explaining this decision.' };
	}
	const value = raw.replace(/\s+/g, ' ').trim();
	if (value.length < 3) {
		return { ok: false, error: 'Add a short note (at least 3 characters) explaining this decision.' };
	}
	if (value.length > 500) {
		return { ok: false, error: 'Keep the note under 500 characters.' };
	}
	return { ok: true, value };
}

/** What a reader actually sees for a message row. */
export function chatMessageText(message: { state: ChatMessageState; body: string | null }): string {
	if (message.state === 'deleted') return CHAT_DELETED_PLACEHOLDER;
	if (message.state === 'hidden') return CHAT_HIDDEN_PLACEHOLDER;
	return message.body ?? '';
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
];

/** The league-local calendar day an instant falls on (`YYYY-MM-DD`). */
export function chatDayKey(instant: string, timeZone: string): string {
	const date = new Date(instant);
	if (!Number.isFinite(date.getTime())) return instant.slice(0, 10);
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(date);
	const lookup = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? '';
	return `${lookup('year')}-${lookup('month')}-${lookup('day')}`;
}

/** `Today`, `Yesterday`, or `Tue 29 Sep 2026` — never a bare timestamp. */
export function chatDayLabel(dayKey: string, todayKey: string): string {
	const today = new Date(`${todayKey}T00:00:00Z`).getTime();
	const target = new Date(`${dayKey}T00:00:00Z`).getTime();
	if (!Number.isFinite(today) || !Number.isFinite(target)) return dayKey;
	const diff = Math.round((today - target) / DAY_MS);
	if (diff === 0) return 'Today';
	if (diff === 1) return 'Yesterday';
	const date = new Date(target);
	return `${WEEKDAYS_SHORT[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** `2026-09-29T15:07:00.000Z` → `4:07 pm` in the league timezone. */
export function chatTimeLabel(instant: string, timeZone: string): string {
	const date = new Date(instant);
	if (!Number.isFinite(date.getTime())) return '';
	return new Intl.DateTimeFormat('en-GB', {
		timeZone,
		hour: 'numeric',
		minute: '2-digit',
		hour12: true
	})
		.format(date)
		.replace(/\s/g, ' ')
		.toLowerCase();
}

export interface ChatMessageLike {
	id: number;
	createdAt: string;
}

/**
 * Group an ordered message list into day sections for rendering (AC-A2).
 * Order is preserved; the caller passes messages oldest-first.
 */
export function groupMessagesByDay<T extends ChatMessageLike>(
	messages: T[],
	timeZone: string,
	todayKey: string
): Array<{ dayKey: string; label: string; messages: T[] }> {
	const groups: Array<{ dayKey: string; label: string; messages: T[] }> = [];
	for (const message of messages) {
		const dayKey = chatDayKey(message.createdAt, timeZone);
		const last = groups[groups.length - 1];
		if (last && last.dayKey === dayKey) {
			last.messages.push(message);
		} else {
			groups.push({ dayKey, label: chatDayLabel(dayKey, todayKey), messages: [message] });
		}
	}
	return groups;
}
