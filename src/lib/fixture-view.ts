/**
 * View shapes shared between the fixtures server loaders and the components that
 * render them (Phase 5).
 *
 * These are plain, serialisable display objects: every date here is already a
 * league-local calendar value, and planned dates (`PlannedDateView`) are always
 * distinct from actual dates played (`ResultView.actualPlayedDate`).
 */

export interface PlayerView {
	playerId: number;
	name: string;
	initials: string;
	tone: string;
}

export type FixtureState =
	| 'unplayed'
	| 'awaiting_confirmation'
	| 'confirmed'
	| 'closed_unplayed'
	| 'awarded';

export interface PlannedDateView {
	bookingId: number;
	/** League-local calendar date, YYYY-MM-DD. */
	date: string;
	/** Optional league-local wall-clock time, HH:MM. */
	time: string | null;
	note: string | null;
	proposedByPlayerId: number;
	proposedByName: string;
	/** True when the planned date is after the round's deadline + grace window. */
	afterWindow: boolean;
}

export interface ResultView {
	resultId: number;
	lowFrames: number;
	highFrames: number;
	/** The day the frames were actually played — never a planned date. */
	actualPlayedDate: string;
	status: 'submitted' | 'confirmed' | 'sent_back';
	entrySource: 'player' | 'admin_direct' | 'admin_retrospective';
	submittedByName: string | null;
	confirmedByName: string | null;
	confirmedAt: string | null;
	frameDetailCount: number;
	/** Winner first, for a scoreline that reads naturally (no league draws). */
	winner: PlayerView;
	loser: PlayerView;
	winnerFrames: number;
	loserFrames: number;
}

export interface AwardView {
	playerId: number;
	playerName: string;
	tablePoints: number;
	sourceType: 'previous_round_result' | 'random_draw' | 'manual';
	reason: string | null;
}

export interface FixtureView {
	fixtureId: number;
	roundId: number;
	roundNumber: number;
	roundStatus: 'open' | 'closed';
	state: FixtureState;
	low: PlayerView;
	high: PlayerView;
	isMine: boolean;
	plannedDate: PlannedDateView | null;
	result: ResultView | null;
	award: AwardView | null;
	/** Final league-local day this fixture can still be played (deadline + grace). */
	lastPlayableDate: string | null;
	canManage: boolean;
	adminOverride: boolean;
	manageReason: string | null;
}

export interface FrameDetailView {
	frameNumber: number;
	lowPoints: number;
	highPoints: number;
}

export interface BreakView {
	playerId: number;
	playerName: string;
	breakPoints: number;
}

/** Colour-independent status text for a fixture card (never colour alone). */
export function fixtureStateLabel(state: FixtureState, plannedDate: PlannedDateView | null): string {
	switch (state) {
		case 'unplayed':
			return plannedDate ? 'Date arranged' : 'No date arranged';
		case 'awaiting_confirmation':
			return 'Awaiting confirmation';
		case 'confirmed':
			return 'Confirmed';
		case 'awarded':
			return 'Award — no match played';
		case 'closed_unplayed':
			return 'Closed — not played';
	}
}

export function fixtureStatusClass(state: FixtureState, plannedDate: PlannedDateView | null): string {
	switch (state) {
		case 'unplayed':
			return plannedDate ? 'status-booked' : 'status-open';
		case 'awaiting_confirmation':
			return 'status-pending';
		case 'confirmed':
			return 'status-confirmed';
		case 'awarded':
			return 'status-award';
		case 'closed_unplayed':
			return 'status-closed';
	}
}
