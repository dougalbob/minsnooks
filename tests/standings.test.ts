import { describe, expect, it } from 'vitest';
import { ballForPosition, rankRows, type StandingRow } from '../src/lib/standings';

function row(partial: Partial<StandingRow> & { name: string }): StandingRow {
	return {
		initials: partial.name.slice(0, 2).toUpperCase(),
		tone: 'maya',
		played: 6,
		points: 0,
		frameDiff: 0,
		wins: 0,
		...partial
	};
}

describe('rankRows', () => {
	it('orders by table points, then frame difference, then match wins', () => {
		const ranked = rankRows([
			row({ name: 'C', points: 9, frameDiff: 1, wins: 2 }),
			row({ name: 'A', points: 10, frameDiff: -2, wins: 1 }),
			row({ name: 'B', points: 9, frameDiff: 4, wins: 1 }),
			row({ name: 'D', points: 9, frameDiff: 1, wins: 5 })
		]);
		expect(ranked.map((r) => r.name)).toEqual(['A', 'B', 'D', 'C']);
		expect(ranked.map((r) => r.position)).toEqual([1, 2, 3, 4]);
	});

	it('gives tied players the same shared position (competition ranking)', () => {
		const ranked = rankRows([
			row({ name: 'A', points: 10, frameDiff: 2, wins: 3 }),
			row({ name: 'B', points: 10, frameDiff: 2, wins: 3 }),
			row({ name: 'C', points: 4, frameDiff: -2, wins: 1 })
		]);
		expect(ranked.map((r) => [r.name, r.position])).toEqual([
			['A', 1],
			['B', 1],
			['C', 3]
		]);
	});

	it('supports joint first place as joint champions', () => {
		const ranked = rankRows([
			row({ name: 'A', points: 12, frameDiff: 6, wins: 6 }),
			row({ name: 'B', points: 12, frameDiff: 6, wins: 6 })
		]);
		expect(ranked.every((r) => r.position === 1)).toBe(true);
		expect(ranked.every((r) => r.ball === 'black')).toBe(true);
	});

	it('never rewrites the input array', () => {
		const input = [row({ name: 'A', points: 1 }), row({ name: 'B', points: 2 })];
		const copy = [...input];
		rankRows(input);
		expect(input).toEqual(copy);
	});
});

describe('ballForPosition', () => {
	it('follows the snooker colour sequence by position', () => {
		expect(['black', 'pink', 'blue', 'brown', 'green', 'yellow', 'red', 'neutral']).toEqual([
			ballForPosition(1),
			ballForPosition(2),
			ballForPosition(3),
			ballForPosition(4),
			ballForPosition(5),
			ballForPosition(6),
			ballForPosition(7),
			ballForPosition(8)
		]);
	});

	it('stays neutral for later positions and clamps bad input', () => {
		expect(ballForPosition(12)).toBe('neutral');
		expect(ballForPosition(0)).toBe('black');
		expect(ballForPosition(-3)).toBe('black');
	});
});
