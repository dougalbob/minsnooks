import { getDb } from '$lib/server/db';
import { loadChatBadge } from '$lib/server/chat';
import { unreadCount } from '$lib/server/notifications';
import { loadViewerPlayer } from '$lib/server/viewer';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	const db = getDb();
	const season = db.prepare('SELECT label FROM seasons ORDER BY id DESC LIMIT 1').get() as
		| { label: string }
		| undefined;
	const viewer = loadViewerPlayer(db, locals.viewerEmail);

	// The dev preview identity switch only exists when dev identity is allowed
	// (AUTH_MODE=dev, never production); Phase 8 replaces it with the real
	// Access/role pipeline.
	const identityOptions = locals.devIdentitySwitch
		? (
				db
					.prepare(
						`SELECT email, display_name AS name, initials, role
						 FROM players WHERE is_active = 1
						 ORDER BY display_name COLLATE NOCASE`
					)
					.all() as Array<{ email: string; name: string; initials: string; role: string }>
			).map((player) => ({
				...player,
				label:
					player.role === 'player'
						? player.name
						: `${player.name} · ${player.role === 'super_admin' ? 'super-admin' : 'admin'}`
			}))
		: [];

	return {
		seasonLabel: season?.label ?? null,
		// Unread chat (Phase 13). Zeros for a visitor, so the nav badge never leaks.
		chatBadge: loadChatBadge(db, viewer),
        notificationCount: unreadCount(db, viewer),
		/** The request's effective viewer email (a preview identity, when one is set). */
		viewerEmail: locals.viewerEmail,
		viewer: viewer
			? {
					playerId: viewer.playerId,
					name: viewer.name,
					initials: viewer.initials,
					tone: viewer.tone,
					role: viewer.role
				}
			: null,
		viewerIsPreview: locals.viewerIsPreview,
		devIdentitySwitch: locals.devIdentitySwitch,
		identityOptions
	};
};
