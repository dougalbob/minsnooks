import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { KnockoutPermissionError, KnockoutValidationError } from '$lib/server/knockout';
import {
	correctKnockoutResult,
	loadKnockoutTieForRecord,
	recordKnockoutResult
} from '$lib/server/knockout-progression';
import { knockoutFormValuesFrom } from '$lib/knockout-progression';

function numberParam(value: string | null): number | null {
	if (!value || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return parsed >= 1 ? parsed : null;
}

export const load: PageServerLoad = ({ params, locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const tieId = numberParam(params.tieId);
	if (tieId === null) throw error(404, 'Knockout tie not found.');
	let page;
	try {
		page = loadKnockoutTieForRecord(db, tieId, viewer?.playerId ?? null);
	} catch {
		throw error(404, 'Knockout tie not found.');
	}

	const values = page.existing
		? {
				actualPlayedDate: page.existing.actualPlayedDate,
				frameWinners: Array.from({ length: page.maxFrames }, (_, index) => {
					const frame = page.existing!.frames.find((entry) => entry.frameNumber === index + 1);
					return frame ? frame.winner : '';
				})
			}
		: { actualPlayedDate: '', frameWinners: Array.from({ length: page.maxFrames }, () => '') };

	return { ...page, viewerName: viewer?.name ?? null, values };
};

export const actions: Actions = {
	default: async ({ params, request, locals }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const tieId = numberParam(params.tieId);
		if (tieId === null) return fail(404, { errors: ['Knockout tie not found.'], values: null });
		const form = await request.formData();
		const competitionId = numberParam(String(form.get('competitionId') ?? ''));
		const values = knockoutFormValuesFrom(form, 2 * 4 - 1);

		if (!viewer) {
			return fail(403, {
				errors: ['Sign in as one of the two players (or an admin) to save this result.'],
				values
			});
		}

		// 'low'/'high' rows are resolved against the tie's own player ids, so a
		// forged form can never point a frame winner at someone else.
		let outcome;
		try {
			const page = loadKnockoutTieForRecord(db, tieId, viewer.playerId);
			if (!page.canAct) {
				return fail(400, { errors: [page.blockReason ?? 'This result cannot be changed here.'], values });
			}
			const frames = values.frameWinners
				.map((row, index) => ({ row, frameNumber: index + 1 }))
				.filter((entry) => entry.row === 'low' || entry.row === 'high')
				.map((entry) => ({
					frameNumber: entry.frameNumber,
					winnerPlayerId:
						entry.row === 'low' ? page.tie.playerLow.playerId : page.tie.playerHigh.playerId
				}));
			const input = {
				tieId,
				actorPlayerId: viewer.playerId,
				frames,
				actualPlayedDate: values.actualPlayedDate
			};
			outcome = page.correcting
				? correctKnockoutResult(db, { ...input, reason: String(form.get('reason') ?? '') })
				: recordKnockoutResult(db, input);
		} catch (cause) {
			if (cause instanceof KnockoutValidationError) {
				return fail(400, { errors: cause.errors, values });
			}
			if (cause instanceof KnockoutPermissionError) {
				return fail(403, { errors: [cause.message], values });
			}
			return fail(400, {
				errors: [cause instanceof Error ? cause.message : 'The result could not be saved.'],
				values
			});
		}

		const anchor = competitionId ?? outcome.tieId;
		// Redirect after the try/catch: a thrown redirect must not be swallowed.
		throw redirect(303, `/knockout?saved=${outcome.tieId}#competition-${anchor}`);
	}
};
