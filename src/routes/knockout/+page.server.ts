import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { canConfigureKnockout, isAdminOrSuperAdmin } from '$lib/server/permissions';
import {
	createKnockoutCompetition,
	drawKnockoutOpeningStage,
	finaliseKnockoutEntry,
	KnockoutPermissionError,
	KnockoutValidationError,
	loadKnockoutCompetitions,
	recordKnockoutSwap,
	respondToKnockoutInvitation
} from '$lib/server/knockout';
import {
	deadlineAfterLocalDays,
	localDateTimeInputValue,
	parseLocalDateTimeInput
} from '$lib/server/league-time';

function currentTimezone(db: ReturnType<typeof getDb>): string {
	const row = db.prepare('SELECT timezone FROM seasons ORDER BY id DESC LIMIT 1').get() as
		| { timezone: string }
		| undefined;
	return row?.timezone ?? 'Europe/London';
}

function wholeNumber(value: FormDataEntryValue | null, label: string): number {
	const raw = String(value ?? '');
	if (!/^\d+$/.test(raw)) throw new Error(`${label} must be a whole number.`);
	const parsed = Number(raw);
	if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is invalid.`);
	return parsed;
}

function competitionId(value: FormDataEntryValue | null): number {
	const id = wholeNumber(value, 'Competition');
	if (id < 1) throw new Error('Choose a valid knockout invitation.');
	return id;
}

function actionFailure(cause: unknown, fallback: string) {
	if (cause instanceof KnockoutPermissionError) {
		return fail(403, { message: cause.message });
	}
	if (cause instanceof KnockoutValidationError) {
		return fail(400, { message: cause.errors.join(' ') });
	}
	return fail(400, { message: cause instanceof Error ? cause.message : fallback });
}

export const load: PageServerLoad = ({ locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const timezone = currentTimezone(db);
	const now = new Date();
	const manageCheck = canConfigureKnockout(viewer);
	const defaultDeadline = new Date(deadlineAfterLocalDays(now, 7, timezone));
	const competitions = loadKnockoutCompetitions(db, viewer?.playerId ?? null).map((competition) => {
		const deadline = new Date(competition.replyDeadlineAt).getTime();
		const deadlinePassed = now.getTime() >= deadline;
		const canManage = manageCheck.allowed;
		return {
			...competition,
			deadlinePassed,
			canRespond: Boolean(viewer && competition.status === 'inviting' && !deadlinePassed),
			canFinalise: Boolean(canManage && competition.status === 'inviting' && deadlinePassed),
			canSwap: Boolean(canManage && competition.status === 'selected' && competition.stages.length === 0),
			canDraw: Boolean(
				canManage &&
				competition.status === 'selected' &&
				competition.stages.length === 0 &&
				competition.selectedPlayers.length >= 6 &&
				competition.selectedPlayers.length <= 8
			)
		};
	});

	return {
		competitions,
		timezone,
		defaultDeadline: localDateTimeInputValue(defaultDeadline, timezone),
		viewer: viewer ? { playerId: viewer.playerId, name: viewer.name, role: viewer.role } : null,
		isAdmin: isAdminOrSuperAdmin(viewer),
		isSuperAdmin: viewer?.role === 'super_admin',
		canManage: manageCheck.allowed,
		manageReason: manageCheck.reason
	};
};

export const actions: Actions = {
	announce: async ({ request, locals }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const permission = canConfigureKnockout(viewer);
		if (!permission.allowed || !viewer) {
			return fail(403, { message: permission.reason ?? 'Administrator privileges are required.' });
		}
		const form = await request.formData();
		try {
			const timezone = currentTimezone(db);
			const replyDeadline = parseLocalDateTimeInput(
				String(form.get('replyDeadline') ?? '').trim(),
				timezone
			);
			if (!replyDeadline) throw new Error(`Enter a valid local reply deadline in ${timezone}.`);
			const framesToWin = wholeNumber(form.get('framesToWin'), 'Frames to win');
			const id = createKnockoutCompetition(db, {
				actorPlayerId: viewer.playerId,
				title: String(form.get('title') ?? ''),
				announcement: String(form.get('announcement') ?? ''),
				replyDeadlineAt: replyDeadline.toISOString(),
				framesToWin
			});
			return { message: `“${String(form.get('title') ?? '').trim()}” is now open for knockout replies (invitation ${id}).` };
		} catch (cause) {
			return actionFailure(cause, 'Could not announce the knockout invitation.');
		}
	},

	respond: async ({ request, locals }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		if (!viewer) return fail(403, { message: 'Sign in as an active league player to enter the knockout.' });
		const form = await request.formData();
		try {
			const response = String(form.get('optedIn') ?? '');
			if (response !== 'true' && response !== 'false') {
				throw new Error('Choose whether to enter this knockout.');
			}
			const result = respondToKnockoutInvitation(db, {
				competitionId: competitionId(form.get('competitionId')),
				actorPlayerId: viewer.playerId,
				optedIn: response === 'true'
			});
			return {
				message: !result.changed
					? 'Your reply is already saved.'
					: result.optedIn
						? 'You’re on the entry list. You can change your reply before the deadline.'
						: 'You’re marked as not entering. You can opt in again before the deadline.'
			};
		} catch (cause) {
			return actionFailure(cause, 'Could not save your knockout reply.');
		}
	},

	finalise: async ({ request, locals }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const permission = canConfigureKnockout(viewer);
		if (!permission.allowed || !viewer) {
			return fail(403, { message: permission.reason ?? 'Administrator privileges are required.' });
		}
		const form = await request.formData();
		try {
			const result = finaliseKnockoutEntry(db, {
				competitionId: competitionId(form.get('competitionId')),
				actorPlayerId: viewer.playerId
			});
			return {
				message:
					result.status === 'abandoned'
						? `The reply deadline passed with ${result.entrantCount} entrant${result.entrantCount === 1 ? '' : 's'}. The attempt is abandoned; it cannot be extended or run with fewer than six.`
						: `Entry is closed: ${result.selectedPlayerIds.length} selected${result.waitingPlayerIds.length ? ` and ${result.waitingPlayerIds.length} placed on the random waiting list` : ''}.`
			};
		} catch (cause) {
			return actionFailure(cause, 'Could not close knockout entry.');
		}
	},

	swap: async ({ request, locals }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const permission = canConfigureKnockout(viewer);
		if (!permission.allowed || !viewer) {
			return fail(403, { message: permission.reason ?? 'Administrator privileges are required.' });
		}
		const form = await request.formData();
		try {
			recordKnockoutSwap(db, {
				competitionId: competitionId(form.get('competitionId')),
				actorPlayerId: viewer.playerId,
				selectedPlayerId: wholeNumber(form.get('selectedPlayerId'), 'Selected player'),
				waitingPlayerId: wholeNumber(form.get('waitingPlayerId'), 'Waiting-list player'),
				consentConfirmed: form.get('consentConfirmed') === 'yes',
				reason: String(form.get('reason') ?? '')
			});
			return { message: 'Consensual swap recorded. The original random selection was not rerun.' };
		} catch (cause) {
			return actionFailure(cause, 'Could not record the knockout swap.');
		}
	},

	draw: async ({ request, locals }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const permission = canConfigureKnockout(viewer);
		if (!permission.allowed || !viewer) {
			return fail(403, { message: permission.reason ?? 'Administrator privileges are required.' });
		}
		const form = await request.formData();
		try {
			const result = drawKnockoutOpeningStage(db, {
				competitionId: competitionId(form.get('competitionId')),
				actorPlayerId: viewer.playerId
			});
			const byeText = result.byePlayerIds.length ? ` ${result.byePlayerIds.length} bye${result.byePlayerIds.length === 1 ? '' : 's'} are saved too.` : '';
			return {
				message: `First-stage draw saved: ${result.matchups.length} opening tie${result.matchups.length === 1 ? '' : 's'}.${byeText} Every match is first to ${result.framesToWin}.`
			};
		} catch (cause) {
			return actionFailure(cause, 'Could not save the opening draw.');
		}
	}
};
