import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { loadResultScreenData } from '$lib/server/result-page';
import { resultFormValuesFrom, type ResultFormValues } from '$lib/result-entry';
import {
	ResultNeedsConfirmationError,
	ResultPermissionError,
	ResultValidationError,
	correctResult,
	type ResultWriteOutcome
} from '$lib/server/results';
import type { Actions, PageServerLoad } from './$types';

function fixtureIdFromParam(value: string): number {
	const id = Number(value);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Fixture not found.');
	return id;
}

export const load: PageServerLoad = ({ params, locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const fixtureId = fixtureIdFromParam(params.fixtureId);
	const data = loadResultScreenData(db, { fixtureId, viewer });
	if (!data) throw error(404, 'Fixture not found.');
	return {
		...data,
		// A correction is an admin-only change of an approved result; everything
		// else belongs on the record or review screens.
		canCorrectHere: data.permissions.canCorrect && data.record?.status === 'confirmed',
		blockedReason: data.permissions.correctReason ?? data.permissions.submitReason
	};
};

export const actions: Actions = {
	correct: async ({ params, locals, request }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const fixtureId = fixtureIdFromParam(params.fixtureId);
		if (!viewer) {
			return fail(403, {
				errors: ['After approval only an admin can change a result.'],
				values: null
			});
		}
		const data = loadResultScreenData(db, { fixtureId, viewer });
		if (!data) throw error(404, 'Fixture not found.');

		const form = await request.formData();
		const values: ResultFormValues = resultFormValuesFrom(form, data.framesPerMatch);
		const reason = String(form.get('reason') ?? '').trim();
		let outcome: ResultWriteOutcome;
		try {
			outcome = correctResult(db, {
				fixtureId,
				actorPlayerId: viewer.playerId,
				values,
				reason,
				ackWarnings: form.get('ackWarnings') === '1'
			});
		} catch (cause) {
			if (cause instanceof ResultValidationError) {
				return fail(400, { errors: cause.errors, values, warnings: [] });
			}
			if (cause instanceof ResultNeedsConfirmationError) {
				return fail(400, { errors: [], values, warnings: cause.warnings, needsAck: true });
			}
			if (cause instanceof ResultPermissionError) {
				return fail(403, { errors: [cause.message], values });
			}
			return fail(400, {
				errors: [cause instanceof Error ? cause.message : 'Could not save the correction.'],
				values
			});
		}
		const awardNote = outcome.awardReviewNeeded ? '&awardReview=1' : '';
		throw redirect(303, `/fixtures/${fixtureId}?status=corrected${awardNote}`);
	}
};
