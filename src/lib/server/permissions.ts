/**
 * Consolidated permission matrix (HANDOFF §9, §11 Q6, PLAN Phase 8).
 *
 * Single source of truth for authorization across:
 *   - League matches, bookings, results, reviews, corrections, and retrospective entries
 *   - Administrative lifecycle, scheduler, withdrawals, awards review, and season creation
 *   - Friendly matches (Phase 10 specification)
 *   - Knockout competitions (Phases 11–12 specification)
 *   - Player profiles & contact details visibility
 *
 * Rules are evaluated server-side against the authenticated viewer and database state.
 */
import type { ViewerPlayer, ViewerRole } from './viewer';

export interface PermissionCheck {
	allowed: boolean;
	reason: string | null;
}

/** Check if viewer is an admin or super-admin. */
export function isAdminOrSuperAdmin(viewer: ViewerPlayer | null): boolean {
	return viewer?.role === 'admin' || viewer?.role === 'super_admin';
}

/** Check if viewer is a super-admin. */
export function isSuperAdmin(viewer: ViewerPlayer | null): boolean {
	return viewer?.role === 'super_admin';
}

/* ------------------------------------------------------------------ *
 * League admin permissions
 * ------------------------------------------------------------------ */

/**
 * Round lifecycle actions: opening rounds, setting final-round status,
 * running the auto-advance scheduler.
 */
export function canManageRounds(viewer: ViewerPlayer | null): PermissionCheck {
	if (!viewer) {
		return { allowed: false, reason: 'Sign in with an administrator account to manage rounds.' };
	}
	if (!isAdminOrSuperAdmin(viewer)) {
		return { allowed: false, reason: 'Administrator privileges are required to manage rounds.' };
	}
	return { allowed: true, reason: null };
}

/**
 * Creating a season and configuring scoring rules. Reserved for super-admin
 * at season boundaries so that mid-season or unauthorized scoring changes are impossible.
 */
export function canCreateSeason(viewer: ViewerPlayer | null): PermissionCheck {
	if (!viewer) {
		return { allowed: false, reason: 'Sign in with an administrator account to create a season.' };
	}
	if (!isSuperAdmin(viewer)) {
		return {
			allowed: false,
			reason: 'Only a super-admin can create a new season and configure scoring rules.'
		};
	}
	return { allowed: true, reason: null };
}

/**
 * Marking player withdrawals and generating administrative awards.
 */
export function canWithdrawPlayer(viewer: ViewerPlayer | null): PermissionCheck {
	if (!viewer) {
		return { allowed: false, reason: 'Sign in with an administrator account to withdraw a player.' };
	}
	if (!isAdminOrSuperAdmin(viewer)) {
		return { allowed: false, reason: 'Administrator privileges are required to withdraw a player.' };
	}
	return { allowed: true, reason: null };
}

/**
 * Reviewing awards flagged because of source result corrections.
 */
export function canReviewAward(viewer: ViewerPlayer | null): PermissionCheck {
	if (!viewer) {
		return { allowed: false, reason: 'Sign in with an administrator account to review awards.' };
	}
	if (!isAdminOrSuperAdmin(viewer)) {
		return { allowed: false, reason: 'Administrator privileges are required to review awards.' };
	}
	return { allowed: true, reason: null };
}

/**
 * Viewing the league-wide result queue and activity ledger.
 */
export function canViewAdminDashboard(viewer: ViewerPlayer | null): PermissionCheck {
	if (!viewer) {
		return { allowed: false, reason: 'Sign in to access administrator views.' };
	}
	if (!isAdminOrSuperAdmin(viewer)) {
		return { allowed: false, reason: 'Administrator privileges are required to access this view.' };
	}
	return { allowed: true, reason: null };
}

/* ------------------------------------------------------------------ *
 * Contact visibility permissions
 * ------------------------------------------------------------------ */

export interface TargetPlayerContact {
	id: number;
	email: string;
	phone?: string | null;
	contactVisible: boolean;
}

/**
 * Contact visibility rules (HANDOFF §9, §10):
 * - A player can always see their own contact details.
 * - Administrators can always see contact details to coordinate league matters.
 * - Authenticated league members can see contact details if `contactVisible` is true (default).
 * - If `contactVisible` is false, other members see contact as hidden.
 * - Unauthenticated visitors can never see member contact details.
 */
export function canViewPlayerContact(
	viewer: ViewerPlayer | null,
	targetPlayer: { id: number; contactVisible: boolean }
): boolean {
	if (!viewer) return false;
	if (viewer.playerId === targetPlayer.id) return true;
	if (isAdminOrSuperAdmin(viewer)) return true;
	return targetPlayer.contactVisible;
}

