import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import {
	FriendlyNeedsConfirmationError,
	FriendlyPermissionError,
	FriendlyValidationError,
	correctFriendlyResult,
	friendlyPermissions,
	loadFriendlyDetail,
	loadFriendlyTimezone
} from '$lib/server/friendlies';
import type { FriendlyFormValues } from '$lib/friendly-entry';
import { friendlyFormValuesFrom } from '$lib/friendly-entry';
import { localDateString } from '$lib/server/league-time';
import { loadViewerPlayer } from '$lib/server/viewer';
import type { Actions, PageServerLoad } from './$types';

function friendlyIdFromParam(value: string): number {
	const id = Number(value);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Friendly not found.');
	return id;
}

function draftFromDetail(detail: NonNullable<ReturnType<typeof loadFriendlyDetail>>): FriendlyFormValues {
	const breakLow = detail.breaks.find((entry) => entry.playerId === detail.low.playerId);
	const breakHigh = detail.breaks.find((entry) => entry.playerId === detail.high.playerId);
	return {
		actualPlayedDate: detail.actualPlayedDate ?? '',
		lowFrames: detail.lowFrames === null ? '' : String(detail.lowFrames),
		highFrames: detail.highFrames === null ? '' : String(detail.highFrames),
		framePoints: detail.frames.map((frame) => ({
			low: String(frame.lowPoints),
			high: String(frame.highPoints)
		})),
		breaks: {
			low: breakLow ? String(breakLow.breakPoints) : '',
			high: breakHigh ? String(breakHigh.breakPoints) : ''
		}
	};
}

export const load: PageServerLoad = ({ params, locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const friendlyId = friendlyIdFromParam(params.id);
	const detail = loadFriendlyDetail(db, friendlyId);
	if (!detail) throw error(404, 'Friendly not found.');
	if (!detail.hasResult) throw redirect(303, `/friendlies/record?friendly=${friendlyId}`);
	const permissions = friendlyPermissions(db, friendlyId, viewer?.playerId ?? null);
	const timezone = loadFriendlyTimezone(db);
	return {
		detail,
		permissions,
		viewer: viewer ? { playerId: viewer.playerId, name: viewer.name, role: viewer.role } : null,
		today: localDateString(new Date(), timezone),
		draft: draftFromDetail(detail),
		reasonRequired: permissions.adminOverride,
		blockedReason: permissions.canCorrect
			? null
			: (permissions.correctReason ?? 'You cannot correct this friendly.')
	};
};

export const actions: Actions = {
	correct: async ({ params, locals, request }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const friendlyId = friendlyIdFromParam(params.id);
		if (!viewer) {
			return fail(403, {
				errors: ['Sign in to correct a friendly result.'],
				values: null
			});
		}
		const form = await request.formData();
		const values = friendlyFormValuesFrom(form);
		try {
			correctFriendlyResult(
				db,
				{
					friendlyId,
					actorPlayerId: viewer.playerId,
					values,
					ackWarnings: form.get('ackWarnings') === '1',
					reason: String(form.get('reason') ?? '').trim() || null
				},
				{ now: new Date() }
			);
		} catch (cause) {
			if (cause instanceof FriendlyValidationError) {
				return fail(400, { errors: cause.errors, values, warnings: [] });
			}
			if (cause instanceof FriendlyNeedsConfirmationError) {
				return fail(400, { errors: [], values, warnings: cause.warnings, needsAck: true });
			}
			if (cause instanceof FriendlyPermissionError) {
				return fail(403, { errors: [cause.message], values });
			}
			return fail(400, {
				errors: [cause instanceof Error ? cause.message : 'Could not save the correction.'],
				values
			});
		}
		throw redirect(303, `/friendlies/${friendlyId}?status=corrected`);
	}
};
