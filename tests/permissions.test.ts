import { describe, expect, it } from 'vitest';
import {
	canManageRounds,
	canCreateSeason,
	canWithdrawPlayer,
	canReviewAward,
	canViewAdminDashboard,
	canViewPlayerContact,
	filterContactDetails,
	canEditProfile,
	canScheduleFriendly,
	canRecordFriendlyResult,
	canCorrectFriendlyResult,
	canConfigureKnockout,
	canOptInKnockout,
	canRecordKnockoutMatch,
	isAdminOrSuperAdmin,
	isSuperAdmin
} from '../src/lib/server/permissions';
import type { ViewerPlayer } from '../src/lib/server/viewer';

const superAdmin: ViewerPlayer = {
	playerId: 1,
	name: 'Maya Chen',
	initials: 'MC',
	tone: 'maya',
	email: 'maya.chen@example.test',
	role: 'super_admin',
	phone: '07700 900123',
	contactVisible: true
};

const admin: ViewerPlayer = {
	playerId: 3,
	name: 'Jules Rivera',
	initials: 'JR',
	tone: 'jules',
	email: 'jules.rivera@example.test',
	role: 'admin',
	phone: '07700 900345',
	contactVisible: true
};

const player1: ViewerPlayer = {
	playerId: 2,
	name: 'Leon Park',
	initials: 'LP',
	tone: 'leon',
	email: 'leon.park@example.test',
	role: 'player',
	phone: '07700 900234',
	contactVisible: true
};

const player2: ViewerPlayer = {
	playerId: 6,
	name: 'Owen Brooks',
	initials: 'OB',
	tone: 'owen',
	email: 'owen.brooks@example.test',
	role: 'player',
	phone: '07700 900678',
	contactVisible: false
};

const outsiderPlayer: ViewerPlayer = {
	playerId: 8,
	name: 'Noah Kim',
	initials: 'NK',
	tone: 'noah',
	email: 'noah.kim@example.test',
	role: 'player',
	phone: null,
	contactVisible: true
};

describe('Consolidated Permission Matrix: Admin & Lifecycle operations', () => {
	it('allows admin and super-admin to manage rounds, forbids regular players and visitors', () => {
		expect(canManageRounds(superAdmin).allowed).toBe(true);
		expect(canManageRounds(admin).allowed).toBe(true);

		const playerCheck = canManageRounds(player1);
		expect(playerCheck.allowed).toBe(false);
		expect(playerCheck.reason).toMatch(/Administrator privileges are required/);

		const visitorCheck = canManageRounds(null);
		expect(visitorCheck.allowed).toBe(false);
		expect(visitorCheck.reason).toMatch(/Sign in with an administrator account/);
	});

	it('allows only super-admin to create seasons and scoring rules', () => {
		expect(canCreateSeason(superAdmin).allowed).toBe(true);

		const adminCheck = canCreateSeason(admin);
		expect(adminCheck.allowed).toBe(false);
		expect(adminCheck.reason).toMatch(/Only a super-admin can create a new season/);

		const playerCheck = canCreateSeason(player1);
		expect(playerCheck.allowed).toBe(false);

		const visitorCheck = canCreateSeason(null);
		expect(visitorCheck.allowed).toBe(false);
	});

	it('allows admin and super-admin to withdraw players, forbids others', () => {
		expect(canWithdrawPlayer(superAdmin).allowed).toBe(true);
		expect(canWithdrawPlayer(admin).allowed).toBe(true);
		expect(canWithdrawPlayer(player1).allowed).toBe(false);
		expect(canWithdrawPlayer(null).allowed).toBe(false);
	});

	it('allows admin and super-admin to review source-corrected awards', () => {
		expect(canReviewAward(superAdmin).allowed).toBe(true);
		expect(canReviewAward(admin).allowed).toBe(true);
		expect(canReviewAward(player1).allowed).toBe(false);
		expect(canReviewAward(null).allowed).toBe(false);
	});

	it('allows admin and super-admin to view admin dashboard', () => {
		expect(canViewAdminDashboard(superAdmin).allowed).toBe(true);
		expect(canViewAdminDashboard(admin).allowed).toBe(true);
		expect(canViewAdminDashboard(player1).allowed).toBe(false);
		expect(canViewAdminDashboard(null).allowed).toBe(false);
	});
});

