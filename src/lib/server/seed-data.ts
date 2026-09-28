/**
 * Deterministic fictional league seed plan (Phase 2).
 *
 * All names, dates and scores are fictional. Nothing here touches V1.
 *
 * The plan is derived from the owner-approved prototype (`prototype/`):
 *   * the eight prototype players,
 *   * Round 6 of season 2026 as the current round, with the 22 confirmed
 *     results listed in the prototype and "22 of 28 results confirmed",
 *   * the season totals shown in the prototype's season table.
 *
 * Round 6 is reproduced exactly, and Rounds 1–5 are generated so that the
 * season table lands on the approved numbers: 138 confirmed results, two
 * administrative award points for Jules Rivera, and the frame difference / win
 * totals the mockup shows. Generation is fully deterministic (a seeded PRNG and
 * a fixture-orientation solver), so `npm run seed` is idempotent and repeatable.
 */
export interface SeedPlayer {
	key: string;
	name: string;
	initials: string;
	tone: string;
	email: string;
}

export const SEED_PLAYERS: SeedPlayer[] = [
	{ key: 'maya', name: 'Maya Chen', initials: 'MC', tone: 'maya', email: 'maya.chen@example.test' },
	{ key: 'leon', name: 'Leon Park', initials: 'LP', tone: 'leon', email: 'leon.park@example.test' },
	{ key: 'jules', name: 'Jules Rivera', initials: 'JR', tone: 'jules', email: 'jules.rivera@example.test' },
	{ key: 'sam', name: 'Sam Wilson', initials: 'SW', tone: 'sam', email: 'sam.wilson@example.test' },
	{ key: 'priya', name: 'Priya Desai', initials: 'PD', tone: 'priya', email: 'priya.desai@example.test' },
	{ key: 'owen', name: 'Owen Brooks', initials: 'OB', tone: 'owen', email: 'owen.brooks@example.test' },
	{ key: 'ella', name: 'Ella Thompson', initials: 'ET', tone: 'ella', email: 'ella.thompson@example.test' },
	{ key: 'noah', name: 'Noah Kim', initials: 'NK', tone: 'noah', email: 'noah.kim@example.test' }
];

export const PLAYER_KEYS = SEED_PLAYERS.map((player) => player.key);

export type Key = string;

/**
 * Canonical pair ordering for seed keys: the order players are seeded in, which
 * is the order their database ids are assigned in. This must agree with the
 * numeric ordering used against the fixtures table, otherwise frame counts
 * would be attached to the wrong player.
 */
const KEY_ORDER = new Map(SEED_PLAYERS.map((player, index) => [player.key, index]));

function orderKeys(a: Key, b: Key): [Key, Key] {
	return (KEY_ORDER.get(a) ?? 0) < (KEY_ORDER.get(b) ?? 0) ? [a, b] : [b, a];
}

export interface SeedResult {
	round: number;
	/** Canonical (low, high) pair. */
	low: Key;
	high: Key;
	lowFrames: number;
	highFrames: number;
	/** Actual date played — never derived from a booking. */
	playedDate: string;
	/** Optional frame-by-frame snooker points (HANDOFF §4). */
	frames?: Array<{ frameNumber: number; lowPoints: number; highPoints: number }>;
	/** Optional highest break per player. */
	breaks?: Array<{ player: Key; breakPoints: number }>;
}

/**
 * A fictional planned date (Phase 5). Bookings are plans only: they never
 * become results and are never used as the actual date played.
 */
export interface SeedBooking {
	low: Key;
	high: Key;
	/** League-local calendar date, YYYY-MM-DD. */
	date: string;
	/** Optional league-local wall-clock time, HH:MM. */
	time: string | null;
	proposedBy: Key;
	note?: string;
}

export interface SeedAward {
	round: number;
	low: Key;
	high: Key;
	/** Recipient of the table points. */
	recipient: Key;
	tablePoints: number;
	sourceType: 'previous_round_result' | 'random_draw' | 'manual';
	sourceResult?: { round: number; low: Key; high: Key };
	reason: string;
}

