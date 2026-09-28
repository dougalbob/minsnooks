export interface LocalDateTimeParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

function partsInZone(date: Date, timeZone: string): LocalDateTimeParts {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(date);
	const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
	return {
		year: value('year'),
		month: value('month'),
		day: value('day'),
		hour: value('hour'),
		minute: value('minute'),
		second: value('second')
	};
}

function utcValue(parts: LocalDateTimeParts): number {
	return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

/** Convert a league-local wall-clock value to an instant, including DST offset. */
export function localDateTimeToUtc(parts: LocalDateTimeParts, timeZone: string): Date {
	// Starting at the same components interpreted as UTC, iteratively correct by
	// the difference between those components and the requested zone's display.
	const target = utcValue(parts);
	let candidate = target;
	for (let attempt = 0; attempt < 4; attempt++) {
		const actual = partsInZone(new Date(candidate), timeZone);
		const correction = target - utcValue(actual);
		if (correction === 0) break;
		candidate += correction;
	}
	return new Date(candidate);
}

function validDate(year: number, month: number, day: number): boolean {
	const test = new Date(Date.UTC(year, month - 1, day));
	return test.getUTCFullYear() === year && test.getUTCMonth() + 1 === month && test.getUTCDate() === day;
}

export function isIsoDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	return Boolean(match && validDate(Number(match[1]), Number(match[2]), Number(match[3])));
}

export function localDateString(date: Date, timeZone: string): string {
	const parts = partsInZone(date, timeZone);
	return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function localDateTimeInputValue(date: Date, timeZone: string): string {
	const parts = partsInZone(date, timeZone);
	return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

/** The stored deadline is the end of the selected calendar date in league time. */
export function deadlineAtForLocalDate(date: string, timeZone: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!match) throw new Error('Choose a valid deadline date.');
	const parts = {
		year: Number(match[1]),
		month: Number(match[2]),
		day: Number(match[3]),
		hour: 23,
		minute: 59,
		second: 59
	};
	if (!validDate(parts.year, parts.month, parts.day)) throw new Error('Choose a valid deadline date.');
	return localDateTimeToUtc(parts, timeZone).toISOString();
}

/** Add calendar days in the league timezone, preserving the local wall-clock time. */
export function addLocalCalendarDays(date: Date, days: number, timeZone: string): Date {
	if (!Number.isInteger(days) || days < 0) throw new Error('Calendar days must be a non-negative integer.');
	const parts = partsInZone(date, timeZone);
	const nextDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
	return localDateTimeToUtc(
		{
			year: nextDay.getUTCFullYear(),
			month: nextDay.getUTCMonth() + 1,
			day: nextDay.getUTCDate(),
			hour: parts.hour,
			minute: parts.minute,
			second: parts.second
		},
		timeZone
	);
}

export function gracePeriodEndsAt(deadlineAt: string, graceDays: number, timeZone: string): Date {
	const deadline = new Date(deadlineAt);
	if (!Number.isFinite(deadline.getTime())) throw new Error('Round deadline is invalid.');
	return addLocalCalendarDays(deadline, graceDays, timeZone);
}

export function deadlineAfterLocalDays(now: Date, durationDays: number, timeZone: string): string {
	const selectedDate = localDateString(addLocalCalendarDays(now, durationDays, timeZone), timeZone);
	return deadlineAtForLocalDate(selectedDate, timeZone);
}

/** Parse a datetime-local form value as a time in the league timezone. */
export function parseLocalDateTimeInput(value: string, timeZone: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
	if (!match) return null;
	const parts: LocalDateTimeParts = {
		year: Number(match[1]),
		month: Number(match[2]),
		day: Number(match[3]),
		hour: Number(match[4]),
		minute: Number(match[5]),
		second: 0
	};
	if (
		!validDate(parts.year, parts.month, parts.day) ||
		parts.hour > 23 ||
		parts.minute > 59
	) return null;
	const date = localDateTimeToUtc(parts, timeZone);
	const roundTrip = partsInZone(date, timeZone);
	if (utcValue(roundTrip) !== utcValue(parts)) return null;
	return date;
}

/** SQLite's datetime('now') omits a zone; treat it as UTC, as SQLite does. */
export function sqliteInstant(value: string): Date {
	const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
		? `${value.replace(' ', 'T')}Z`
		: value;
	const parsed = new Date(normalized);
	if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid stored timestamp: ${value}`);
	return parsed;
}

export function isPlayedDateWithinRoundWindow(options: {
	actualPlayedDate: string;
	openedAt: string;
	deadlineAt: string | null;
	graceDays: number;
	timeZone: string;
}): boolean {
	if (!isIsoDate(options.actualPlayedDate) || !options.deadlineAt) return false;
	const openingDate = localDateString(sqliteInstant(options.openedAt), options.timeZone);
	const lastEligibleDate = localDateString(
		gracePeriodEndsAt(options.deadlineAt, options.graceDays, options.timeZone),
		options.timeZone
	);
	return options.actualPlayedDate >= openingDate && options.actualPlayedDate <= lastEligibleDate;
}
