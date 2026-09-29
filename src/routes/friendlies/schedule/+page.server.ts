import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import {
	FriendlyPermissionError,
	FriendlyValidationError,
	friendlyScheduleGate,
	loadFriendlyOpponents,
	loadFriendlyTimezone,
	scheduleFriendly
} from '$lib/server/friendlies';
import { localDateString } from '$lib/server/league-time';
import { loadViewerPlayer } from '$lib/server/viewer';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const viewerPlayerId = viewer?.playerId ?? null;
	const gate = friendlyScheduleGate(db, viewerPlayerId);
	const timezone = loadFriendlyTimezone(db);
	return {
		viewer: viewer ? { playerId: viewer.playerId, name: viewer.name } : null,
		canSchedule: gate.allowed,
		scheduleReason: gate.reason,
		opponents: gate.allowed ? loadFriendlyOpponents(db, viewerPlayerId) : [],
		timezone,
		minDate: localDateString(new Date(), timezone)
	};
};

export const actions: Actions = {
	schedule: async ({ locals, request }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		if (!viewer) {
			return fail(403, { message: 'Sign in as a registered league player to arrange friendlies.' });
		}
		const form = await request.formData();
		const opponentId = Number(form.get('opponentId'));
		if (!Number.isInteger(opponentId) || opponentId < 1) {
			return fail(400, { message: 'Choose who this friendly is with.' });
		}
		let friendlyId: number;
		try {
			const outcome = scheduleFriendly(
				db,
				{
					actorPlayerId: viewer.playerId,
					playerAId: viewer.playerId,
					playerBId: opponentId,
					date: String(form.get('date') ?? '').trim(),
					time: String(form.get('time') ?? '').trim() || null,
					note: String(form.get('note') ?? '').trim() || null
				},
				{ now: new Date() }
			);
			friendlyId = outcome.friendlyId;
		} catch (cause) {
			if (cause instanceof FriendlyPermissionError) {
				return fail(403, { message: cause.message });
			}
			if (cause instanceof FriendlyValidationError) {
				return fail(400, { message: cause.errors.join(' ') });
			}
			throw error(400, cause instanceof Error ? cause.message : 'Could not arrange the friendly.');
		}
		throw redirect(303, `/friendlies/${friendlyId}?status=scheduled`);
	}
};
