import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { recordAudit } from '$lib/server/league';

export const load: PageServerLoad = ({ locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	if (!viewer) {
		return {
			viewer: null,
			profile: null
		};
	}

	const row = db
		.prepare(
			`SELECT id, display_name, initials, avatar_tone, email, role, phone, contact_visible, created_at
			 FROM players WHERE id = ?`
		)
		.get(viewer.playerId) as {
		id: number;
		display_name: string;
		initials: string;
		avatar_tone: string;
		email: string;
		role: string;
		phone: string | null;
		contact_visible: number;
		created_at: string;
	};

	return {
		viewer: {
			playerId: viewer.playerId,
			name: viewer.name,
			role: viewer.role
		},
		profile: {
			id: row.id,
			name: row.display_name,
			initials: row.initials,
			tone: row.avatar_tone,
			email: row.email,
			role: row.role,
			phone: row.phone,
			contactVisible: row.contact_visible === 1,
			createdAt: row.created_at
		}
	};
};

export const actions: Actions = {
	updateProfile: async ({ request, locals }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		if (!viewer) {
			return fail(403, { message: 'Sign in to update your profile settings.' });
		}

		const form = await request.formData();
		const contactVisibleVal = form.get('contactVisible') === '0' ? 0 : 1;
		const rawPhone = String(form.get('phone') ?? '').trim();
		const phoneVal = rawPhone ? rawPhone.slice(0, 32) : null;

		db.prepare(
			'UPDATE players SET contact_visible = ?, phone = ? WHERE id = ?'
		).run(contactVisibleVal, phoneVal, viewer.playerId);

		recordAudit(db, {
			entityType: 'player',
			entityId: viewer.playerId,
			action: 'profile_updated',
			actorPlayerId: viewer.playerId,
			detail: {
				contact_visible: contactVisibleVal,
				has_phone: Boolean(phoneVal)
			}
		});

		return {
			success: true,
			message: 'Your profile settings have been saved.'
		};
	}
};