export interface MaskedContact {
	email: string | null;
	phone: string | null;
	contactVisible: boolean;
	isHidden: boolean;
	adminViewOnly: boolean;
}

export function filterContactDetails(
	viewer: ViewerPlayer | null,
	target: TargetPlayerContact
): MaskedContact {
	const isSelf = viewer?.playerId === target.id;
	const isAdmin = isAdminOrSuperAdmin(viewer);
	const canSee = isSelf || isAdmin || (Boolean(viewer) && target.contactVisible);

	return {
		email: canSee ? target.email : null,
		phone: canSee ? target.phone ?? null : null,
		contactVisible: target.contactVisible,
		isHidden: !target.contactVisible,
		adminViewOnly: isAdmin && !isSelf && !target.contactVisible
	};
}

/**
 * Profile editing permissions: self or super-admin.
 */
export function canEditProfile(viewer: ViewerPlayer | null, targetPlayerId: number): PermissionCheck {
	if (!viewer) {
		return { allowed: false, reason: 'Sign in to edit your profile.' };
	}
	if (viewer.playerId === targetPlayerId || isSuperAdmin(viewer)) {
		return { allowed: true, reason: null };
	}
	return { allowed: false, reason: 'You can only edit your own profile settings.' };
}

/* ------------------------------------------------------------------ *
 * Friendlies (Phase 10 specification per HANDOFF §5)
 * ------------------------------------------------------------------ */

export function canScheduleFriendly(viewer: ViewerPlayer | null): PermissionCheck {
	if (!viewer) {
		return { allowed: false, reason: 'Sign in as a registered league player to arrange friendlies.' };
	}
	return { allowed: true, reason: null };
}

export function canRecordFriendlyResult(
	viewer: ViewerPlayer | null,
	playerAId: number,
	playerBId: number
): PermissionCheck {
	if (!viewer) {
		return { allowed: false, reason: 'Sign in as one of the two players to record a friendly result.' };
	}
	const isParticipant = viewer.playerId === playerAId || viewer.playerId === playerBId;
	if (isParticipant || isAdminOrSuperAdmin(viewer)) {
		return { allowed: true, reason: null };
	}
	return { allowed: false, reason: 'Only the participating players (or an admin) can record a friendly result.' };
}

export function canCorrectFriendlyResult(
	viewer: ViewerPlayer | null,
	playerAId: number,
	playerBId: number
): PermissionCheck {
	if (!viewer) {
		return { allowed: false, reason: 'Sign in to correct a friendly result.' };
	}
	const isParticipant = viewer.playerId === playerAId || viewer.playerId === playerBId;
	if (isParticipant || isAdminOrSuperAdmin(viewer)) {
		return { allowed: true, reason: null };
	}
	return { allowed: false, reason: 'Either participant or an admin may correct a friendly result.' };
}

/* ------------------------------------------------------------------ *
 * Knockout (Phases 11–12 specification per HANDOFF §6)
 * ------------------------------------------------------------------ */

export function canConfigureKnockout(viewer: ViewerPlayer | null): PermissionCheck {
	if (!viewer) {
		return { allowed: false, reason: 'Sign in with an administrator account to configure knockouts.' };
	}
	if (!isAdminOrSuperAdmin(viewer)) {
		return { allowed: false, reason: 'Administrator privileges are required to configure knockouts.' };
	}
	return { allowed: true, reason: null };
}

export function canOptInKnockout(
	viewer: ViewerPlayer | null,
	targetPlayerId: number
): PermissionCheck {
	if (!viewer) {
		return { allowed: false, reason: 'Sign in to enter the knockout tournament.' };
	}
	if (viewer.playerId === targetPlayerId || isAdminOrSuperAdmin(viewer)) {
		return { allowed: true, reason: null };
	}
	return { allowed: false, reason: 'Players may only enter themselves in the knockout tournament.' };
}

export function canRecordKnockoutMatch(
	viewer: ViewerPlayer | null,
	playerLowId: number,
	playerHighId: number
): PermissionCheck {
	if (!viewer) {
		return { allowed: false, reason: 'Sign in to record a knockout match.' };
	}
	const isParticipant = viewer.playerId === playerLowId || viewer.playerId === playerHighId;
	if (isParticipant || isAdminOrSuperAdmin(viewer)) {
		return { allowed: true, reason: null };
	}
	return { allowed: false, reason: 'Only the participants or an admin can record a knockout match.' };
}
