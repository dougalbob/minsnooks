import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { loadAwardLedger } from '$lib/server/withdrawals-awards';
import { canViewAdminDashboard, isSuperAdmin } from '$lib/server/permissions';
import { loadViewerPlayer } from '$lib/server/viewer';

export const load: PageServerLoad = ({ locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	if (!canViewAdminDashboard(viewer).allowed) throw error(403, 'Administrator privileges are required to view league reports.');

	const unresolvedFixtures = db.prepare(`
		SELECT f.id AS fixtureId, ro.number AS roundNumber, s.label AS seasonLabel,
			p1.display_name AS lowName, p2.display_name AS highName, f.state,
			f.booked_date AS bookedDate, ro.deadline_at AS deadlineAt
		FROM fixtures f JOIN rounds ro ON ro.id = f.round_id JOIN seasons s ON s.id = ro.season_id
		JOIN players p1 ON p1.id = f.player_low_id JOIN players p2 ON p2.id = f.player_high_id
		WHERE f.state IN ('unplayed', 'awaiting_confirmation')
		ORDER BY CASE f.state WHEN 'awaiting_confirmation' THEN 0 ELSE 1 END,
			ro.deadline_at, s.id DESC, ro.number, f.id
		LIMIT 250`).all() as Array<{
		fixtureId: number; roundNumber: number; seasonLabel: string; lowName: string; highName: string;
		state: 'unplayed' | 'awaiting_confirmation'; bookedDate: string | null; deadlineAt: string | null;
	}>;

	const auditRows = db.prepare(`
		SELECT a.id, a.entity_type AS entityType, a.entity_id AS entityId, a.action,
			a.reason, a.detail, a.created_at AS createdAt, p.display_name AS actorName
		FROM audit_log a LEFT JOIN players p ON p.id = a.actor_player_id
		ORDER BY a.id DESC LIMIT 100`).all() as Array<{
		id: number; entityType: string; entityId: number; action: string; reason: string | null;
		detail: string | null; createdAt: string; actorName: string | null;
	}>;
	const auditTrail = auditRows.map(({ detail, ...row }) => {
		let summary: string | null = null;
		if (detail) {
			try {
				const parsed = JSON.parse(detail) as unknown;
				summary = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
			} catch {
				summary = '[Stored detail is not valid JSON]';
			}
		}
		return { ...row, detail: summary };
	});
	const seasons = db.prepare('SELECT id, label FROM seasons ORDER BY id DESC').all() as Array<{ id: number; label: string }>;
	const currentSeasonId = seasons[0]?.id ?? null;

	return {
		viewer: { name: viewer!.name, role: viewer!.role },
		isSuperAdmin: isSuperAdmin(viewer),
		unresolvedFixtures,
		awaitingConfirmations: unresolvedFixtures.filter((fixture) => fixture.state === 'awaiting_confirmation'),
		openFixtures: unresolvedFixtures.filter((fixture) => fixture.state === 'unplayed'),
		awardLedger: loadAwardLedger(db, currentSeasonId),
		auditTrail,
		seasons
	};
};