describe('Consolidated Permission Matrix: Contact Visibility & Profile', () => {
	const visibleTarget = {
		id: 2,
		name: 'Leon Park',
		email: 'leon.park@example.test',
		phone: '07700 900234',
		contactVisible: true
	};

	const hiddenTarget = {
		id: 6,
		name: 'Owen Brooks',
		email: 'owen.brooks@example.test',
		phone: '07700 900678',
		contactVisible: false
	};

	it('allows a player to always view their own contact details regardless of visibility flag', () => {
		expect(canViewPlayerContact(player2, hiddenTarget)).toBe(true);
		const filtered = filterContactDetails(player2, hiddenTarget);
		expect(filtered.email).toBe('owen.brooks@example.test');
		expect(filtered.phone).toBe('07700 900678');
		expect(filtered.adminViewOnly).toBe(false);
		expect(filtered.isHidden).toBe(true);
	});

	it('allows administrators to view contact details for coordination even when hidden', () => {
		expect(canViewPlayerContact(admin, hiddenTarget)).toBe(true);
		const filtered = filterContactDetails(admin, hiddenTarget);
		expect(filtered.email).toBe('owen.brooks@example.test');
		expect(filtered.phone).toBe('07700 900678');
		expect(filtered.adminViewOnly).toBe(true);
		expect(filtered.isHidden).toBe(true);
	});

	it('allows fellow league members to view contact details when contactVisible is true', () => {
		expect(canViewPlayerContact(player2, visibleTarget)).toBe(true);
		const filtered = filterContactDetails(player2, visibleTarget);
		expect(filtered.email).toBe('leon.park@example.test');
		expect(filtered.phone).toBe('07700 900234');
		expect(filtered.isHidden).toBe(false);
	});

	it('masks contact details from fellow league members when contactVisible is false', () => {
		expect(canViewPlayerContact(player1, hiddenTarget)).toBe(false);
		const filtered = filterContactDetails(player1, hiddenTarget);
		expect(filtered.email).toBeNull();
		expect(filtered.phone).toBeNull();
		expect(filtered.isHidden).toBe(true);
		expect(filtered.adminViewOnly).toBe(false);
	});

	it('never exposes contact details to unauthenticated visitors', () => {
		expect(canViewPlayerContact(null, visibleTarget)).toBe(false);
		expect(canViewPlayerContact(null, hiddenTarget)).toBe(false);
		const filteredVisible = filterContactDetails(null, visibleTarget);
		expect(filteredVisible.email).toBeNull();
		expect(filteredVisible.phone).toBeNull();
	});

	it('restricts profile editing to self or super-admin', () => {
		expect(canEditProfile(player1, 2).allowed).toBe(true);
		expect(canEditProfile(superAdmin, 2).allowed).toBe(true);

		const adminOnOther = canEditProfile(admin, 2);
		expect(adminOnOther.allowed).toBe(false);

		const playerOnOther = canEditProfile(player2, 2);
		expect(playerOnOther.allowed).toBe(false);

		const visitor = canEditProfile(null, 2);
		expect(visitor.allowed).toBe(false);
	});
});

describe('Consolidated Permission Matrix: Friendlies & Knockout', () => {
	it('evaluates friendly permissions according to HANDOFF §5', () => {
		expect(canScheduleFriendly(player1).allowed).toBe(true);
		expect(canScheduleFriendly(null).allowed).toBe(false);

		expect(canRecordFriendlyResult(player1, 2, 6).allowed).toBe(true);
		expect(canRecordFriendlyResult(player2, 2, 6).allowed).toBe(true);
		expect(canRecordFriendlyResult(admin, 2, 6).allowed).toBe(true);
		expect(canRecordFriendlyResult(outsiderPlayer, 2, 6).allowed).toBe(false);
		expect(canRecordFriendlyResult(null, 2, 6).allowed).toBe(false);

		expect(canCorrectFriendlyResult(player1, 2, 6).allowed).toBe(true);
		expect(canCorrectFriendlyResult(player2, 2, 6).allowed).toBe(true);
		expect(canCorrectFriendlyResult(admin, 2, 6).allowed).toBe(true);
		expect(canCorrectFriendlyResult(outsiderPlayer, 2, 6).allowed).toBe(false);
	});

	it('evaluates knockout permissions according to HANDOFF §6', () => {
		expect(canConfigureKnockout(admin).allowed).toBe(true);
		expect(canConfigureKnockout(superAdmin).allowed).toBe(true);
		expect(canConfigureKnockout(player1).allowed).toBe(false);

		expect(canOptInKnockout(player1, 2).allowed).toBe(true);
		expect(canOptInKnockout(player1, 6).allowed).toBe(false);
		expect(canOptInKnockout(admin, 6).allowed).toBe(true);

		expect(canRecordKnockoutMatch(player1, 2, 6).allowed).toBe(true);
		expect(canRecordKnockoutMatch(player2, 2, 6).allowed).toBe(true);
		expect(canRecordKnockoutMatch(admin, 2, 6).allowed).toBe(true);
		expect(canRecordKnockoutMatch(outsiderPlayer, 2, 6).allowed).toBe(false);
	});
});
