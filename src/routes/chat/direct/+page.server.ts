import { fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { loadFriendlyTimezone } from '$lib/server/friendlies';
import { localDateString } from '$lib/server/league-time';
import {
	ChatPermissionError,
	ChatRateLimitError,
	ChatValidationError,
	chatGate,
	loadChatCandidates,
	loadDirectThreads,
	openDirectThread
} from '$lib/server/chat';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const timezone = loadFriendlyTimezone(db);
	const gate = chatGate(db, viewer);
	if (!viewer || !gate.allowed) {
		return {
			signedOut: true,
			gate,
			timezone,
			todayKey: localDateString(new Date(), timezone),
			viewer: null,
			threads: [],
			candidates: []
		};
	}
	const threads = loadDirectThreads(db, viewer);
	return {
		signedOut: false,
		gate,
		timezone,
		todayKey: localDateString(new Date(), timezone),
		viewer: { playerId: viewer.playerId, name: viewer.name, role: viewer.role },
		threads: threads.threads,
		candidates: loadChatCandidates(db, viewer.playerId)
	};
};

export const actions: Actions = {
	/** Open the existing thread with a member, or create the one thread for the pair. */
	start: async ({ locals, request }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const form = await request.formData();
		let threadId: number;
		try {
			const outcome = openDirectThread(db, {
				actorPlayerId: viewer?.playerId ?? 0,
				otherPlayerId: Number(form.get('playerId'))
			});
			threadId = outcome.threadId;
		} catch (cause) {
			if (cause instanceof ChatPermissionError) return fail(403, { message: cause.message });
			if (cause instanceof ChatValidationError) return fail(400, { message: cause.errors.join(' ') });
			if (cause instanceof ChatRateLimitError) return fail(429, { message: cause.message });
			throw cause;
		}
		// Redirect *after* the try, never inside it (SANDBOX §3): a thrown
		// redirect inside a try/catch is swallowed by the catch.
		throw redirect(303, `/chat/direct/${threadId}`);
	}
};
