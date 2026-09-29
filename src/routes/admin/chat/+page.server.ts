import { fail } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { isAdminOrSuperAdmin } from '$lib/server/permissions';
import { loadFriendlyTimezone } from '$lib/server/friendlies';
import {
	ChatNotFoundError,
	ChatPermissionError,
	ChatValidationError,
	loadReportQueue,
	reviewReport
} from '$lib/server/chat';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const isAdmin = isAdminOrSuperAdmin(viewer);
	const queue = loadReportQueue(db, viewer);
	return {
		timezone: loadFriendlyTimezone(db),
		viewer: viewer ? { playerId: viewer.playerId, name: viewer.name, role: viewer.role } : null,
		isAdmin,
		isSuperAdmin: viewer?.role === 'super_admin',
		open: queue.open,
		resolved: queue.resolved
	};
};

export const actions: Actions = {
	/** Hide or keep a reported message — a mandatory note, always audited. */
	review: async ({ locals, request }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const form = await request.formData();
		const decision = String(form.get('decision') ?? '');
		if (decision !== 'hide' && decision !== 'keep') {
			return fail(400, { message: 'Choose whether to hide or keep the message.' });
		}
		try {
			const outcome = reviewReport(db, {
				actorPlayerId: viewer?.playerId ?? 0,
				reportId: Number(form.get('reportId')),
				decision,
				note: String(form.get('note') ?? '')
			});
			return { reviewed: true, resolution: outcome.resolution };
		} catch (cause) {
			if (cause instanceof ChatPermissionError) return fail(403, { message: cause.message });
			if (cause instanceof ChatValidationError) return fail(400, { message: cause.errors.join(' ') });
			if (cause instanceof ChatNotFoundError) return fail(404, { message: cause.message });
			throw cause;
		}
	}
};
