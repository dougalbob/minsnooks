/**
 * The quiet polling endpoint behind an open chat view (Phase 13 §4 H).
 *
 * It returns the same message views the page renders, so the client never
 * formats raw database rows. Authorization is the same as the page: a visitor
 * gets nothing, a non-participant gets the not-found answer for a DM thread.
 */
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { loadDirectThread, loadLeagueChannel } from '$lib/server/chat';
import type { RequestHandler } from './$types';

function positiveInt(value: string | null): number {
	if (!value) return 0;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export const GET: RequestHandler = ({ locals, url }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	if (!viewer) {
		return json({ message: 'Sign in as a registered league player to use chat.' }, { status: 401 });
	}

	const after = positiveInt(url.searchParams.get('after'));
	const scope = url.searchParams.get('scope');

	if (scope === 'thread') {
		const thread = loadDirectThread(db, viewer, positiveInt(url.searchParams.get('threadId')), {
			afterId: after
		});
		if (!thread) {
			return json({ message: 'That conversation could not be found.' }, { status: 404 });
		}
		return json({ messages: thread.messages, latestId: thread.latestId });
	}

	const channel = loadLeagueChannel(db, viewer, { afterId: after });
	return json({ messages: channel.messages, latestId: channel.latestId });
};
