/**
 * Friendly result entry rules — the pure, shared core (Phase 10).
 *
 * Like its league sibling (`$lib/result-entry`), this module is free of
 * database and server imports so the exact same rules run in the browser (live
 * feedback while a player fills the form in) and on the server (the
 * authoritative check before anything is written). One implementation, no drift.
 *
 * The rules are HANDOFF §5 "Friendlies" with Q3 decided 2026-09-29:
 *
 *   * a friendly is between two registered league players, with a flexible
 *     frame count and drawn matches allowed — but a 0–0 means no result and is
 *     never saved;
 *   * every saved result carries the actual date played (never inferred from
 *     a scheduled date, never in the future);
 *   * optional per-frame point scores are all-or-nothing across the played
 *     frames and must agree with the match totals; a highest break may be
 *     entered even when frame detail is omitted, but when frame detail exists
 *     a break may not exceed that player's best recorded frame score;
 *   * extreme or surprising input prompts "is this correct?" as a **warning**
 *     and is never a hard rejection: a 34–3 frames tally or a 100–50 frame is
 *     implausible but possible, and there is no exact mathematical validator
 *     for every possible final frame total.
 *
 * Friendly data never enters league standings, statistics, highlights or
 * knockout — that separation lives in the schema (own tables) and is asserted
 * in `tests/friendlies.test.ts`.
 */

export interface FriendlyFrameDetail {
	frameNumber: number;
	lowPoints: number;
	highPoints: number;
}

export interface FriendlyBreakDetail {
	playerId: number;
	breakPoints: number;
}

export interface FriendlyValidationResult {
	ok: boolean;
	errors: string[];
	warnings: string[];
}

export interface FriendlyResultFacts {
	lowFrames: number;
	highFrames: number;
	actualPlayedDate: string;
	frames?: FriendlyFrameDetail[];
	breaks?: FriendlyBreakDetail[];
	lowPlayerId: number;
	highPlayerId: number;
}

export interface FriendlyValidationOptions {
	/** Frame totals above this prompt "is this correct?" (never a rejection). */
	extremeFramePoints?: number;
	/** Frame totals below this prompt "is this correct?" (never a rejection). */
	unusuallyLowFramePoints?: number;
	/** Breaks at or above this prompt "is this correct?" (a century). */
	centuryBreak?: number;
	/** Match frame totals above this prompt "is this correct?" (never a rejection). */
	unusualMatchFrames?: number;
	/** Winning margins above this prompt "is this correct?" (never a rejection). */
	unusualFrameMargin?: number;
	/** League-local calendar date for "today"; a later played date is impossible. */
	today?: string | null;
}

/** Non-negative whole numbers only. */
function isCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Validate a friendly result.
 *
 * Hard errors: impossible frame counts, a 0–0 (no result), frame-point detail
 * that does not cover every played frame or disagrees with the match totals, a
 * drawn frame, breaks above the player's best recorded frame score, a missing
 * or future actual played date, non-whole/negative numbers.
 * Soft warnings: extreme but plausible values. Warnings are never rejections —
 * the UI asks "is this correct?" and the player confirms.
 */
