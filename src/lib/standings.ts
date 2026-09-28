/**
 * Pure standings ranking (HANDOFF §4):
 * order by table points, frame difference, then match wins.
 * Players still tied share the same position (joint first = joint champions).
 *
 * Ball colour behind the PTS value follows the snooker sequence by position:
 * 1st black, 2nd pink, 3rd blue, 4th brown, 5th green, 6th yellow, 7th red,
 * later positions neutral. Tied players share the same positional treatment.
 * Colours are visual accents only (HANDOFF §2).
 *
 * Phase 2 replaces the provisional row source with the SQLite standings
 * engine; this ranking function remains the canonical ordering.
 */

export const BALL_SEQUENCE = [
	'black',
	'pink',
	'blue',
	'brown',
	'green',
	'yellow',
	'red',
	'neutral'
] as const;

export type BallColor = (typeof BALL_SEQUENCE)[number];

export interface StandingRow {
	name: string;
	initials: string;
	tone: string;
	played: number;
	points: number;
	frameDiff: number;
	wins: number;
	/** Table includes an administrative award (asterisk; table points only). */
	award?: boolean;
}

export interface RankedRow extends StandingRow {
	position: number;
	ball: BallColor;
}

export function rankRows(rows: StandingRow[]): RankedRow[] {
	const sorted = [...rows].sort(
		(a, b) =>
			b.points - a.points ||
			b.frameDiff - a.frameDiff ||
			b.wins - a.wins ||
			a.name.localeCompare(b.name)
	);

	let lastKey = '';
	let lastPosition = 0;
	return sorted.map((row, index) => {
		const key = `${row.points}|${row.frameDiff}|${row.wins}`;
		const position = key === lastKey ? lastPosition : index + 1;
		lastKey = key;
		lastPosition = position;
		return { ...row, position, ball: ballForPosition(position) };
	});
}

export function ballForPosition(position: number): BallColor {
	const index = Math.min(Math.max(position, 1) - 1, BALL_SEQUENCE.length - 1);
	return BALL_SEQUENCE[index];
}

export function formatDiff(diff: number): string {
	if (diff > 0) return `+${diff}`;
	if (diff < 0) return `−${Math.abs(diff)}`;
	return '0';
}
