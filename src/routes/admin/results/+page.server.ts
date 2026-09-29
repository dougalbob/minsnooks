import { getDb } from '$lib/server/db';
import { loadSeason } from '$lib/server/standings';
import { loadAwaitingReview, loadResultActivity } from '$lib/server/results';
import { loadViewerPlayer } from '$lib/server/viewer';
import { isAdminOrSuperAdmin, isSuperAdmin } from '$lib/server/permissions';
import type { PageServerLoad } from './$types';

interface SeasonIdRow {
	id: number;
	label: string;
}

/**
 * Result queue (Phase 6): every league result that is not yet confirmed — so
 * not yet in the table — plus the recent history of results that have moved.
 *
 * The queue is per-viewer, exactly like the fixtures a player sees: a
 * participant only sees the submissions waiting on *them*; an admin sees all of
 * them, because admin is a view of the data and not a participant in the match.
 */
export const load: PageServerLoad = ({ locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const seasonRow = db
		.prepare('SELECT id, label FROM seasons ORDER BY id DESC LIMIT 1')
		.get() as SeasonIdRow | undefined;
	const season = seasonRow ? loadSeason(db, seasonRow.id) : null;

	const isAdmin = isAdminOrSuperAdmin(viewer);
	const waiting = loadAwaitingReview(db, { viewerPlayerId: viewer?.playerId ?? null });

	return {
		seasonLabel: season?.label ?? seasonRow?.label ?? 'Season',
		timeZone: season?.timezone ?? 'UTC',
		viewer: viewer ? { playerId: viewer.playerId, name: viewer.name, role: viewer.role } : null,
		isAdmin,
		isSuperAdmin: isSuperAdmin(viewer),
		// An admin watches the whole league; a participant only ever sees the
		// submissions that are waiting on them.
		queue: isAdmin ? waiting : waiting.filter((item) => item.needsMyReview),
		activity: isAdmin ? loadResultActivity(db, 40) : []
	};
};
