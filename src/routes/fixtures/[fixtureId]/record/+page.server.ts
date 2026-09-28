import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { loadFixtureDetailData } from '$lib/server/fixtures-page';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const fixtureId = Number(params.fixtureId);
	if (!Number.isInteger(fixtureId) || fixtureId < 1) throw error(404, 'Fixture not found.');
	const detail = loadFixtureDetailData(db, { fixtureId, viewer });
	if (!detail) throw error(404, 'Fixture not found.');
	return detail;
};
