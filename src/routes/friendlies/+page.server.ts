import { getDb } from '$lib/server/db';
import { friendlyScheduleGate, loadFriendlyList } from '$lib/server/friendlies';
import { loadViewerPlayer } from '$lib/server/viewer';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const viewerPlayerId = viewer?.playerId ?? null;
	const status = url.searchParams.get('status');

	return {
		viewer: viewer
			? { playerId: viewer.playerId, name: viewer.name, role: viewer.role }
			: null,
		...loadFriendlyList(db, { viewerPlayerId }),
		canSchedule: friendlyScheduleGate(db, viewerPlayerId).allowed,
		status: status === 'cancelled' ? ('cancelled' as const) : null
	};
};
