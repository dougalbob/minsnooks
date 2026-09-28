import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { loadResultScreenData } from '$lib/server/result-page';
import { BookingPermissionError, cancelBooking } from '$lib/server/bookings';
import type { Actions, PageServerLoad } from './$types';

/**
 * What a `?status=` flash means, and whether it is a success worth celebrating
 * (the prototype's "Nicely done." card) rather than a plain notice.
 */
const FLASH_MESSAGES: Record<string, { message: string; success: boolean }> = {
	proposed: {
		message:
			'Planned date saved. The other player can see it, and either of you can change or cancel it.',
		success: false
	},
	changed: {
		message: 'Planned date updated. The earlier plan is kept in the history below.',
		success: false
	},
	cancelled: {
		message:
			'Planned date cancelled. The fixture is back to “no date arranged” — the history is kept.',
		success: false
	},
	submitted: {
		message:
			'Result submitted. It stays out of the league table until your opponent confirms the scoreline and the actual date played.',
		success: true
	},
	resubmitted: {
		message:
			'Corrected result resubmitted. It goes back to your opponent for confirmation, and the table is untouched until then.',
		success: true
	},
	direct: {
		message:
			'Result entered directly by a super-admin and confirmed immediately. The audit trail records the reason, since no opponent confirmed it.',
		success: true
	},
	retrospective: {
		message:
			'Retrospective result recorded for a closed fixture and confirmed. The original round table now includes it; scheduling was not reopened.',
		success: true
	},
	confirmed: {
		message:
			'Result and actual date confirmed. This match now counts in the round and season tables.',
		success: true
	},
	sentback: {
		message:
			'Sent back for correction. The submitter can fix the scoreline or the actual date and resubmit; nothing changed in the table.',
		success: false
	},
	corrected: {
		message:
			'Correction saved. The league table has been recalculated from the corrected result, and the change is in the audit trail with your reason.',
		success: true
	}
};

function fixtureIdFromParam(value: string): number {
	const id = Number(value);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Fixture not found.');
	return id;
}

export const load: PageServerLoad = ({ params, locals, url }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const fixtureId = fixtureIdFromParam(params.fixtureId);
	const data = loadResultScreenData(db, { fixtureId, viewer });
	if (!data) throw error(404, 'Fixture not found.');

	const status = url.searchParams.get('status') ?? '';
	const flash = FLASH_MESSAGES[status] ?? null;
	return {
		...data,
		flash: flash?.message ?? null,
		flashSuccess: flash?.success ?? false,
		afterWindow: url.searchParams.get('afterWindow') === '1',
		awardReview: url.searchParams.get('awardReview') === '1'
	};
};

export const actions: Actions = {
	cancelProposal: async ({ params, locals, request }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const fixtureId = fixtureIdFromParam(params.fixtureId);
		if (!viewer) {
			return fail(403, { message: 'Sign in as one of the two players to change this planned date.' });
		}
		const form = await request.formData();
		const reason = String(form.get('reason') ?? '');
		let cancelled = false;
		try {
			({ cancelled } = cancelBooking(db, { fixtureId, actorPlayerId: viewer.playerId, reason }));
		} catch (cause) {
			return fail(cause instanceof BookingPermissionError ? 403 : 400, {
				message: cause instanceof Error ? cause.message : 'Could not cancel the planned date.'
			});
		}
		if (!cancelled) return fail(400, { message: 'There is no planned date to cancel.' });
		throw redirect(303, `/fixtures/${fixtureId}?status=cancelled`);
	}
};
