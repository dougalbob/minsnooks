/**
 * League result entry rules — the pure, shared core (Phase 6).
 *
 * This module is deliberately free of database and server imports so the exact
 * same rules run in the browser (live "is this correct?" feedback while a
 * player fills the form in) and on the server (the authoritative check before
 * anything is written). One implementation, no drift.
 *
 * The rules are HANDOFF §4 "Result submission and corrections":
 *
 *   * a league match is exactly `framesPerMatch` frames (three in 2026) and the
 *     frame winners must agree with the match score — a league match cannot be
 *     drawn;
 *   * non-negative whole numbers only;
 *   * optional frame-by-frame point scores are all-or-nothing;
 *   * a highest break may be entered even when frame detail is omitted, but
 *     when frame detail exists a break may not exceed that player's best
 *     recorded frame score (in any frame, won or lost — a 60 break in a 60–65
 *     frame is legal);
 *   * extreme or surprising input prompts "is this correct?" as a **warning**
 *     and is never a hard rejection: fouls can award points to the opponent, so
 *     a 100–50 frame is plausible and there is no exact mathematical validator
 *     for every possible frame total;
 *   * optional details are locked once a submission exists — a player may
 *     correct the values they submitted, but may not add frame detail or breaks
 *     afterwards (only an admin change, with a reason, may).
 */

export interface FrameDetail {
	frameNumber: number;
	lowPoints: number;
	highPoints: number;
}

export interface BreakDetail {
	playerId: number;
	breakPoints: number;
}

export interface ValidationResult {
	ok: boolean;
	errors: string[];
	warnings: string[];
}

export interface LeagueResultFacts {
	framesPerMatch: number;
	lowFrames: number;
	highFrames: number;
	actualPlayedDate: string;
	frames?: FrameDetail[];
	breaks?: BreakDetail[];
	lowPlayerId: number;
	highPlayerId: number;
}

export interface ValidationOptions {
	/** Frame totals above this prompt "is this correct?" (never a rejection). */
	extremeFramePoints?: number;
	/** Frame totals below this prompt "is this correct?" (never a rejection). */
	unusuallyLowFramePoints?: number;
	/** Breaks at or above this prompt "is this correct?" (a century). */
	centuryBreak?: number;
	/** League-local calendar date for "today"; a later played date is impossible. */
	today?: string | null;
}

/** Non-negative whole numbers only (HANDOFF §4 validation rules). */
function isCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Validate a league result against the season's scoring config.
 *
 * Hard errors: impossible frame counts, frame-winner inconsistency, a drawn
 * frame or match, breaks above the player's best recorded frame score, a
 * missing or future actual played date, non-whole/negative numbers.
 * Soft warnings: extreme but plausible values. Warnings are never rejections —
 * the UI asks "is this correct?" and the player confirms.
 */
export function validateLeagueResult(
	input: LeagueResultFacts,
	options: ValidationOptions = {}
): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const extreme = options.extremeFramePoints ?? 120;
	const tooLow = options.unusuallyLowFramePoints ?? 10;
	const century = options.centuryBreak ?? 100;

	if (!isCount(input.lowFrames) || !isCount(input.highFrames)) {
		errors.push('Frame counts must be non-negative whole numbers.');
		return { ok: false, errors, warnings };
	}
	if (input.lowFrames + input.highFrames !== input.framesPerMatch) {
		errors.push(
			`A league match is exactly ${input.framesPerMatch} frames: ${input.lowFrames} + ${input.highFrames} does not add up.`
		);
	}
	if (input.lowFrames === input.highFrames) {
		errors.push('A league match cannot be drawn; one player must win more frames.');
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.actualPlayedDate)) {
		errors.push('An actual date played (YYYY-MM-DD) is required.');
	} else if (options.today && input.actualPlayedDate > options.today) {
		errors.push('The actual date played cannot be in the future — enter the day the frames were played.');
	}

	const frames = input.frames ?? [];
	if (frames.length > 0) {
		if (frames.length !== input.framesPerMatch) {
			errors.push(`Frame-point detail must cover all ${input.framesPerMatch} frames.`);
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
				errors.push(`Frame ${frame.frameNumber}: a frame cannot be drawn.`);
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
		if (errors.length === 0) {
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
			errors.push('A break was recorded for a player who is not in this match.');
			continue;
		}
		// A break cannot exceed the player's best recorded frame score — in any
		// frame they played, won or lost (a 60 break in a 60–65 frame is legal).
		// Only checked when frame detail exists: without a shot/foul log there is
		// no exact mathematical validator for every possible final frame total.
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
				`A break of ${breakEntry.breakPoints} is a century. Please check — it will appear in the round highlights.`
			);
		}
	}

	return { ok: errors.length === 0, errors, warnings };
}