export function validateFriendlyResult(
	input: FriendlyResultFacts,
	options: FriendlyValidationOptions = {}
): FriendlyValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const extreme = options.extremeFramePoints ?? 120;
	const tooLow = options.unusuallyLowFramePoints ?? 10;
	const century = options.centuryBreak ?? 100;
	const unusualTotal = options.unusualMatchFrames ?? 15;
	const unusualMargin = options.unusualFrameMargin ?? 10;

	if (!isCount(input.lowFrames) || !isCount(input.highFrames)) {
		errors.push('Frame counts must be non-negative whole numbers.');
		return { ok: false, errors, warnings };
	}
	const totalFrames = input.lowFrames + input.highFrames;
	if (totalFrames < 1) {
		errors.push('A 0–0 is not a result — play at least one frame before saving a friendly.');
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.actualPlayedDate)) {
		errors.push('An actual date played (YYYY-MM-DD) is required.');
	} else if (options.today && input.actualPlayedDate > options.today) {
		errors.push('The actual date played cannot be in the future — enter the day the frames were played.');
	}

	const frames = input.frames ?? [];
	if (frames.length > 0) {
		if (totalFrames >= 1 && frames.length !== totalFrames) {
			errors.push(
				`Frame-point detail must cover all ${totalFrames} played frames, or be left blank entirely.`
			);
		}
		const seen = new Set<number>();
		let lowFrameWins = 0;
		let highFrameWins = 0;
		for (const frame of frames) {
			if (!isCount(frame.lowPoints) || !isCount(frame.highPoints)) {
				errors.push(`Frame ${frame.frameNumber}: points must be non-negative whole numbers.`);
				continue;
			}
			if (seen.has(frame.frameNumber)) {
				errors.push(`Frame ${frame.frameNumber} is listed twice.`);
			}
			seen.add(frame.frameNumber);
			if (frame.lowPoints === frame.highPoints) {
				errors.push(`Frame ${frame.frameNumber}: a frame cannot be drawn on points.`);
			} else if (frame.lowPoints > frame.highPoints) {
				lowFrameWins++;
			} else {
				highFrameWins++;
			}
			const total = frame.lowPoints + frame.highPoints;
			if (frame.lowPoints > extreme || frame.highPoints > extreme) {
				warnings.push(
					`Frame ${frame.frameNumber} is unusually high (${frame.lowPoints}–${frame.highPoints}). Please check — fouls can inflate a frame, so this is allowed.`
				);
			} else if (total > 0 && total < tooLow) {
				warnings.push(
					`Frame ${frame.frameNumber} has an unusually low total (${frame.lowPoints}–${frame.highPoints}). Please check the scores.`
				);
			}
		}
		if (errors.length === 0 && frames.length === totalFrames) {
			if (lowFrameWins !== input.lowFrames || highFrameWins !== input.highFrames) {
				errors.push(
					`Frame winners (${lowFrameWins}–${highFrameWins}) do not match the match score (${input.lowFrames}–${input.highFrames}).`
				);
			}
		}
	}

	for (const breakEntry of input.breaks ?? []) {
		if (!isCount(breakEntry.breakPoints)) {
			errors.push('Breaks must be non-negative whole numbers.');
			continue;
		}
		if (breakEntry.playerId !== input.lowPlayerId && breakEntry.playerId !== input.highPlayerId) {
			errors.push('A break was recorded for a player who is not in this friendly.');
			continue;
		}
		// A break cannot exceed the player's best recorded frame score — in any
		// frame they played, won or lost. Only checked when frame detail exists:
		// without a shot/foul log there is no exact mathematical validator.
		const bestFrame = frames.reduce((best, frame) => {
			const own = breakEntry.playerId === input.lowPlayerId ? frame.lowPoints : frame.highPoints;
			return Math.max(best, own);
		}, 0);
		if (frames.length > 0 && breakEntry.breakPoints > bestFrame) {
			errors.push(
				`A break of ${breakEntry.breakPoints} is higher than the best recorded frame score (${bestFrame}).`
			);
		}
		// Surprising breaks prompt a check rather than a rejection: 147 is the
		// maximum clearance, but a free ball can push a break past it.
		if (breakEntry.breakPoints > 147) {
			warnings.push(
				`A break of ${breakEntry.breakPoints} is above a maximum 147. That is only possible with a free ball — please check.`
			);
		} else if (breakEntry.breakPoints >= century) {
			warnings.push(
				`A break of ${breakEntry.breakPoints} is a century. Please check — friendlies stay out of the league highlights, but the number is still worth a second look.`
			);
		}
	}

	// A very unusual match tally (HANDOFF §5: "e.g. 34–3 frames") prompts for
	// confirmation but is never rejected outright.
	if (totalFrames > unusualTotal) {
		warnings.push(
			`${totalFrames} frames (${input.lowFrames}–${input.highFrames}) is a lot for one friendly. Please check the totals — this is allowed once confirmed.`
		);
	} else if (Math.abs(input.lowFrames - input.highFrames) > unusualMargin) {
		warnings.push(
			`A ${Math.abs(input.lowFrames - input.highFrames)}-frame winning margin (${input.lowFrames}–${input.highFrames}) is unusual. Please check the totals — this is allowed once confirmed.`
		);
	}

	return { ok: errors.length === 0, errors, warnings };
}

/* ------------------------------------------------------------------ *
 * Form parsing
 * ------------------------------------------------------------------ */

/** Raw string values as they arrive from the friendly entry form. */
export interface FriendlyFormValues {
	actualPlayedDate: string;
	/** The two frame-total inputs, as typed. */
	lowFrames: string;
	highFrames: string;
	/** One entry per played frame: the two point-score inputs, as typed. */
	framePoints: Array<{ low: string; high: string }>;
	/** The two highest-break inputs, as typed. */
	breaks: { low: string; high: string };
}

export interface FriendlyFormContext {
	lowPlayerId: number;
	highPlayerId: number;
	lowPlayerName: string;
	highPlayerName: string;
	/** League-local "today"; a played date after it is impossible. */
	today?: string | null;
}

export interface AssessedFriendlyForm {
	ok: boolean;
	errors: string[];
	warnings: string[];
	actualPlayedDate: string;
	lowFrames: number;
	highFrames: number;
	frames: FriendlyFrameDetail[];
	breaks: FriendlyBreakDetail[];
	hasFramePoints: boolean;
	hasBreaks: boolean;
}

/** Parse one numeric input: blank → null, anything not a whole number → error. */
function parseCountInput(raw: string, label: string, errors: string[]): number | null {
	const value = (raw ?? '').trim();
	if (value === '') return null;
	if (!/^\d+$/.test(value)) {
		errors.push(`${label} must be a whole number (no negatives, no decimals).`);
		return null;
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		errors.push(`${label} is too large.`);
		return null;
	}
	return parsed;
}