export interface LeagueSeedPlan {
	season: {
		label: string;
		framesPerMatch: number;
		pointsPerFrame: number;
		matchWinBonus: number;
		timezone: string;
	};
	rounds: Array<{
		number: number;
		status: 'open' | 'closed';
		isFinal: boolean;
		openedAt: string;
		deadlineAt: string;
		graceDays: number;
		players: Key[];
		withdrawn?: Key[];
		unplayed: Array<[Key, Key]>;
		results: SeedResult[];
		awards: SeedAward[];
		/** Planned dates (optional). Never results, never actual dates played. */
		bookings?: SeedBooking[];
	}>;
}

/* ------------------------------------------------------------------ *
 * Deterministic PRNG (mulberry32) — no Math.random anywhere.
 * ------------------------------------------------------------------ */
function makeRng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function hashSeed(text: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function shuffled<T>(items: T[], rng: () => number): T[] {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

/* ------------------------------------------------------------------ *
 * Round 6 — reproduced from the approved prototype (visual source of truth).
 * ------------------------------------------------------------------ */
const ROUND6_RESULTS: Array<[string, Key, Key, number, number]> = [
	['2026-09-26', 'maya', 'leon', 2, 1],
	['2026-09-25', 'maya', 'jules', 2, 1],
	['2026-09-24', 'maya', 'sam', 2, 1],
	['2026-09-23', 'maya', 'owen', 2, 1],
	['2026-09-22', 'maya', 'ella', 2, 1],
	['2026-09-21', 'maya', 'noah', 2, 1],
	['2026-09-20', 'leon', 'jules', 2, 1],
	['2026-09-19', 'leon', 'sam', 2, 1],
	['2026-09-18', 'leon', 'priya', 2, 1],
	['2026-09-17', 'leon', 'ella', 2, 1],
	['2026-09-16', 'leon', 'noah', 2, 1],
	['2026-09-15', 'sam', 'jules', 2, 1],
	['2026-09-14', 'jules', 'priya', 2, 1],
	['2026-09-13', 'jules', 'owen', 2, 1],
	['2026-09-12', 'jules', 'noah', 2, 1],
	['2026-09-11', 'sam', 'priya', 2, 1],
	['2026-09-10', 'sam', 'owen', 2, 1],
	['2026-09-09', 'sam', 'ella', 2, 1],
	['2026-09-08', 'priya', 'ella', 3, 0],
	['2026-09-07', 'priya', 'noah', 2, 1],
	['2026-09-06', 'ella', 'owen', 2, 1],
	['2026-09-05', 'owen', 'noah', 3, 0]
];

/* ------------------------------------------------------------------ *
 * Rounds 1–5 — generated so the season table matches the approved mockup.
 *
 * `targets` holds, per round, the number of match wins and the number of frames
 * won (table points from play) each player must finish the round with. Those
 * round-by-round figures sum to the season-minus-Round-6 totals implied by the
 * prototype's season table.
 *
 * `whitewashes` lists the 3–0 results, which are fixed by hand so the fallback
 * draw story in Round 6 (Noah's zero-point award) has a genuine source.
 * ------------------------------------------------------------------ */
interface RoundTarget {
	number: number;
	window: [string, string];
	deadlineAt: string;
	unplayed: Array<[Key, Key]>;
	targets: Record<Key, { wins: number; points: number }>;
	whitewashes: Array<[Key, Key]>;
	/** Extra 2–1 results that must be honoured exactly. */
	forced?: Array<[Key, Key]>;
}

const ROUND_TARGETS: RoundTarget[] = [
	{
		number: 1,
		window: ['2026-04-13', '2026-05-10'],
		deadlineAt: '2026-05-17T23:59:59+01:00',
		unplayed: [
			['ella', 'noah'],
			['jules', 'sam']
		],
		targets: {
			maya: { wins: 6, points: 14 },
			leon: { wins: 5, points: 13 },
			jules: { wins: 4, points: 11 },
			sam: { wins: 4, points: 11 },
			priya: { wins: 4, points: 10 },
			owen: { wins: 3, points: 10 },
			ella: { wins: 0, points: 5 },
			noah: { wins: 0, points: 4 }
		},
		whitewashes: [
			['maya', 'noah'],
			['leon', 'priya'],
			['jules', 'ella'],
			['sam', 'noah']
		]
	},
	{
		number: 2,
		window: ['2026-05-11', '2026-06-07'],
		deadlineAt: '2026-06-14T23:59:59+01:00',
		unplayed: [
			['maya', 'priya'],
			['leon', 'owen'],
			['ella', 'noah'],
			['jules', 'sam']
		],
		targets: {
			maya: { wins: 5, points: 11 },
			leon: { wins: 4, points: 9 },
			jules: { wins: 4, points: 10 },
			sam: { wins: 3, points: 9 },
			priya: { wins: 3, points: 9 },
			owen: { wins: 2, points: 8 },
			ella: { wins: 2, points: 8 },
			noah: { wins: 1, points: 8 }
		},
		whitewashes: [['noah', 'leon']]
	},
	{
		number: 3,
		window: ['2026-06-08', '2026-07-05'],
		deadlineAt: '2026-07-12T23:59:59+01:00',
		unplayed: [
			['maya', 'priya'],
			['leon', 'owen'],
			['jules', 'ella'],
			['sam', 'noah'],
			['ella', 'noah']
		],
		targets: {
			maya: { wins: 4, points: 11 },
			leon: { wins: 4, points: 10 },
			jules: { wins: 4, points: 10 },
			sam: { wins: 3, points: 9 },
			priya: { wins: 3, points: 8 },
			owen: { wins: 2, points: 8 },
			ella: { wins: 2, points: 8 },
			noah: { wins: 1, points: 5 }
		},
		whitewashes: [
			['maya', 'noah'],
			['ella', 'priya']
		]
	},
	{
		number: 4,
		window: ['2026-07-06', '2026-08-02'],
		deadlineAt: '2026-08-09T23:59:59+01:00',
		unplayed: [
			['maya', 'leon'],
			['maya', 'sam'],
			['jules', 'priya'],
			['owen', 'ella'],
			['sam', 'owen'],
			['ella', 'noah']
		],
		targets: {
			maya: { wins: 4, points: 10 },
			leon: { wins: 4, points: 10 },
			jules: { wins: 4, points: 9 },
			sam: { wins: 2, points: 7 },
			priya: { wins: 3, points: 9 },
			owen: { wins: 2, points: 8 },
			ella: { wins: 2, points: 7 },
			noah: { wins: 1, points: 6 }
		},
		whitewashes: [
			['maya', 'jules'],
			['owen', 'noah']
		]
	},
	{
		number: 5,
		window: ['2026-08-03', '2026-08-30'],
		deadlineAt: '2026-09-06T23:59:59+01:00',
		unplayed: [
			['maya', 'priya'],
			['leon', 'priya'],
			['jules', 'priya'],
			['sam', 'noah'],
			['owen', 'ella'],
			['leon', 'noah'],
			['jules', 'owen']
		],
		targets: {
			maya: { wins: 3, points: 9 },
			leon: { wins: 3, points: 9 },
			jules: { wins: 3, points: 9 },
			sam: { wins: 4, points: 9 },
			priya: { wins: 2, points: 8 },
			owen: { wins: 2, points: 6 },
			ella: { wins: 2, points: 7 },
			noah: { wins: 2, points: 6 }
		},
		whitewashes: [
			['maya', 'ella'],
			['leon', 'ella'],
			['jules', 'maya'],
			['priya', 'sam'],
			['priya', 'owen'],
			['ella', 'noah']
		],
		// Round 6's administrative award for Jules is taken from this genuine
		// previous-round result, so it must be exactly a 2–1 win for Jules.
		forced: [['jules', 'ella']]
	}
];

const ROUND6_UNPLAYED: Array<[Key, Key]> = [
	['maya', 'priya'],
	['leon', 'owen'],
	['jules', 'ella'],
	['sam', 'noah'],
	['priya', 'owen'],
	['ella', 'noah']
];

/* ------------------------------------------------------------------ *
 * Fixture orientation
 * ------------------------------------------------------------------ */
function pairKey(a: Key, b: Key): string {
	const [low, high] = orderKeys(a, b);
	return `${low}|${high}`;
}

interface OrientedMatch {
	low: Key;
	high: Key;
	winner: Key;
	whitewash: boolean;
}

/**
 * Orient a round's fixtures so every player finishes with exactly the required
 * number of match wins, honouring the fixed 3–0 results and any forced 2–1
 * results. Uses a randomised greedy pass with restarts; the PRNG is seeded per
 * round so the outcome is deterministic.
 */
function orientRound(
	target: RoundTarget,
	players: Key[]
): { matches: OrientedMatch[]; unplayed: Array<[Key, Key]> } {
	const fixtures: Array<[Key, Key]> = [];
	for (let i = 0; i < players.length; i++) {
		for (let j = i + 1; j < players.length; j++) {
			fixtures.push(orderKeys(players[i], players[j]));
		}
	}
	const unplayedKeys = new Set(target.unplayed.map(([a, b]) => pairKey(a, b)));
	const open = fixtures.filter(([a, b]) => !unplayedKeys.has(pairKey(a, b)));

	const remainingWins = new Map<Key, number>(players.map((key) => [key, target.targets[key].wins]));
	const decided = new Map<string, OrientedMatch>();

	const take = (a: Key, b: Key, winner: Key, whitewash: boolean) => {
		const [low, high] = orderKeys(a, b);
		decided.set(pairKey(low, high), { low, high, winner, whitewash });
		remainingWins.set(winner, (remainingWins.get(winner) ?? 0) - 1);
	};

	for (const [winner, loser] of target.whitewashes) {
		take(winner, loser, winner, true);
	}
	for (const [winner, loser] of target.forced ?? []) {
		take(winner, loser, winner, false);
	}

	const pool = open.filter(([a, b]) => !decided.has(pairKey(a, b)));
	const rng = makeRng(hashSeed(`orient-${target.number}`));

	for (let attempt = 0; attempt < 5000; attempt++) {
		const wins = new Map(remainingWins);
		const placed = new Map(decided);
		const order = shuffled(pool, rng);
		let ok = true;
		for (const [a, b] of order) {
			const canA = (wins.get(a) ?? 0) > 0;
			const canB = (wins.get(b) ?? 0) > 0;
			if (!canA && !canB) {
				ok = false;
				break;
			}
			const winner = canA && canB ? (rng() < 0.5 ? a : b) : canA ? a : b;
			const [low, high] = orderKeys(a, b);
			placed.set(pairKey(a, b), { low, high, winner, whitewash: false });
			wins.set(winner, (wins.get(winner) ?? 0) - 1);
			// A player can never need more wins than they have fixtures left.
			for (const key of players) {
				if ((wins.get(key) ?? 0) < 0) {
					ok = false;
					break;
				}
			}
			if (!ok) break;
		}
		if (ok && players.every((key) => (wins.get(key) ?? 0) === 0)) {
			return { matches: [...placed.values()], unplayed: target.unplayed };
		}
	}
	throw new Error(`Could not orient round ${target.number} to hit the target totals.`);
}

/** Verify a generated round against its targets (used by tests). */
export function verifyRound(
	target: RoundTarget,
	matches: OrientedMatch[]
): { wins: Record<Key, number>; points: Record<Key, number>; diffs: Record<Key, number> } {
	const wins: Record<Key, number> = {};
	const points: Record<Key, number> = {};
	const diffs: Record<Key, number> = {};
	for (const key of PLAYER_KEYS) {
		wins[key] = 0;
		points[key] = 0;
		diffs[key] = 0;
	}
	for (const match of matches) {
		const winnerFrames = match.whitewash ? 3 : 2;
		const loserFrames = match.whitewash ? 0 : 1;
		const loser = match.winner === match.low ? match.high : match.low;
		wins[match.winner] = (wins[match.winner] ?? 0) + 1;
		points[match.winner] = (points[match.winner] ?? 0) + winnerFrames;
		points[loser] = (points[loser] ?? 0) + loserFrames;
		diffs[match.winner] = (diffs[match.winner] ?? 0) + (winnerFrames - loserFrames);
		diffs[loser] = (diffs[loser] ?? 0) + (loserFrames - winnerFrames);
	}
	for (const key of PLAYER_KEYS) {
		if (wins[key] !== target.targets[key].wins) {
			throw new Error(`Round ${target.number}: ${key} won ${wins[key]}, expected ${target.targets[key].wins}`);
		}
		if (points[key] !== target.targets[key].points) {
			throw new Error(
				`Round ${target.number}: ${key} scored ${points[key]} points, expected ${target.targets[key].points}`
			);
		}
	}
	return { wins, points, diffs };
}

/* ------------------------------------------------------------------ *
 * Optional frame detail and breaks
 * ------------------------------------------------------------------ */
function dateRange(start: string, end: string): string[] {
	const dates: string[] = [];
	const cursor = new Date(`${start}T00:00:00Z`);
	const last = new Date(`${end}T00:00:00Z`);
	while (cursor <= last) {
		dates.push(cursor.toISOString().slice(0, 10));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return dates;
}

function buildFrameDetail(
	match: OrientedMatch,
	rng: () => number
): NonNullable<SeedResult['frames']> {
	const winnerFrames = match.whitewash ? 3 : 2;
	const loserFrames = match.whitewash ? 0 : 1;
	const total = winnerFrames + loserFrames;
	const lowIsWinner = match.low === match.winner;
	const frames: NonNullable<SeedResult['frames']> = [];
	for (let index = 0; index < total; index++) {
		const winnerWinsFrame = index < winnerFrames;
		const loserPoints = 12 + Math.floor(rng() * 48); // 12–59
		const winnerPoints = loserPoints + 7 + Math.floor(rng() * 45); // always ahead
		frames.push({
			frameNumber: index + 1,
			lowPoints: lowIsWinner === winnerWinsFrame ? winnerPoints : loserPoints,
			highPoints: lowIsWinner === winnerWinsFrame ? loserPoints : winnerPoints
		});
	}
	return frames;
}

function buildBreaks(
	match: OrientedMatch,
	frames: NonNullable<SeedResult['frames']>,
	rng: () => number
): NonNullable<SeedResult['breaks']> {
	const breaks: NonNullable<SeedResult['breaks']> = [];
	for (const player of [match.low, match.high]) {
		if (rng() < 0.35) continue;
		const own = frames
			.filter((frame) => (player === match.low ? frame.lowPoints : frame.highPoints) > 0)
			.map((frame) => (player === match.low ? frame.lowPoints : frame.highPoints));
		const best = own.length ? Math.max(...own) : 0;
		if (best < 20) continue;
		// A break can never exceed the player's best recorded frame score.
		breaks.push({ player, breakPoints: 20 + Math.floor(rng() * (best - 19)) });
	}
	return breaks;
}

/* ------------------------------------------------------------------ *
 * Plan assembly
 * ------------------------------------------------------------------ */
export function buildLeagueSeedPlan(): LeagueSeedPlan {
	const rounds: LeagueSeedPlan['rounds'] = [];

	for (const target of ROUND_TARGETS) {
		const { matches } = orientRound(target, PLAYER_KEYS);
		verifyRound(target, matches);
		const dates = shuffled(dateRange(target.window[0], target.window[1]), makeRng(hashSeed(`dates-${target.number}`)));
		const ordered = [...matches].sort((a, b) => (a.low + a.high < b.low + b.high ? -1 : 1));
		const results: SeedResult[] = ordered.map((match, index) => {
			const rng = makeRng(hashSeed(`detail-${target.number}-${match.low}-${match.high}`));
			const withDetail = rng() < 0.4;
			const frames = withDetail ? buildFrameDetail(match, rng) : undefined;
			const breaks = withDetail && frames ? buildBreaks(match, frames, rng) : undefined;
			const winnerFrames = match.whitewash ? 3 : 2;
			const loserFrames = match.whitewash ? 0 : 1;
			return {
				round: target.number,
				low: match.low,
				high: match.high,
				lowFrames: match.low === match.winner ? winnerFrames : loserFrames,
				highFrames: match.high === match.winner ? winnerFrames : loserFrames,
				playedDate: dates[index % dates.length],
				frames,
				breaks
			};
		});
		rounds.push({
			number: target.number,
			status: 'closed',
			isFinal: false,
			openedAt: `${target.window[0]}T00:00:00+01:00`,
			deadlineAt: target.deadlineAt,
			graceDays: 7,
			players: PLAYER_KEYS,
			unplayed: target.unplayed,
			results,
			awards: []
		});
	}

	// Round 6: the current round, exactly as the approved prototype shows it.
	const round6Results: SeedResult[] = ROUND6_RESULTS.map(([playedDate, a, b, aFrames, bFrames]) => {
		const [low, high] = orderKeys(a, b);
		const rng = makeRng(hashSeed(`detail-6-${low}-${high}`));
		const withDetail = rng() < 0.5;
		const whitewash = aFrames === 3;
		const match: OrientedMatch = {
			low,
			high,
			winner: aFrames > bFrames ? a : b,
			whitewash
		};
		const frames = withDetail ? buildFrameDetail(match, rng) : undefined;
		const breaks = withDetail && frames ? buildBreaks(match, frames, rng) : undefined;
		return {
			round: 6,
			low,
			high,
			lowFrames: low === a ? aFrames : bFrames,
			highFrames: high === a ? aFrames : bFrames,
			playedDate,
			frames,
			breaks
		};
	});

	rounds.push({
		number: 6,
		status: 'open',
		isFinal: false,
		openedAt: '2026-09-01T00:00:00+01:00',
		deadlineAt: '2026-10-03T23:59:59+01:00',
		graceDays: 7,
		players: PLAYER_KEYS,
		// Ella Thompson withdrew from the league during Round 6 after playing
		// five of her seven fixtures; her history and earned points stay.
		withdrawn: ['ella'],
		unplayed: ROUND6_UNPLAYED,
		results: round6Results,
		// The approved prototype shows exactly one arranged Round 6 fixture:
		// "Leon Park vs Owen Brooks — Saturday, 3 October · 4:00 pm". The other
		// open fixtures deliberately have no date so the arrange-a-date flow can
		// be tried on real state.
		bookings: [
			{
				low: 'leon',
				high: 'owen',
				date: '2026-10-03',
				time: '16:00',
				proposedBy: 'owen',
				note: 'At the club, snooker table 2'
			}
		],
		awards: [
			{
				round: 6,
				low: 'ella',
				high: 'jules',
				recipient: 'jules',
				tablePoints: 2,
				sourceType: 'previous_round_result',
				sourceResult: { round: 5, low: 'ella', high: 'jules' },
				reason:
					'Ella Thompson withdrew during Round 6. Jules Rivera is awarded the 2 table points he earned against her in Round 5 (2–1). Table points only — no frames, frame difference or match win.'
			},
			{
				round: 6,
				low: 'ella',
				high: 'noah',
				recipient: 'noah',
				tablePoints: 0,
				sourceType: 'previous_round_result',
				sourceResult: { round: 5, low: 'ella', high: 'noah' },
				reason:
					'Ella Thompson withdrew during Round 6. Noah Kim is awarded the 0 table points he earned against her in Round 5 (0–3), so his table is unchanged and carries no asterisk.'
			}
		]
	});

	return {
		season: {
			label: '2026',
			framesPerMatch: 3,
			pointsPerFrame: 1,
			matchWinBonus: 0,
			timezone: 'Europe/London'
		},
		rounds
	};
}
