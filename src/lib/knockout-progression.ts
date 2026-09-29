/**
 * Knockout progression rules — the pure, shared core (Phase 12).
 *
 * Like its league and friendly siblings, this module has no database or server
 * imports, so the exact same rules run in the browser (live feedback in the
 * record-result form) and on the server (the authoritative check). One
 * implementation, no drift.
 *
 * The rules are HANDOFF §6:
 *
 *   * each competition fixes its match length at announcement — first to 2, 3
 *     or 4 frames (best of 3, 5 or 7) — and the same format runs through the
 *     final;
 *   * **play stops once a player reaches the target**: the record form refuses
 *     any frame after the decider, so a result can never over-run its format;
 *   * the match winner is the player who reached the target; the loser's
 *     frame count is whatever it finished on (frames cannot be drawn);
 *   * **later stages are drawn fresh** from the players who advanced — the
 *     bracket is never pre-seeded. The opening stage keeps the Phase 11 rule
 *     (six entrants → two byes, seven → one, eight → none, always four
 *     through); every later stage pairs the field and gives a bye only when
 *     the count is odd, so three players mean one semi-final and one bye
 *     straight into the final;
 *   * a paired dropout advances the opponent **without a played result** (a
 *     walkover — no frames, no played date); a bye-holder dropout is removed
 *     and the next stage is drawn afresh from the remaining players. No
 *     result is ever invented to unblock progression.
 */

export type KnockoutStageKind = 'opening' | 'later';

export interface KnockoutStagePairing {
	matchups: Array<[number, number]>;
	byePlayerIds: number[];
}

/**
 * Turn an already-randomized player order into the pairings and byes for one
 * stage. The caller shuffles (server-side crypto in production, a seeded
 * source in tests); this function owns only the bracket arithmetic.
 *
 * Opening stage (Phase 11): six entrants produce two ties and two byes,
 * seven produce three ties and one bye, eight produce four ties and no bye —
 * exactly four players advance every time.
 *
 * Later stages: pair the field; an odd count sends the first player in the
 * order straight through (one bye).
 */
export function planStageFromOrder(
	orderedPlayerIds: readonly number[],
	kind: KnockoutStageKind
): KnockoutStagePairing {
	const count = orderedPlayerIds.length;
	if (kind === 'opening' && (count < 6 || count > 8)) {
		throw new Error('An opening draw needs six, seven, or eight players.');
	}
	const byeCount = kind === 'opening' ? 8 - count : count % 2;
	if (byeCount < 0 || byeCount >= count) {
		throw new Error('A stage draw needs at least two players.');
	}
	const byePlayerIds = orderedPlayerIds.slice(0, byeCount);
	const playersToPair = orderedPlayerIds.slice(byeCount);
	const matchups: Array<[number, number]> = [];
	for (let index = 0; index < playersToPair.length; index += 2) {
		const first = playersToPair[index];
		const second = playersToPair[index + 1];
		matchups.push(first < second ? [first, second] : [second, first]);
	}
	return { matchups, byePlayerIds };
}

/** A human label for a stage from the number of players entering it. */
export function knockoutStageLabel(playersEntering: number): string {
	if (playersEntering >= 6) return 'Opening round';
	if (playersEntering === 4) return 'Semi-finals';
	if (playersEntering === 3) return 'Play-in round';
	if (playersEntering === 2) return 'Final';
	return 'Knockout stage';
}

/** Long-form format line: "First to 3 frames · best of 5". */
export function formatTargetLabel(framesToWin: number): string {
	return `First to ${framesToWin} frames · best of ${framesToWin * 2 - 1}`;
}

/** A first-to-N match can never run past 2N-1 frames. */
export function maxFramesForTarget(framesToWin: number): number {
	return framesToWin * 2 - 1;
}

/* ------------------------------------------------------------------ *
 * Result validation — first to N, stopping at the target
 * ------------------------------------------------------------------ */

export interface KnockoutFrameCall {
	frameNumber: number;
	winnerPlayerId: number;
}

export interface KnockoutFramesFacts {
	playerLowId: number;
	playerHighId: number;
	framesToWin: number;
	/** The frames actually played, in order, frame 1 first. */
	frames: KnockoutFrameCall[];
}

export interface KnockoutFramesVerdict {
	ok: boolean;
	errors: string[];
	/** The player who reached the target, when the frames are valid. */
	winnerPlayerId: number | null;
	lowFrames: number;
	highFrames: number;
}

/**
 * Validate the frame sequence of a first-to-N knockout match.
 *
 * Hard errors: frames not numbered consecutively from 1, a frame won by
 * someone not in the tie, or **any frame played after a player has reached
 * the target** ("the match stops at the target" is the format rule, so a
 * 3-win sweep submitted as four frames is rejected rather than trimmed).
 * The winner must have exactly N frames when the sequence stops.
 */