/**
 * Turn the friendly entry form's raw strings into validated result facts.
 *
 * The two frame totals decide the match score; the optional point scores must
 * cover every played frame or be left blank entirely, and must agree with the
 * totals. Warnings are returned alongside errors so the UI can ask
 * "is this correct?" without blocking a plausible scoreline.
 */
export function assessFriendlyForm(
	values: FriendlyFormValues,
	context: FriendlyFormContext,
	options: FriendlyValidationOptions = {}
): AssessedFriendlyForm {
	const errors: string[] = [];

	const lowFrames = parseCountInput(values.lowFrames ?? '', `${context.lowPlayerName}’s frames`, errors);
	const highFrames = parseCountInput(
		values.highFrames ?? '',
		`${context.highPlayerName}’s frames`,
		errors
	);
	const actualPlayedDate = (values.actualPlayedDate ?? '').trim();
	const totalFrames = (lowFrames ?? 0) + (highFrames ?? 0);

	const rawPoints = values.framePoints ?? [];
	const filled = rawPoints.filter(
		(entry) => (entry?.low ?? '').trim() !== '' || (entry?.high ?? '').trim() !== ''
	);
	const hasFramePoints = filled.length > 0;
	const frames: FriendlyFrameDetail[] = [];
	if (hasFramePoints) {
		if (lowFrames === null || highFrames === null) {
			errors.push('Enter both players’ frame totals before adding point scores.');
		} else if (filled.length !== totalFrames || rawPoints.length < totalFrames) {
			errors.push(
				`Enter the point scores for all ${totalFrames} played frames, or leave them all blank — a partial frame record cannot be checked against the match score.`
			);
		}
		for (let index = 0; index < rawPoints.length; index++) {
			const entry = rawPoints[index] ?? { low: '', high: '' };
			const frameNumber = index + 1;
			const lowPoints = parseCountInput(entry.low ?? '', `Frame ${frameNumber} · ${context.lowPlayerName}`, errors);
			const highPoints = parseCountInput(
				entry.high ?? '',
				`Frame ${frameNumber} · ${context.highPlayerName}`,
				errors
			);
			if (lowPoints === null || highPoints === null) continue;
			frames.push({ frameNumber, lowPoints, highPoints });
			if (lowPoints === highPoints) {
				errors.push(`Frame ${frameNumber}: a frame cannot be drawn on points.`);
			}
		}
	}

	const breaks: FriendlyBreakDetail[] = [];
	const lowBreak = parseCountInput(values.breaks?.low ?? '', `${context.lowPlayerName}’s highest break`, errors);
	const highBreak = parseCountInput(values.breaks?.high ?? '', `${context.highPlayerName}’s highest break`, errors);
	if (lowBreak !== null) breaks.push({ playerId: context.lowPlayerId, breakPoints: lowBreak });
	if (highBreak !== null) breaks.push({ playerId: context.highPlayerId, breakPoints: highBreak });
	const hasBreaks = breaks.length > 0;

	const validation = validateFriendlyResult(
		{
			lowFrames: lowFrames ?? 0,
			highFrames: highFrames ?? 0,
			actualPlayedDate,
			frames,
			breaks,
			lowPlayerId: context.lowPlayerId,
			highPlayerId: context.highPlayerId
		},
		{ ...options, today: options.today ?? context.today ?? null }
	);

	return {
		ok: errors.length === 0 && validation.ok,
		errors: [...errors, ...validation.errors],
		warnings: validation.warnings,
		actualPlayedDate,
		lowFrames: lowFrames ?? 0,
		highFrames: highFrames ?? 0,
		frames,
		breaks,
		hasFramePoints,
		hasBreaks
	};
}

/**
 * Read the friendly entry form out of a `FormData` (server actions) or a plain
 * object. The totals are read first; at most `maxFrameRows` point-score rows
 * follow, so a mistyped total cannot make the server read an unbounded form.
 */
export function friendlyFormValuesFrom(
	source: FormData | Record<string, unknown>,
	maxFrameRows = 200
): FriendlyFormValues {
	const read = (name: string): string => {
		if (source instanceof FormData) return String(source.get(name) ?? '').trim();
		const value = (source as Record<string, unknown>)[name];
		return value === null || value === undefined ? '' : String(value).trim();
	};
	const lowFrames = read('lowFrames');
	const highFrames = read('highFrames');
	const total = /^\d+$/.test(lowFrames) && /^\d+$/.test(highFrames) ? Number(lowFrames) + Number(highFrames) : 0;
	const framePoints: Array<{ low: string; high: string }> = [];
	const rows = Math.min(total, maxFrameRows);
	for (let index = 1; index <= rows; index++) {
		framePoints.push({ low: read(`frame${index}Low`), high: read(`frame${index}High`) });
	}
	return {
		actualPlayedDate: read('actualDate'),
		lowFrames,
		highFrames,
		framePoints,
		breaks: { low: read('breakLow'), high: read('breakHigh') }
	};
}
