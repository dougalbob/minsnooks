import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { loadFixtureDetailData } from '$lib/server/fixtures-page';
import { BookingPermissionError, cancelBooking } from '$lib/server/bookings';
import type { Actions, PageServerLoad } from './$types';

const FLASH_MESSAGES: Record<string, string> = {
	proposed: 'Planned date saved. The other player can see it, and either of you can change or cancel it.',
	changed: 'Planned date updated. The earlier plan is kept in the history below.',
	cancelled: 'Planned date cancelled. The fixture is back to “no date arranged” — the history is kept.'
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
	const detail = loadFixtureDetailData(db, { fixtureId, viewer });
	if (!detail) throw error(404, 'Fixture not found.');

	const status = url.searchParams.get('status') ?? '';
	return {
		...detail,
		flash: FLASH_MESSAGES[status] ?? null,
		afterWindow: url.searchParams.get('afterWindow') === '1'
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
