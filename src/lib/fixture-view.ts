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
	accepted: boolean;
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
	submittedByPlayerId: number | null;
	submittedByName: string | null;
	confirmedByName: string | null;
	confirmedAt: string | null;
	/** How many times this row has been written: 1 for a first submission. */
	revision: number;
	/** Who sent it back and what they asked the submitter to check. */
	sentBackByName: string | null;
	sendBackReason: string | null;
	/** Post-approval admin change bookkeeping. */
	correctedByName: string | null;
	correctedAt: string | null;
	correctionReason: string | null;
	frameDetailCount: number;
	breakCount: number;
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
	/** What the viewer may do with this fixture's result right now (Phase 6). */
	resultActions: ResultActionsView;
}

/**
 * The result entry points a viewer has on a fixture card. Computed server-side
 * from the same permissions the write paths enforce, so a button is never shown
 * for an action the server would refuse.
 */
export interface ResultActionsView {
	/** Record a result for a fixture that has none. */
	canRecord: boolean;
	/** Correct and resubmit a result the opponent sent back. */
	canResubmit: boolean;
	/** Confirm or send back the submitted result. */
	canReview: boolean;
	/** Admin change of a confirmed result. */
	canCorrect: boolean;
	/** Super-admin entry without opponent approval. */
	canEnterDirectly: boolean;
	/** Admin retrospective result for a neutrally closed fixture. */
	canRecordRetrospective: boolean;
	/** Why the viewer cannot act, when they cannot (shown, not just hidden). */
	reason: string | null;
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
export function fixtureStateLabel(
	state: FixtureState,
	plannedDate: PlannedDateView | null,
	result: ResultView | null = null
): string {
	switch (state) {
		case 'unplayed':
			// A sent-back result leaves the fixture outstanding again, and saying so
			// is the difference between "still to play" and "needs your correction".
			if (result?.status === 'sent_back') return 'Sent back for correction';
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

export function fixtureStatusClass(
	state: FixtureState,
	plannedDate: PlannedDateView | null,
	result: ResultView | null = null
): string {
	switch (state) {
		case 'unplayed':
			if (result?.status === 'sent_back') return 'status-sentback';
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