/**
 * Optional details are locked at first submission (HANDOFF §4: "Players cannot
 * add optional details later after submission"). A player correction may fix the
 * values already submitted; it may not introduce a category that was absent.
 * An admin change (with a mandatory reason) is not restricted.
 */
export function checkDetailsLock(options: {
	original: { hasFramePoints: boolean; hasBreaks: boolean };
	proposed: { hasFramePoints: boolean; hasBreaks: boolean };
	isAdminChange: boolean;
}): string[] {
	if (options.isAdminChange) return [];
	const errors: string[] = [];
	if (options.proposed.hasFramePoints && !options.original.hasFramePoints) {
		errors.push(
			'Optional frame-by-frame scores cannot be added after submission. Ask an admin if they need to be recorded.'
		);
	}
	if (options.proposed.hasBreaks && !options.original.hasBreaks) {
		errors.push(
			'A highest break cannot be added after submission. Ask an admin if it needs to be recorded.'
		);
	}
	return errors;
}

/* ------------------------------------------------------------------ *
 * Form parsing
 * ------------------------------------------------------------------ */

export type FrameWinnerChoice = 'low' | 'high';

/** Raw string values as they arrive from the entry form. */
export interface ResultFormValues {
	actualPlayedDate: string;
	/** One entry per frame: 'low', 'high' or '' (not chosen). */
	frameWinners: string[];
	/** One entry per frame: the two point-score inputs, as typed. */
	framePoints: Array<{ low: string; high: string }>;
	/** The two highest-break inputs, as typed. */
	breaks: { low: string; high: string };
}

export interface ResultFormContext {
	framesPerMatch: number;
	lowPlayerId: number;
	highPlayerId: number;
	lowPlayerName: string;
	highPlayerName: string;
	/** League-local "today"; a played date after it is impossible. */
	today?: string | null;
}

export interface AssessedResultForm {
	ok: boolean;
	errors: string[];
	warnings: string[];
	actualPlayedDate: string;
	lowFrames: number;
	highFrames: number;
	frames: FrameDetail[];
	breaks: BreakDetail[];
	hasFramePoints: boolean;
	hasBreaks: boolean;
	/** Frame winners in frame order, for the review summary. */
	frameWinners: Array<FrameWinnerChoice | null>;
}

