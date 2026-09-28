/**
 * PROVISIONAL PREVIEW DATA — fictional, for the Phase 1 visual checkpoint only.
 *
 * These rows mirror the approved static prototype (`prototype/`) so the owner
 * can compare the direction. Phase 2 replaces this file with standings computed
 * from seeded SQLite fixtures/results; Phase 3 removes it entirely.
 * Never treat this as live league data.
 */
import type { StandingRow } from './standings';

export const PROVISIONAL_NOTICE =
	'Preview data · fictional · replaced by the real league engine in Phase 2';

export const roundRows: StandingRow[] = [
	{ name: 'Maya Chen', initials: 'MC', tone: 'maya', played: 6, points: 12, frameDiff: 6, wins: 6 },
	{ name: 'Leon Park', initials: 'LP', tone: 'leon', played: 6, points: 11, frameDiff: 4, wins: 5 },
	{ name: 'Jules Rivera', initials: 'JR', tone: 'jules', played: 6, points: 11, frameDiff: 0, wins: 3, award: true },
	{ name: 'Sam Wilson', initials: 'SW', tone: 'sam', played: 6, points: 10, frameDiff: 2, wins: 4 },
	{ name: 'Priya Desai', initials: 'PD', tone: 'priya', played: 5, points: 8, frameDiff: 1, wins: 2 },
	{ name: 'Owen Brooks', initials: 'OB', tone: 'owen', played: 5, points: 7, frameDiff: -1, wins: 1 },
	{ name: 'Ella Thompson', initials: 'ET', tone: 'ella', played: 5, points: 5, frameDiff: -5, wins: 1 },
	{ name: 'Noah Kim', initials: 'NK', tone: 'noah', played: 5, points: 4, frameDiff: -7, wins: 0 }
];

export const seasonRows: StandingRow[] = [
	{ name: 'Maya Chen', initials: 'MC', tone: 'maya', played: 36, points: 67, frameDiff: 26, wins: 28 },
	{ name: 'Leon Park', initials: 'LP', tone: 'leon', played: 36, points: 62, frameDiff: 16, wins: 25 },
	{ name: 'Jules Rivera', initials: 'JR', tone: 'jules', played: 35, points: 60, frameDiff: 11, wins: 22, award: true },
	{ name: 'Sam Wilson', initials: 'SW', tone: 'sam', played: 35, points: 55, frameDiff: 5, wins: 20 },
	{ name: 'Priya Desai', initials: 'PD', tone: 'priya', played: 34, points: 52, frameDiff: 2, wins: 17 },
	{ name: 'Owen Brooks', initials: 'OB', tone: 'owen', played: 34, points: 47, frameDiff: -8, wins: 12 },
	{ name: 'Ella Thompson', initials: 'ET', tone: 'ella', played: 33, points: 40, frameDiff: -19, wins: 9 },
	{ name: 'Noah Kim', initials: 'NK', tone: 'noah', played: 33, points: 33, frameDiff: -33, wins: 5 }
];