export function validateKnockoutFrames(input: KnockoutFramesFacts): KnockoutFramesVerdict {
	const errors: string[] = [];
	const { playerLowId, playerHighId, framesToWin, frames } = input;
	let lowFrames = 0;
	let highFrames = 0;
	// Local working variables so control flow stays a straight line (no closure
	// narrowing surprises); copied to the verdict at the end.
	let winner: number | null = null;
	let decidedAtFrame = 0;
	let winnerPlayerId: number | null = null;

	if (![2, 3, 4].includes(framesToWin)) {
		errors.push('A knockout match is first to 2, 3, or 4 frames.');
		return { ok: false, errors, winnerPlayerId: null, lowFrames, highFrames };
	}
	if (frames.length === 0) {
		errors.push('Enter the frames in the order they were played.');
		return { ok: false, errors, winnerPlayerId: null, lowFrames, highFrames };
	}

	frames.forEach((frame, index) => {
		if (frame.frameNumber !== index + 1) {
			errors.push(`Frames must be numbered consecutively from 1 (frame ${frame.frameNumber} is out of order).`);
			return;
		}
		if (frame.winnerPlayerId !== playerLowId && frame.winnerPlayerId !== playerHighId) {
			errors.push(`Frame ${frame.frameNumber} was won by a player who is not in this tie.`);
			return;
		}
		if (frame.winnerPlayerId === playerLowId) lowFrames++;
		else highFrames++;
		// Record the decision only at the transition, so a stray frame after
		// the decider can never rename the winner.
		if (winner === null && (lowFrames === framesToWin || highFrames === framesToWin)) {
			decidedAtFrame = index + 1;
			winner = frame.winnerPlayerId;
		}
	});

	if (frames.length > decidedAtFrame) {
		const extra = frames[decidedAtFrame];
		errors.push(
			`Play stops once a player reaches ${framesToWin} frames — frame ${extra.frameNumber} is after the match was decided.`
		);
	}

	if (winner === null) {
		errors.push(`The match must stop when a player reaches ${framesToWin} frames.`);
	}
	winnerPlayerId = winner;

	return { ok: errors.length === 0, errors, winnerPlayerId, lowFrames, highFrames };
}

/* ------------------------------------------------------------------ *
 * Form parsing
 * ------------------------------------------------------------------ */

/** Raw values as they arrive from the knockout record form. */
export interface KnockoutResultFormValues {
	actualPlayedDate: string;
	/** One entry per frame row: 'low', 'high', or '' (not played). */
	frameWinners: string[];
}

export interface KnockoutResultFormContext {
	playerLowId: number;
	playerHighId: number;
	lowPlayerName: string;
	highPlayerName: string;
	framesToWin: number;
	/** League-local "today"; a played date after it is impossible. */
	today?: string | null;
}

export interface AssessedKnockoutForm {
	ok: boolean;
	errors: string[];
	frames: KnockoutFrameCall[];
	winnerPlayerId: number | null;
	lowFrames: number;
	highFrames: number;
	actualPlayedDate: string;
}

function normaliseRowValue(raw: string): 'low' | 'high' | null {
	const value = (raw ?? '').trim();
	if (value === '') return null;
	if (value === 'low' || value === 'high') return value;
	return null;
}

/**
 * Turn the record form's raw strings into validated result facts.
 *
 * Rows must be filled from frame 1 with no gaps; blank rows after the decider
 * are simply not played frames. The same first-to-N rules as
 * `validateKnockoutFrames` apply, so the browser feedback and the server
 * decision cannot drift apart.
 */
export function assessKnockoutResultForm(
	values: KnockoutResultFormValues,
	context: KnockoutResultFormContext
): AssessedKnockoutForm {
	const errors: string[] = [];
	const rows = values.frameWinners ?? [];
	const frames: KnockoutFrameCall[] = [];
	let stopped = false;

	for (let index = 0; index < rows.length; index++) {
		const raw = normaliseRowValue(rows[index] ?? '');
		const frameNumber = index + 1;
		if (raw === null) {
			stopped = true;
			continue;
		}
		if (stopped) {
			errors.push(`Frame ${frameNumber} is filled in after an earlier frame was left blank — enter the frames in order.`);
			continue;
		}
		frames.push({
			frameNumber,
			winnerPlayerId: raw === 'low' ? context.playerLowId : context.playerHighId
		});
	}

	const actualPlayedDate = (values.actualPlayedDate ?? '').trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(actualPlayedDate)) {
		errors.push('An actual date played (YYYY-MM-DD) is required.');
	} else if (context.today && actualPlayedDate > context.today) {
		errors.push('The actual date played cannot be in the future — enter the day the frames were played.');
	}

	const verdict = validateKnockoutFrames({
		playerLowId: context.playerLowId,
		playerHighId: context.playerHighId,
		framesToWin: context.framesToWin,
		frames
	});

	return {
		ok: errors.length === 0 && verdict.ok,
		errors: [...errors, ...verdict.errors],
		frames,
		winnerPlayerId: verdict.winnerPlayerId,
		lowFrames: verdict.lowFrames,
		highFrames: verdict.highFrames,
		actualPlayedDate
	};
}

/** Read the record form out of a `FormData` (server actions) or a plain object. */
export function knockoutFormValuesFrom(
	source: FormData | Record<string, unknown>,
	maxFrameRows: number
): KnockoutResultFormValues {
	const read = (name: string): string => {
		if (source instanceof FormData) return String(source.get(name) ?? '').trim();
		const value = (source as Record<string, unknown>)[name];
		return value === null || value === undefined ? '' : String(value).trim();
	};
	const frameWinners: string[] = [];
	for (let index = 1; index <= maxFrameRows; index++) {
		frameWinners.push(read(`frame${index}`));
	}
	return { actualPlayedDate: read('actualDate'), frameWinners };
}
