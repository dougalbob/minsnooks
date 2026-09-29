import { error, fail } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { loadFriendlyTimezone } from '$lib/server/friendlies';
import { localDateString } from '$lib/server/league-time';
import {
	ChatNotFoundError,
	ChatPermissionError,
	ChatRateLimitError,
	ChatValidationError,
	deleteOwnMessage,
	loadChatBadge,
	loadDirectThread,
	markThreadRead,
	postDirectMessage,
	reportMessage
} from '$lib/server/chat';
import type { Actions, PageServerLoad } from './$types';

function numberParam(value: string | null): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export const load: PageServerLoad = ({ locals, params, url }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const timezone = loadFriendlyTimezone(db);
	const threadId = Number(params.threadId);
	const before = numberParam(url.searchParams.get('before'));

	if (!viewer) {
		return {
			signedOut: true,
			gate: { allowed: false, reason: 'Sign in as a registered league player to use chat.' },
			timezone,
			todayKey: localDateString(new Date(), timezone),
			viewer: null,
			thread: null,
			badge: { league: 0, direct: 0, total: 0 }
		};
	}

	// A non-participant — admin included — gets exactly the same answer as a
	// nonexistent thread, so chat cannot leak who is talking to whom (AC-B2).
	const thread = loadDirectThread(db, viewer, threadId, { beforeId: before });
	if (!thread) throw error(404, 'That conversation could not be found.');

	if (before === undefined && thread.latestId > 0) {
		markThreadRead(db, viewer.playerId, thread.threadId, thread.latestId);
	}

	return {
		signedOut: false,
		gate: { allowed: true, reason: null },
		timezone,
		todayKey: localDateString(new Date(), timezone),
		viewer: { playerId: viewer.playerId, name: viewer.name, role: viewer.role },
		thread,
		badge: loadChatBadge(db, viewer),
		before: before ?? null
	};
};

export const actions: Actions = {
	post: async ({ locals, request, params }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const form = await request.formData();
		try {
			postDirectMessage(db, {
				actorPlayerId: viewer?.playerId ?? 0,
				threadId: Number(params.threadId),
				body: String(form.get('body') ?? '')
			});
		} catch (cause) {
			if (cause instanceof ChatNotFoundError) return fail(404, { message: cause.message });
			if (cause instanceof ChatPermissionError) return fail(403, { message: cause.message });
			if (cause instanceof ChatValidationError) return fail(400, { message: cause.errors.join(' ') });
			if (cause instanceof ChatRateLimitError) return fail(429, { message: cause.message });
			throw cause;
		}
		return { posted: true };
	},

	delete: async ({ locals, request }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const form = await request.formData();
		try {
			deleteOwnMessage(db, {
				actorPlayerId: viewer?.playerId ?? 0,
				messageId: Number(form.get('messageId'))
			});
		} catch (cause) {
			if (cause instanceof ChatNotFoundError) return fail(404, { message: cause.message });
			if (cause instanceof ChatPermissionError) return fail(403, { message: cause.message });
			if (cause instanceof ChatValidationError) return fail(400, { message: cause.errors.join(' ') });
			throw cause;
		}
		return { deleted: true };
	},

	report: async ({ locals, request }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const form = await request.formData();
		try {
			const outcome = reportMessage(db, {
				actorPlayerId: viewer?.playerId ?? 0,
				messageId: Number(form.get('messageId')),
				reason: String(form.get('reason') ?? '')
			});
			return { reported: true, duplicate: outcome.duplicate };
		} catch (cause) {
			if (cause instanceof ChatNotFoundError) return fail(404, { message: cause.message });
			if (cause instanceof ChatPermissionError) return fail(403, { message: cause.message });
			if (cause instanceof ChatValidationError) return fail(400, { message: cause.errors.join(' ') });
			if (cause instanceof ChatRateLimitError) return fail(429, { message: cause.message });
			throw cause;
		}
	}
};
