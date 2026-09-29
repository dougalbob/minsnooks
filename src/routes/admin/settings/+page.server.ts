import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { loadAdminSettings, saveAdminSettings, validateAdminSettings } from '$lib/server/admin-settings';
import { canManageRounds, isSuperAdmin } from '$lib/server/permissions';
import { loadViewerPlayer } from '$lib/server/viewer';

function wholeNumber(value: FormDataEntryValue | null, label: string): number {
	const text = String(value ?? '').trim();
	if (!/^\d+$/.test(text)) throw new Error(`${label} must be a whole number.`);
	const number = Number(text);
	if (!Number.isSafeInteger(number)) throw new Error(`${label} must be a whole number.`);
	return number;
}

export const load: PageServerLoad = ({ locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const access = canManageRounds(viewer);
	if (!access.allowed) throw error(403, 'Administrator privileges are required to view league settings.');
	return {
		settings: loadAdminSettings(db),
		viewer: viewer ? { name: viewer.name, role: viewer.role } : null,
		isSuperAdmin: isSuperAdmin(viewer)
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const access = canManageRounds(viewer);
		if (!access.allowed) return fail(403, { message: access.reason ?? 'Administrator privileges required.', error: true });
		try {
			const form = await request.formData();
			const settings = validateAdminSettings({
				roundDurationDays: wholeNumber(form.get('roundDurationDays'), 'Round duration'),
				graceDays: wholeNumber(form.get('graceDays'), 'Grace period'),
				timezone: String(form.get('timezone') ?? ''),
				contactVisibilityDefault: form.get('contactVisibilityDefault') === 'visible'
			});
			saveAdminSettings(db, settings, viewer!.playerId);
			return { message: 'Settings saved. Existing seasons, rounds and player privacy choices are unchanged.' };
		} catch (cause) {
			return fail(400, { message: cause instanceof Error ? cause.message : 'Could not save settings.', error: true });
		}
	}
};
