import { fail } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { loadFriendlyTimezone } from '$lib/server/friendlies';
import { localDateString } from '$lib/server/league-time';
import {
	ChatNotFoundError,
	ChatPermissionError,
	ChatRateLimitError,
	ChatValidationError,
	chatGate,
	deleteOwnMessage,
	loadChatBadge,
	loadDirectThreads,
	loadLeagueChannel,
	markChannelRead,
	postChannelMessage,
	reportMessage
} from '$lib/server/chat';
import type { Actions, PageServerLoad } from './$types';

/** A positive integer query parameter, or undefined. */
function numberParam(value: string | null): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export const load: PageServerLoad = ({ locals, url }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const timezone = loadFriendlyTimezone(db);
	const gate = chatGate(db, viewer);
	const todayKey = localDateString(new Date(), timezone);

	if (!viewer || !gate.allowed) {
		return {
			signedOut: true,
			gate,
			timezone,
			todayKey,
			viewer: null,
			channel: null,
			threads: [],
			badge: { league: 0, direct: 0, total: 0 }
		};
	}

	const before = numberParam(url.searchParams.get('before'));
	const channel = loadLeagueChannel(db, viewer, { beforeId: before });
	// Opening the channel is what "read" means (AC-F1); the badge then shows 0
	// for the channel until something new arrives.
	if (before === undefined && channel.latestId > 0) {
		markChannelRead(db, viewer.playerId, channel.channelId, channel.latestId);
	}
	const threads = loadDirectThreads(db, viewer);
	const badge = loadChatBadge(db, viewer);

	return {
		signedOut: false,
		gate,
		timezone,
		todayKey,
		viewer: { playerId: viewer.playerId, name: viewer.name, role: viewer.role },
		channel,
		threads: threads.threads,
		badge,
		before: before ?? null
	};
};

export const actions: Actions = {
	/** Post into the league channel. Everyone signed in may post (Q5e). */
	post: async ({ locals, request }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const form = await request.formData();
		try {
			postChannelMessage(db, {
				actorPlayerId: viewer?.playerId ?? 0,
				body: String(form.get('body') ?? '')
			});
		} catch (cause) {
			if (cause instanceof ChatPermissionError) return fail(403, { message: cause.message });
			if (cause instanceof ChatValidationError) return fail(400, { message: cause.errors.join(' ') });
			if (cause instanceof ChatRateLimitError) return fail(429, { message: cause.message });
			if (cause instanceof ChatNotFoundError) return fail(404, { message: cause.message });
			throw cause;
		}
		return { posted: true };
	},

	/** Delete your own message; leaves the placeholder in place (AC-D2). */
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

	/** Report a message for an admin to review (AC-C1). */
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
