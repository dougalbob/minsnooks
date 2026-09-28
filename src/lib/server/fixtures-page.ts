/**
 * Fixtures & results page data (Phase 5).
 *
 * Read-only: this module never writes league state and never advances the
 * lifecycle. Every planned date it exposes comes from the `bookings` table and
 * is labelled as a plan; every actual date it exposes comes from a confirmed
 * result. The two are never interchanged.
 */
import type { Db } from './db';
import {
	loadActiveBooking,
	loadBookingHistory,
	canManageBooking,
	loadFixtureContext,
	type BookingRecord
} from './bookings';
import { gracePeriodEndsAt, localDateString } from './league-time';
import { loadSeason, type RoundProgress, type RoundSummary, type SeasonSummary } from './standings';
import type {
	BreakView,
	FixtureState,
	FixtureView,
	FrameDetailView,
	PlayerView,
	ResultView
} from '$lib/fixture-view';
import type { ViewerPlayer } from './viewer';

export type {
	PlayerView,
	FixtureState,
	PlannedDateView,
	ResultView,
	AwardView,
	FixtureView,
	FrameDetailView,
	BreakView
} from '$lib/fixture-view';

interface FixtureRow {
	fixture_id: number;
	round_id: number;
	state: FixtureState;
	player_low_id: number;
	player_high_id: number;
	low_name: string;
	low_initials: string;
	low_tone: string;
	high_name: string;
	high_initials: string;
	high_tone: string;
	result_id: number | null;
	player_low_frames: number | null;
	player_high_frames: number | null;
	actual_played_date: string | null;
	result_status: 'submitted' | 'confirmed' | 'sent_back' | null;
	entry_source: 'player' | 'admin_direct' | 'admin_retrospective' | null;
	submitted_by_name: string | null;
	confirmed_by_name: string | null;
	confirmed_at: string | null;
	frame_detail_count: number;
	award_player_id: number | null;
	award_player_name: string | null;
	award_points: number | null;
	award_source: 'previous_round_result' | 'random_draw' | 'manual' | null;
	award_reason: string | null;
}

const FIXTURE_SQL = `
	SELECT f.id AS fixture_id, f.round_id, f.state,
		f.player_low_id, f.player_high_id,
		low.display_name AS low_name, low.initials AS low_initials, low.avatar_tone AS low_tone,
		high.display_name AS high_name, high.initials AS high_initials, high.avatar_tone AS high_tone,
		r.id AS result_id, r.player_low_frames, r.player_high_frames, r.actual_played_date,
		r.status AS result_status, r.entry_source, r.confirmed_at,
		submitter.display_name AS submitted_by_name,
		confirmer.display_name AS confirmed_by_name,
		(SELECT COUNT(*) FROM result_frames rf WHERE rf.result_id = r.id) AS frame_detail_count,
		a.player_id AS award_player_id, ap.display_name AS award_player_name,
		a.table_points AS award_points, a.source_type AS award_source, a.reason AS award_reason
	FROM fixtures f
	JOIN players low ON low.id = f.player_low_id
	JOIN players high ON high.id = f.player_high_id
	LEFT JOIN results r ON r.fixture_id = f.id
	LEFT JOIN players submitter ON submitter.id = r.submitted_by_player_id
	LEFT JOIN players confirmer ON confirmer.id = r.confirmed_by_player_id
	LEFT JOIN awards a ON a.fixture_id = f.id
	LEFT JOIN players ap ON ap.id = a.player_id
	WHERE f.round_id = ?
`;

const ACTIVE_BOOKING_SQL = `
	SELECT b.id, b.fixture_id, b.proposed_date, b.proposed_time, b.note,
		b.proposed_by_player_id, p.display_name AS proposed_by_name
	FROM bookings b
	JOIN players p ON p.id = b.proposed_by_player_id
	WHERE b.status = 'proposed'
		AND b.fixture_id IN (SELECT id FROM fixtures WHERE round_id = ?)
`;

