/**
 * Page data for the Phase 6 result screens: record, review and correct.
 *
 * Read-only. Everything a screen needs to render the journey comes from here so
 * the routes stay thin and the permission facts shown in the UI are exactly the
 * ones the write paths enforce (`results.ts`).
 *
 * Dates: `minDate`/`maxDate` are league-local calendar days for the actual date
 * played — bounded by the round snapshot, never by a planned date. The active
 * booking is exposed separately (on `fixture.plannedDate`) purely so the screen
 * can remind the player that a plan is not proof of play.
 */
import type { Db } from './db';
import { localDateString, sqliteInstant } from './league-time';
import { loadFixtureResultFacts } from './league';
import { loadFixtureDetailData, roundPlayableWindowEnd } from './fixtures-page';
import {
	loadResultAudit,
	loadResultRecord,
	resultPermissions,
	type ResultAuditView,
	type ResultPermissions,
	type ResultRecordView
} from './results';
import type { ResultFormValues } from '../result-entry';
import type { FixtureView } from '../fixture-view';
import type { BookingRecord } from './bookings';
import type { RoundSummary, SeasonSummary } from './standings';
import type { ViewerPlayer } from './viewer';

export interface ResultScreenData {
	season: SeasonSummary;
	viewer: ViewerPlayer | null;
	fixture: FixtureView;
	round: RoundSummary;
	permissions: ResultPermissions;
	/** The stored result, if this fixture has one (submission, or confirmed). */
	record: ResultRecordView | null;
	/** Append-only result history: who changed what, when and why. */
	audit: ResultAuditView[];
	/** Planned-date history (a plan, never a played date). */
	history: BookingRecord[];
	framesPerMatch: number;
	timeZone: string;
	/** League-local today. */
	today: string;
	/** First league-local day the fixture could have been played. */
	minDate: string | null;
	/** Last day a played date can be recorded: today, capped by the round window. */
	maxDate: string | null;
	lastPlayableDate: string | null;
	/** Prefilled entry values when correcting or resubmitting an existing result. */
	draft: ResultFormValues | null;
}

/** Turn a stored result back into entry-form values (correction / resubmission). */
export function draftFromRecord(
	record: ResultRecordView,
	framesPerMatch: number
): ResultFormValues {
	const winners: string[] = [];
	const points: Array<{ low: string; high: string }> = [];
	for (let frame = 1; frame <= framesPerMatch; frame++) {
		const winner = record.frameWinners.find((entry) => entry.frameNumber === frame);
		winners.push(
			winner ? (winner.playerId === record.low.playerId ? 'low' : 'high') : ''
		);
		const detail = record.frames.find((entry) => entry.frameNumber === frame);
		points.push({
			low: detail ? String(detail.lowPoints) : '',
			high: detail ? String(detail.highPoints) : ''
		});
	}
	const lowBreak = record.breaks.find((entry) => entry.playerId === record.low.playerId);
	const highBreak = record.breaks.find((entry) => entry.playerId === record.high.playerId);
	return {
		actualPlayedDate: record.actualPlayedDate,
		frameWinners: winners,
		framePoints: points,
		breaks: {
			low: lowBreak ? String(lowBreak.breakPoints) : '',
			high: highBreak ? String(highBreak.breakPoints) : ''
		}
	};
}

export function loadResultScreenData(
	db: Db,
	options: { fixtureId: number; viewer: ViewerPlayer | null; now?: Date }
): ResultScreenData | null {
	const now = options.now ?? new Date();
	const detail = loadFixtureDetailData(db, {
		fixtureId: options.fixtureId,
		viewer: options.viewer
	});
	if (!detail) return null;
	const round = detail.season.rounds.find((entry) => entry.roundId === detail.fixture.roundId);
	if (!round) return null;

	const facts = loadFixtureResultFacts(db, options.fixtureId);
	const timeZone = detail.season.timezone;
	const today = localDateString(now, timeZone);
	const openedDate = facts ? localDateString(sqliteInstant(facts.openedAt), timeZone) : null;
	const windowEnd = roundPlayableWindowEnd(round, timeZone);
	const record = loadResultRecord(db, options.fixtureId);

	return {
		season: detail.season,
		viewer: options.viewer,
		fixture: detail.fixture,
		round,
		permissions: resultPermissions(db, options.fixtureId, options.viewer?.playerId ?? null),
		record,
		audit: record ? loadResultAudit(db, record.resultId) : [],
		history: detail.history,
		framesPerMatch: detail.season.framesPerMatch,
		timeZone,
		today,
		minDate: openedDate,
		// A played date can never be in the future, and never after the round's
		// deadline + grace window.
		maxDate: windowEnd && windowEnd < today ? windowEnd : today,
		lastPlayableDate: windowEnd,
		draft: record ? draftFromRecord(record, detail.season.framesPerMatch) : null
	};
}
