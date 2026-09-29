import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { canViewAdminDashboard, isSuperAdmin } from '$lib/server/permissions';
import { loadViewerPlayer } from '$lib/server/viewer';
import { loadAdminSettings } from '$lib/server/admin-settings';

export const load: PageServerLoad = ({ locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	if (!canViewAdminDashboard(viewer).allowed) throw error(403, 'Administrator privileges are required to view the admin dashboard.');
	const counts = db.prepare(`SELECT
		SUM(CASE WHEN state = 'unplayed' THEN 1 ELSE 0 END) AS unplayed,
		SUM(CASE WHEN state = 'awaiting_confirmation' THEN 1 ELSE 0 END) AS awaiting_confirmation
		FROM fixtures`).get() as { unplayed: number | null; awaiting_confirmation: number | null };
	const pendingAwards = db.prepare(`SELECT COUNT(*) AS n FROM audit_log flag
		WHERE flag.action = 'award_review_needed' AND NOT EXISTS (
		 SELECT 1 FROM audit_log reviewed WHERE reviewed.action = 'award_reviewed'
		 AND json_extract(reviewed.detail, '$.awardId') = json_extract(flag.detail, '$.awardId')
		 AND reviewed.id > flag.id)`).get() as { n: number };
	return {
		viewer: { name: viewer!.name, role: viewer!.role },
		isSuperAdmin: isSuperAdmin(viewer),
		unplayed: counts.unplayed ?? 0,
		awaitingConfirmation: counts.awaiting_confirmation ?? 0,
		pendingAwardReviews: pendingAwards.n,
		settings: loadAdminSettings(db)
	};
};
