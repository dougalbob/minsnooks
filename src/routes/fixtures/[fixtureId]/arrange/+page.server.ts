import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { loadArrangeScreenData } from '$lib/server/fixtures-page';
import { BookingPermissionError, proposeBooking } from '$lib/server/bookings';
import { localDateString } from '$lib/server/league-time';
import type { Actions, PageServerLoad } from './$types';

function fixtureIdFromParam(value: string): number {
	const id = Number(value);
	if (!Number.isInteger(id) || id < 1) throw error(404, 'Fixture not found.');
	return id;
}

function seasonTimezoneFor(db: ReturnType<typeof getDb>, roundId: number): string {
	const row = db
		.prepare('SELECT s.timezone FROM rounds ro JOIN seasons s ON s.id = ro.season_id WHERE ro.id = ?')
		.get(roundId) as { timezone: string } | undefined;
	return row?.timezone ?? 'Europe/London';
}

export const load: PageServerLoad = ({ params, locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const fixtureId = fixtureIdFromParam(params.fixtureId);
	const data = loadArrangeScreenData(db, { fixtureId, viewer });
	if (!data) throw error(404, 'Fixture not found.');

	const timeZone = seasonTimezoneFor(db, data.fixture.roundId);
	const canArrange =
		data.fixture.canManage && data.fixture.state === 'unplayed' && data.fixture.roundStatus === 'open';

	return {
		...data,
		timeZone,
		minDate: localDateString(new Date(), timeZone),
		canArrange,
		arrangeBlockedReason: canArrange
			? null
			: !data.fixture.canManage
				? data.fixture.manageReason
				: data.fixture.state !== 'unplayed'
					? 'This fixture is already resolved, so its planned date cannot be changed.'
					: `Round ${data.fixture.roundNumber} is closed, so its fixtures no longer take planned dates.`
	};
};

export const actions: Actions = {
	propose: async ({ params, locals, request }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const fixtureId = fixtureIdFromParam(params.fixtureId);
		if (!viewer) {
			return fail(403, { message: 'Sign in as one of the two players to arrange this date.' });
		}
		const form = await request.formData();
		const date = String(form.get('date') ?? '').trim();
		const time = String(form.get('time') ?? '').trim();
		const note = String(form.get('note') ?? '').trim();

		let result: { replaced: boolean; afterWindow: boolean };
		try {
			result = proposeBooking(db, {
				fixtureId,
				actorPlayerId: viewer.playerId,
				date,
				time: time || null,
				note: note || null
			});
		} catch (cause) {
			return fail(cause instanceof BookingPermissionError ? 403 : 400, {
				message: cause instanceof Error ? cause.message : 'Could not save the planned date.'
			});
		}

		const status = result.replaced ? 'changed' : 'proposed';
		const afterWindow = result.afterWindow ? '&afterWindow=1' : '';
		throw redirect(303, `/fixtures/${fixtureId}?status=${status}${afterWindow}`);
	}
};
