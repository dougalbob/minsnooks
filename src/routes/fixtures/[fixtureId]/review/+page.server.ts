import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { loadResultScreenData } from '$lib/server/result-page';
import {
	ResultPermissionError,
	ResultValidationError,
	reviewResult,
	type ResultWriteOutcome
} from '$lib/server/results';
import type { Actions, PageServerLoad } from './$types';

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
	return {
		...data,
		flash:
			status === 'sentback'
				? 'Sent back for correction. The submitter can fix the scoreline or the actual date and resubmit; the table is untouched.'
				: null
	};
};

export const actions: Actions = {
	confirm: async ({ params, locals }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const fixtureId = fixtureIdFromParam(params.fixtureId);
		if (!viewer) {
			return fail(403, { message: 'Sign in as the other player to review this result.' });
		}
		let outcome: ResultWriteOutcome;
		try {
			outcome = reviewResult(db, {
				fixtureId,
				actorPlayerId: viewer.playerId,
				decision: 'confirm'
			});
		} catch (cause) {
			return fail(cause instanceof ResultPermissionError ? 403 : 400, {
				message: cause instanceof Error ? cause.message : 'Could not confirm the result.'
			});
		}
		throw redirect(303, `/fixtures/${fixtureId}?status=confirmed&revision=${outcome.revision}`);
	},

	sendBack: async ({ params, locals, request }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const fixtureId = fixtureIdFromParam(params.fixtureId);
		if (!viewer) {
			return fail(403, { message: 'Sign in as the other player to review this result.' });
		}
		const form = await request.formData();
		const reason = String(form.get('reason') ?? '').trim();
		try {
			reviewResult(db, {
				fixtureId,
				actorPlayerId: viewer.playerId,
				decision: 'send_back',
				reason
			});
		} catch (cause) {
			if (cause instanceof ResultValidationError) {
				return fail(400, { message: cause.errors.join(' '), reason });
			}
			return fail(cause instanceof ResultPermissionError ? 403 : 400, {
				message: cause instanceof Error ? cause.message : 'Could not send the result back.',
				reason
			});
		}
		throw redirect(303, `/fixtures/${fixtureId}?status=sentback`);
	}
};
