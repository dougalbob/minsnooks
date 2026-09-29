import { getDb } from '$lib/server/db';
import { loadStatsPageData } from '$lib/server/stats-page';
import { loadViewerPlayer } from '$lib/server/viewer';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	return loadStatsPageData(db, viewer?.playerId ?? null);
};
