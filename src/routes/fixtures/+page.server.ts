import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { loadFixturesPageData, type FixturesTab } from '$lib/server/fixtures-page';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const tab: FixturesTab = url.searchParams.get('tab') === 'results' ? 'results' : 'fixtures';
	const roundParam = url.searchParams.get('round');
	const roundNumber = roundParam && /^\d{1,3}$/.test(roundParam) ? Number(roundParam) : null;

	return loadFixturesPageData(db, { viewer, tab, roundNumber });
};