function toPlayerView(row: {
	player_id: number;
	name: string;
	initials: string;
	tone: string;
}): PlayerView {
	return {
		playerId: row.player_id,
		name: row.name,
		initials: row.initials,
		tone: row.tone
	};
}

/** How urgent a fixture is: yours first, then still to play, then resolved. */
const STATE_ORDER: Record<FixtureState, number> = {
	awaiting_confirmation: 0,
	unplayed: 1,
	confirmed: 2,
	awarded: 3,
	closed_unplayed: 4
};

export interface FixtureLoadOptions {
	viewer: ViewerPlayer | null;
	/** League timezone from the season (calendar-day deadline/grace window). */
	timeZone: string;
}

/**
 * The final league-local calendar day on which this round's fixtures may still
 * be played: the deadline plus the round's snapshot grace days (HANDOFF §4).
 */
export function roundPlayableWindowEnd(round: RoundSummary, timeZone: string): string | null {
	if (!round.deadlineAt) return null;
	return localDateString(gracePeriodEndsAt(round.deadlineAt, round.graceDays, timeZone), timeZone);
}

/**
 * Every fixture in a round, with its planned date, result or award, ordered so
 * the viewer's own fixtures and still-to-play fixtures come first.
 */
export function loadFixtureViews(db: Db, round: RoundSummary, options: FixtureLoadOptions): FixtureView[] {
	const viewerPlayerId = options.viewer?.playerId ?? null;
	const rows = db.prepare(FIXTURE_SQL).all(round.roundId) as unknown as FixtureRow[];
	const bookingRows = db.prepare(ACTIVE_BOOKING_SQL).all(round.roundId) as unknown as Array<{
		id: number;
		fixture_id: number;
		proposed_date: string;
		proposed_time: string | null;
		note: string | null;
		proposed_by_player_id: number;
		proposed_by_name: string;
	}>;
	const bookingsByFixture = new Map(bookingRows.map((row) => [row.fixture_id, row]));

	const roundWindowEnd = roundPlayableWindowEnd(round, options.timeZone);

	const views = rows.map((row): FixtureView => {
		const booking = bookingsByFixture.get(row.fixture_id);
		const permission = canManageBooking(db, row.fixture_id, viewerPlayerId);
		const low = toPlayerView({
			player_id: row.player_low_id,
			name: row.low_name,
			initials: row.low_initials,
			tone: row.low_tone
		});
		const high = toPlayerView({
			player_id: row.player_high_id,
			name: row.high_name,
			initials: row.high_initials,
			tone: row.high_tone
		});
		const lowFrames = row.player_low_frames ?? 0;
		const highFrames = row.player_high_frames ?? 0;
		const lowWon = lowFrames >= highFrames;
		return {
			fixtureId: row.fixture_id,
			roundId: row.round_id,
			roundNumber: round.number,
			roundStatus: round.status,
			state: row.state,
			low,
			high,
			isMine: viewerPlayerId !== null && (row.player_low_id === viewerPlayerId || row.player_high_id === viewerPlayerId),
			plannedDate: booking
				? {
						bookingId: booking.id,
						date: booking.proposed_date,
						time: booking.proposed_time,
						note: booking.note,
						proposedByPlayerId: booking.proposed_by_player_id,
						proposedByName: booking.proposed_by_name,
						afterWindow: Boolean(roundWindowEnd && booking.proposed_date > roundWindowEnd)
					}
				: null,
			result:
				row.result_id === null || row.actual_played_date === null
					? null
					: {
							resultId: row.result_id,
							lowFrames,
							highFrames,
							actualPlayedDate: row.actual_played_date,
							status: row.result_status ?? 'submitted',
							entrySource: row.entry_source ?? 'player',
							submittedByName: row.submitted_by_name,
							confirmedByName: row.confirmed_by_name,
							confirmedAt: row.confirmed_at,
							frameDetailCount: row.frame_detail_count,
							winner: lowWon ? low : high,
							loser: lowWon ? high : low,
							winnerFrames: lowWon ? lowFrames : highFrames,
							loserFrames: lowWon ? highFrames : lowFrames
						},
			award:
				row.award_player_id === null
					? null
					: {
							playerId: row.award_player_id,
							playerName: row.award_player_name ?? '',
							tablePoints: row.award_points ?? 0,
							sourceType: row.award_source ?? 'manual',
							reason: row.award_reason
						},
			lastPlayableDate: roundWindowEnd,
			canManage: permission.allowed,
			adminOverride: permission.adminOverride,
			manageReason: permission.reason
		};
	});

	return views.sort((a, b) => {
		if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
		if (STATE_ORDER[a.state] !== STATE_ORDER[b.state]) return STATE_ORDER[a.state] - STATE_ORDER[b.state];
		if (Boolean(a.plannedDate) !== Boolean(b.plannedDate)) return a.plannedDate ? -1 : 1;
		return a.low.name.localeCompare(b.low.name) || a.high.name.localeCompare(b.high.name);
	});
}

