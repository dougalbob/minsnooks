/**
 * Pure display helpers for planned and actual dates (shared by client and
 * server, no database access).
 *
 * League dates are stored as league-local calendar values (`YYYY-MM-DD`) and
 * optional local wall-clock times (`HH:MM`, 24-hour). They are formatted here so
 * the whole app presents them the same way — and so a planned date can never be
 * confused with an actual date played: the helpers are separate functions with
 * distinct labels in the UI.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

/** Parse `YYYY-MM-DD` as a plain calendar date (never shifted by a timezone). */
export function parseCalendarDate(value: string): { year: number; month: number; day: number } | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const test = new Date(Date.UTC(year, month - 1, day));
	if (
		test.getUTCFullYear() !== year ||
		test.getUTCMonth() + 1 !== month ||
		test.getUTCDate() !== day
	) {
		return null;
	}
	return { year, month, day };
}

/** `2026-10-03` → `Saturday, 3 October` (optionally with the year). */
export function formatCalendarDate(value: string, options: { year?: boolean } = {}): string {
	const parts = parseCalendarDate(value);
	if (!parts) return value;
	const weekday = WEEKDAYS[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()];
	const base = `${weekday}, ${parts.day} ${MONTHS[parts.month - 1]}`;
	return options.year ? `${base} ${parts.year}` : base;
}

/** `2026-10-03` → `3 October 2026` (compact, no weekday). */
export function formatShortDate(value: string): string {
	const parts = parseCalendarDate(value);
	if (!parts) return value;
	return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

/** `16:00` → `4:00 pm`. Anything unparseable is returned unchanged. */
export function formatTimeOfDay(time: string | null | undefined): string {
	if (!time) return '';
	const match = /^(\d{2}):(\d{2})$/.exec(time);
	if (!match) return time;
	const hour = Number(match[1]);
	const minute = match[2];
	const suffix = hour >= 12 ? 'pm' : 'am';
	const display = hour % 12 === 0 ? 12 : hour % 12;
	return `${display}:${minute} ${suffix}`;
}

/** A planned date, e.g. `Saturday, 3 October · 4:00 pm` (time optional). */
export function formatPlannedDate(date: string, time?: string | null): string {
	const day = formatCalendarDate(date);
	const clock = formatTimeOfDay(time);
	return clock ? `${day} · ${clock}` : day;
}

/** `2026-10-03T23:59:59...` → `3 October 2026` in the league's own calendar. */
export function formatInstantAsDate(value: string | null | undefined, timeZone: string): string | null {
	if (!value) return null;
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return null;
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(date);
	const lookup = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
	return formatCalendarDate(`${lookup('year')}-${lookup('month')}-${lookup('day')}`);
}

/** Frames as a scoreline, e.g. `2–1` (always low–high, matching storage). */
export function formatFrames(lowFrames: number, highFrames: number): string {
	return `${lowFrames}–${highFrames}`;
}
