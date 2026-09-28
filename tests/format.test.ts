import { describe, expect, it } from 'vitest';
import {
	formatCalendarDate,
	formatInstantAsDate,
	formatPlannedDate,
	formatShortDate,
	formatTimeOfDay,
	parseCalendarDate
} from '../src/lib/format';

describe('league date and time formatting', () => {
	it('formats a calendar date without shifting it by a timezone', () => {
		// 3 October 2026 is a Saturday (the prototype's arranged fixture).
		expect(formatCalendarDate('2026-10-03')).toBe('Saturday, 3 October');
		expect(formatCalendarDate('2026-10-03', { year: true })).toBe('Saturday, 3 October 2026');
		expect(formatShortDate('2026-09-26')).toBe('26 September 2026');
		expect(formatCalendarDate('2026-01-01')).toBe('Thursday, 1 January');
	});

	it('rejects impossible or malformed calendar values instead of guessing', () => {
		expect(parseCalendarDate('2026-02-30')).toBeNull();
		expect(parseCalendarDate('18/04/2026')).toBeNull();
		expect(formatCalendarDate('not-a-date')).toBe('not-a-date');
	});

	it('formats league-local times in 12-hour form', () => {
		expect(formatTimeOfDay('16:00')).toBe('4:00 pm');
		expect(formatTimeOfDay('09:30')).toBe('9:30 am');
		expect(formatTimeOfDay('00:15')).toBe('12:15 am');
		expect(formatTimeOfDay('12:00')).toBe('12:00 pm');
		expect(formatTimeOfDay(null)).toBe('');
	});

	it('builds a planned-date label that is clearly distinct from an actual date', () => {
		expect(formatPlannedDate('2026-10-03', '16:00')).toBe('Saturday, 3 October · 4:00 pm');
		expect(formatPlannedDate('2026-10-03', null)).toBe('Saturday, 3 October');
		// Same stored date, different labels: planned vs actually played.
		expect(formatPlannedDate('2026-09-26', '19:00')).not.toBe(formatShortDate('2026-09-26'));
	});

	it('renders a stored instant in the league calendar (including across DST)', () => {
		// 22:59:59Z on 15 October is already the 16th in Europe/London? No —
		// BST is UTC+1, so 22:59:59Z is 23:59:59 local on the 15th.
		expect(formatInstantAsDate('2026-10-15T22:59:59.000Z', 'Europe/London')).toBe('Thursday, 15 October');
		// And a winter instant keeps the same local day while UTC has moved on.
		expect(formatInstantAsDate('2026-12-31T23:30:00.000Z', 'Europe/London')).toBe('Thursday, 31 December');
		expect(formatInstantAsDate(null, 'Europe/London')).toBeNull();
	});
});