export function countOutstanding(fixtures: FixtureView[]): number {
	return fixtures.filter((fixture) => fixture.state === 'unplayed' || fixture.state === 'awaiting_confirmation')
		.length;
}

/* ------------------------------------------------------------------ *
 * Results archive
 * ------------------------------------------------------------------ */

export interface ResultsArchive {
	roundNumber: number;
	roundId: number;
	roundStatus: 'open' | 'closed';
	isCurrentRound: boolean;
	previousRoundNumber: number | null;
	nextRoundNumber: number | null;
	progress: RoundProgress;
	/** Confirmed results only, newest actual date first. */
	results: ResultView[];
	/** Results submitted but not yet confirmed — resolved, but not in the table. */
	awaitingConfirmation: number;
	viewerPlayedCount: number;
}

interface ResultRow {
	id: number;
	player_low_frames: number;
	player_high_frames: number;
	actual_played_date: string;
	status: 'submitted' | 'confirmed' | 'sent_back';
	entry_source: 'player' | 'admin_direct' | 'admin_retrospective';
	submitted_by_name: string | null;
	confirmed_by_name: string | null;
	confirmed_at: string | null;
	frame_detail_count: number;
	player_low_id: number;
	low_name: string;
	low_initials: string;
	low_tone: string;
	player_high_id: number;
	high_name: string;
	high_initials: string;
	high_tone: string;
}

const RESULTS_SQL = `
	SELECT r.id, r.player_low_frames, r.player_high_frames, r.actual_played_date, r.status,
		r.entry_source, r.confirmed_at,
		submitter.display_name AS submitted_by_name,
		confirmer.display_name AS confirmed_by_name,
		(SELECT COUNT(*) FROM result_frames rf WHERE rf.result_id = r.id) AS frame_detail_count,
		f.player_low_id, low.display_name AS low_name, low.initials AS low_initials, low.avatar_tone AS low_tone,
		f.player_high_id, high.display_name AS high_name, high.initials AS high_initials, high.avatar_tone AS high_tone
	FROM results r
	JOIN fixtures f ON f.id = r.fixture_id
	JOIN players low ON low.id = f.player_low_id
	JOIN players high ON high.id = f.player_high_id
	LEFT JOIN players submitter ON submitter.id = r.submitted_by_player_id
	LEFT JOIN players confirmer ON confirmer.id = r.confirmed_by_player_id
	WHERE f.round_id = ?
	ORDER BY r.actual_played_date DESC, low.display_name COLLATE NOCASE, high.display_name COLLATE NOCASE
`;

