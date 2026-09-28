/**
 * View shapes for a league result and its history (Phase 6).
 *
 * Plain, serialisable display objects shared by the server loaders
 * (`src/lib/server/results.ts`) and the components that render them, so a
 * component never has to import a server module — not even for a type.
 *
 * The one rule these shapes carry everywhere: `actualPlayedDate` is the day the
 * frames were played, and a planned date is a different thing on a different
 * object (`PlannedDateView` in `fixture-view.ts`).
 */

export type ResultStatusView = 'submitted' | 'confirmed' | 'sent_back';
export type EntrySourceView = 'player' | 'admin_direct' | 'admin_retrospective';

export interface ResultParty {
	playerId: number;
	name: string;
	initials: string;
	tone: string;
}

export interface FrameWinnerView {
	frameNumber: number;
	playerId: number;
	playerName: string;
	/** Point score for the frame, when the optional detail was entered. */
	lowPoints: number | null;
	highPoints: number | null;
}

export interface FramePointsView {
	frameNumber: number;
	lowPoints: number;
	highPoints: number;
}

export interface ResultBreakView {
	playerId: number;
	playerName: string;
	breakPoints: number;
}

export interface ResultRecordView {
	resultId: number;
	fixtureId: number;
	roundId: number;
	roundNumber: number;
	seasonLabel: string;
	status: ResultStatusView;
	entrySource: EntrySourceView;
	/** How many times this result has been written: 1 for a first submission. */
	revision: number;
	low: ResultParty;
	high: ResultParty;
	lowFrames: number;
	highFrames: number;
	winner: ResultParty;
	loser: ResultParty;
	winnerFrames: number;
	loserFrames: number;
	actualPlayedDate: string;
	submittedByPlayerId: number;
	submittedByName: string;
	submittedAt: string;
	confirmedByPlayerId: number | null;
	confirmedByName: string | null;
	confirmedAt: string | null;
	correctedByPlayerId: number | null;
	correctedByName: string | null;
	correctedAt: string | null;
	correctionReason: string | null;
	sentBackByPlayerId: number | null;
	sentBackByName: string | null;
	sentBackAt: string | null;
	sendBackReason: string | null;
	detailsLockedAt: string | null;
	frameWinners: FrameWinnerView[];
	frames: FramePointsView[];
	breaks: ResultBreakView[];
	hasFramePoints: boolean;
	hasBreaks: boolean;
	/** True when an administrative award takes its value from this result. */
	isAwardSource: boolean;
}

export interface ResultAuditView {
	id: number;
	action: string;
	actorPlayerId: number | null;
	actorName: string | null;
	reason: string | null;
	detail: unknown;
	createdAt: string;
}

/** Colour-independent status copy (never colour alone). */
export function resultStatusLabel(status: ResultStatusView): string {
	switch (status) {
		case 'submitted':
			return 'Awaiting confirmation';
		case 'confirmed':
			return 'Confirmed';
		case 'sent_back':
			return 'Sent back for correction';
	}
}

export function resultStatusClass(status: ResultStatusView): string {
	switch (status) {
		case 'submitted':
			return 'status-pending';
		case 'confirmed':
			return 'status-confirmed';
		case 'sent_back':
			return 'status-sentback';
	}
}

/** How the result reached the database, in words. */
export function entrySourceLabel(entrySource: EntrySourceView): string {
	switch (entrySource) {
		case 'player':
			return 'Recorded by a player';
		case 'admin_direct':
			return 'Entered directly by a super-admin (no opponent approval)';
		case 'admin_retrospective':
			return 'Recorded retrospectively by an admin for a closed fixture';
	}
}

const AUDIT_LABELS: Record<string, string> = {
	submitted: 'Result submitted',
	resubmitted: 'Corrected and resubmitted',
	confirmed: 'Confirmed by the opponent',
	sent_back: 'Sent back for correction',
	corrected: 'Changed by an admin after approval',
	direct_entry: 'Entered directly by a super-admin',
	retrospective_recorded: 'Retrospective result recorded by an admin',
	award_review_needed: 'An administrative award based on this result needs review'
};

/** Human copy for one audit entry. */
export function auditActionLabel(action: string): string {
	return AUDIT_LABELS[action] ?? action.replaceAll('_', ' ');
}