/** Parse one numeric input: blank → null, anything not a whole number → error. */
function parseCountInput(raw: string, label: string, errors: string[]): number | null {
	const value = (raw ?? '').trim();
	if (value === '') return null;
	if (!/^\d+$/.test(value)) {
		errors.push(`${label} must be a whole number of points (no negatives, no decimals).`);
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
 * Turn the entry form's raw strings into validated result facts.
 *
 * Frame winners decide the match score; the optional point scores must cover
 * every frame or be left blank entirely, and must agree with the chosen frame
 * winners. Warnings are returned alongside errors so the UI can ask
 * "is this correct?" without blocking a plausible scoreline.
 */
export function assessResultForm(
	values: ResultFormValues,
	context: ResultFormContext,
	options: ValidationOptions = {}
): AssessedResultForm {
	const errors: string[] = [];
	const warnings: string[] = [];
	const framesPerMatch = context.framesPerMatch;
	const actualPlayedDate = (values.actualPlayedDate ?? '').trim();

	const frameWinners: Array<FrameWinnerChoice | null> = [];
	let lowFrames = 0;
	let highFrames = 0;
	for (let index = 0; index < framesPerMatch; index++) {
		const choice = (values.frameWinners[index] ?? '').trim();
		if (choice === 'low') {
			frameWinners.push('low');
			lowFrames++;
		} else if (choice === 'high') {
			frameWinners.push('high');
			highFrames++;
		} else {
			frameWinners.push(null);
			errors.push(`Choose the winner of frame ${index + 1}.`);
		}
	}

	const rawPoints = values.framePoints ?? [];
	const filled = rawPoints.filter(
		(entry) => (entry?.low ?? '').trim() !== '' || (entry?.high ?? '').trim() !== ''
	);
	const hasFramePoints = filled.length > 0;
	const frames: FrameDetail[] = [];
	if (hasFramePoints) {
		if (filled.length !== framesPerMatch || rawPoints.length !== framesPerMatch) {
			errors.push(
				`Enter the point scores for all ${framesPerMatch} frames, or leave them all blank — they cannot be added after submission.`
			);
		}
		for (let index = 0; index < framesPerMatch; index++) {
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
			const winner = frameWinners[index];
			const pointsWinner = lowPoints === highPoints ? null : lowPoints > highPoints ? 'low' : 'high';
			if (pointsWinner === null) {
				errors.push(`Frame ${frameNumber}: a frame cannot be drawn on points.`);
			} else if (winner && pointsWinner !== winner) {
				errors.push(
					`Frame ${frameNumber}: the point scores say ${pointsWinner === 'low' ? context.lowPlayerName : context.highPlayerName} won, but the frame winner selected was ${winner === 'low' ? context.lowPlayerName : context.highPlayerName}.`
				);
			}
		}
	}

	const breaks: BreakDetail[] = [];
	const lowBreak = parseCountInput(values.breaks?.low ?? '', `${context.lowPlayerName}’s highest break`, errors);
	const highBreak = parseCountInput(values.breaks?.high ?? '', `${context.highPlayerName}’s highest break`, errors);
	if (lowBreak !== null) breaks.push({ playerId: context.lowPlayerId, breakPoints: lowBreak });
	if (highBreak !== null) breaks.push({ playerId: context.highPlayerId, breakPoints: highBreak });
	const hasBreaks = breaks.length > 0;

	const validation = validateLeagueResult(
		{
			framesPerMatch,
			lowFrames,
			highFrames,
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
		warnings: [...validation.warnings, ...warnings],
		actualPlayedDate,
		lowFrames,
		highFrames,
		frames,
		breaks,
		hasFramePoints,
		hasBreaks,
		frameWinners
	};
}

/** Read the entry form out of a `FormData` (server actions) or a plain object. */
export function resultFormValuesFrom(
	source: FormData | Record<string, unknown>,
	framesPerMatch: number
): ResultFormValues {
	const read = (name: string): string => {
		if (source instanceof FormData) return String(source.get(name) ?? '').trim();
		const value = (source as Record<string, unknown>)[name];
		return value === null || value === undefined ? '' : String(value).trim();
	};
	const frameWinners: string[] = [];
	const framePoints: Array<{ low: string; high: string }> = [];
	for (let index = 1; index <= framesPerMatch; index++) {
		frameWinners.push(read(`winner${index}`));
		framePoints.push({ low: read(`frame${index}Low`), high: read(`frame${index}High`) });
	}
	return {
		actualPlayedDate: read('actualDate'),
		frameWinners,
		framePoints,
		breaks: { low: read('breakLow'), high: read('breakHigh') }
	};
}