export function loadResultsArchive(
	db: Db,
	season: SeasonSummary,
	round: RoundSummary,
	options: { viewerPlayerId: number | null; currentRoundId: number | null }
): ResultsArchive {
	const rows = db.prepare(RESULTS_SQL).all(round.roundId) as unknown as ResultRow[];
	const index = season.rounds.findIndex((entry) => entry.roundId === round.roundId);
	const confirmed: ResultView[] = [];
	let awaitingConfirmation = 0;
	let viewerPlayedCount = 0;

	for (const row of rows) {
		const low = toPlayerView({
			player_id: row.player_low_id,
			name: row.low_name,
			initials: row.low_initials,
			tone: row.low_tone
		});
		const high = toPlayerView({
			player_id: row.player_high_id,
			name: row.high_name,
			initials: row.high_initials,
			tone: row.high_tone
		});
		const lowWon = row.player_low_frames >= row.player_high_frames;
		const view: ResultView = {
			resultId: row.id,
			lowFrames: row.player_low_frames,
			highFrames: row.player_high_frames,
			actualPlayedDate: row.actual_played_date,
			status: row.status,
			entrySource: row.entry_source,
			submittedByName: row.submitted_by_name,
			confirmedByName: row.confirmed_by_name,
			confirmedAt: row.confirmed_at,
			frameDetailCount: row.frame_detail_count,
			winner: lowWon ? low : high,
			loser: lowWon ? high : low,
			winnerFrames: lowWon ? row.player_low_frames : row.player_high_frames,
			loserFrames: lowWon ? row.player_high_frames : row.player_low_frames
		};
		if (row.status === 'confirmed') {
			confirmed.push(view);
			if (
				options.viewerPlayerId !== null &&
				(row.player_low_id === options.viewerPlayerId || row.player_high_id === options.viewerPlayerId)
			) {
				viewerPlayedCount++;
			}
		} else {
			awaitingConfirmation++;
		}
	}

	return {
		roundNumber: round.number,
		roundId: round.roundId,
		roundStatus: round.status,
		isCurrentRound: round.roundId === options.currentRoundId,
		previousRoundNumber: index > 0 ? season.rounds[index - 1].number : null,
		nextRoundNumber: index >= 0 && index < season.rounds.length - 1 ? season.rounds[index + 1].number : null,
		progress: round.progress,
		results: confirmed,
		awaitingConfirmation,
		viewerPlayedCount
	};
}

/* ------------------------------------------------------------------ *
 * Page data
 * ------------------------------------------------------------------ */

export type FixturesTab = 'fixtures' | 'results';

export interface FixturesPageData {
	season: SeasonSummary | null;
	viewer: ViewerPlayer | null;
	tab: FixturesTab;
	/** The round the Fixtures tab shows: the scheduling round, else the latest. */
	currentRound: RoundSummary | null;
	fixtures: FixtureView[];
	outstanding: number;
	/** The round whose results archive is shown. */
	archiveRound: RoundSummary | null;
	archive: ResultsArchive | null;
}

function pickCurrentRound(season: SeasonSummary): RoundSummary | null {
	return season.rounds.find((round) => round.status === 'open') ?? season.rounds.at(-1) ?? null;
}

export function loadFixturesPageData(
	db: Db,
	options: {
		viewer: ViewerPlayer | null;
		tab?: FixturesTab;
		/** Requested results-archive round number (validated against the season). */
		roundNumber?: number | null;
	}
): FixturesPageData {
	const seasonRow = db
		.prepare('SELECT id FROM seasons ORDER BY id DESC LIMIT 1')
		.get() as { id: number } | undefined;
	if (!seasonRow) {
		return {
			season: null,
			viewer: options.viewer,
			tab: options.tab ?? 'fixtures',
			currentRound: null,
			fixtures: [],
			outstanding: 0,
			archiveRound: null,
			archive: null
		};
	}
	const season = loadSeason(db, seasonRow.id);
	if (!season) throw new Error(`Season ${seasonRow.id} could not be loaded.`);

	const currentRound = pickCurrentRound(season);
	const fixtures = currentRound
		? loadFixtureViews(db, currentRound, { viewer: options.viewer, timeZone: season.timezone })
		: [];
	const archiveRound =
		(options.roundNumber != null
			? season.rounds.find((round) => round.number === options.roundNumber)
			: undefined) ??
		currentRound ??
		null;

	return {
		season,
		viewer: options.viewer,
		tab: options.tab ?? 'fixtures',
		currentRound,
		fixtures,
		outstanding: countOutstanding(fixtures),
		archiveRound,
		archive: archiveRound
			? loadResultsArchive(db, season, archiveRound, {
					viewerPlayerId: options.viewer?.playerId ?? null,
					currentRoundId: currentRound?.roundId ?? null
				})
			: null
	};
}

