import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import {
	FriendlyPermissionError,
	FriendlyValidationError,
	cancelScheduledFriendly,
	friendlyPermissions,
	loadFriendlyDetail,
	loadFriendlyTimezone,
	rescheduleFriendly
} from '$lib/server/friendlies';
import { localDateString } from '$lib/server/league-time';
import { loadViewerPlayer } from '$lib/server/viewer';
import type { Actions, PageServerLoad } from './$types';

export type FriendlyStatusNote = 'scheduled' | 'rescheduled' | 'recorded' | 'corrected' | null;

function friendlyIdFromParam(value: string): number {
	const id = Number(value);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Friendly not found.');
	return id;
}

function statusNote(value: string | null): FriendlyStatusNote {
	return value === 'scheduled' ||
		value === 'rescheduled' ||
		value === 'recorded' ||
		value === 'corrected'
		? value
		: null;
}

export const load: PageServerLoad = ({ params, url, locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const friendlyId = friendlyIdFromParam(params.id);
	const detail = loadFriendlyDetail(db, friendlyId);
	if (!detail) {
		throw error(
			404,
			'This friendly no longer exists. Scheduled friendlies with no result are removed five days after the scheduled date.'
		);
	}
	const timezone = loadFriendlyTimezone(db);
	return {
		detail,
		permissions: friendlyPermissions(db, friendlyId, viewer?.playerId ?? null),
		viewer: viewer ? { playerId: viewer.playerId, name: viewer.name, role: viewer.role } : null,
		timezone,
		minDate: localDateString(new Date(), timezone),
		status: statusNote(url.searchParams.get('status'))
	};
};

export const actions: Actions = {
	reschedule: async ({ params, locals, request }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const friendlyId = friendlyIdFromParam(params.id);
		if (!viewer) {
			return fail(403, { message: 'Sign in as one of the two players to reschedule this friendly.' });
		}
		const form = await request.formData();
		try {
			rescheduleFriendly(
				db,
				{
					friendlyId,
					actorPlayerId: viewer.playerId,
					date: String(form.get('date') ?? '').trim(),
					time: String(form.get('time') ?? '').trim() || null,
					note: String(form.get('note') ?? '').trim() || null
				},
				{ now: new Date() }
			);
		} catch (cause) {
			if (cause instanceof FriendlyPermissionError) {
				return fail(403, { message: cause.message });
			}
			if (cause instanceof FriendlyValidationError) {
				return fail(400, { message: cause.errors.join(' ') });
			}
			return fail(400, {
				message: cause instanceof Error ? cause.message : 'Could not reschedule the friendly.'
			});
		}
		throw redirect(303, `/friendlies/${friendlyId}?status=rescheduled`);
	},

	cancel: async ({ params, locals }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const friendlyId = friendlyIdFromParam(params.id);
		if (!viewer) {
			return fail(403, { message: 'Sign in as one of the two players to withdraw this friendly.' });
		}
		try {
			cancelScheduledFriendly(db, { friendlyId, actorPlayerId: viewer.playerId }, { now: new Date() });
		} catch (cause) {
			if (cause instanceof FriendlyPermissionError) {
				return fail(403, { message: cause.message });
			}
			return fail(400, {
				message: cause instanceof Error ? cause.message : 'Could not withdraw the friendly.'
			});
		}
		throw redirect(303, '/friendlies?status=cancelled');
	}
};