/* ------------------------------------------------------------------ *
 * Fixture detail
 * ------------------------------------------------------------------ */

export interface FixtureDetailData {
	season: SeasonSummary;
	viewer: ViewerPlayer | null;
	fixture: FixtureView;
	history: BookingRecord[];
	frames: FrameDetailView[];
	breaks: BreakView[];
	roundWindowEnd: string | null;
}

export function loadFixtureDetailData(
	db: Db,
	options: { fixtureId: number; viewer: ViewerPlayer | null }
): FixtureDetailData | null {
	const context = loadFixtureContext(db, options.fixtureId);
	if (!context) return null;
	const season = loadSeason(db, (db
		.prepare('SELECT season_id FROM rounds WHERE id = ?')
		.get(context.roundId) as { season_id: number } | undefined)?.season_id ?? 0);
	if (!season) return null;
	const round = season.rounds.find((entry) => entry.roundId === context.roundId);
	if (!round) return null;

	const fixture = loadFixtureViews(db, round, {
		viewer: options.viewer,
		timeZone: season.timezone
	}).find((entry) => entry.fixtureId === options.fixtureId);
	if (!fixture) return null;

	const frames: FrameDetailView[] = fixture.result
		? (
				db
					.prepare(
						'SELECT frame_number, player_low_points, player_high_points FROM result_frames WHERE result_id = ? ORDER BY frame_number'
					)
					.all(fixture.result.resultId) as Array<{
					frame_number: number;
					player_low_points: number;
					player_high_points: number;
				}>
			).map((row) => ({
				frameNumber: row.frame_number,
				lowPoints: row.player_low_points,
				highPoints: row.player_high_points
			}))
		: [];
	const breaks: BreakView[] = fixture.result
		? (
				db
					.prepare(
						`SELECT rb.player_id, rb.break_points, p.display_name
						 FROM result_breaks rb JOIN players p ON p.id = rb.player_id
						 WHERE rb.result_id = ? ORDER BY rb.break_points DESC`
					)
					.all(fixture.result.resultId) as Array<{
					player_id: number;
					break_points: number;
					display_name: string;
				}>
			).map((row) => ({
				playerId: row.player_id,
				playerName: row.display_name,
				breakPoints: row.break_points
			}))
		: [];

	return {
		season,
		viewer: options.viewer,
		fixture,
		history: loadBookingHistory(db, options.fixtureId),
		frames,
		breaks,
		roundWindowEnd: roundPlayableWindowEnd(round, season.timezone)
	};
}

/** Active planned date for an arrange screen, with the same permission checks. */
export function loadArrangeScreenData(
	db: Db,
	options: { fixtureId: number; viewer: ViewerPlayer | null }
): { fixture: FixtureView; active: BookingRecord | null; round: RoundSummary } | null {
	const detail = loadFixtureDetailData(db, options);
	if (!detail) return null;
	const round = detail.season.rounds.find((entry) => entry.roundId === detail.fixture.roundId);
	if (!round) return null;
	return {
		fixture: detail.fixture,
		active: loadActiveBooking(db, options.fixtureId),
		round
	};
}
