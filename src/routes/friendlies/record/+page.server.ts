import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import {
	FriendlyNeedsConfirmationError,
	FriendlyPermissionError,
	FriendlyValidationError,
	friendlyPermissions,
	friendlyScheduleGate,
	loadFriendlyDetail,
	loadFriendlyOpponents,
	loadFriendlyTimezone,
	recordFriendlyResult
} from '$lib/server/friendlies';
import type { FriendlyParty } from '$lib/server/friendlies';
import { friendlyFormValuesFrom as readFriendlyForm } from '$lib/friendly-entry';
import { orderedPair } from '$lib/server/league';
import { localDateString } from '$lib/server/league-time';
import { loadViewerPlayer } from '$lib/server/viewer';
import type { Actions, PageServerLoad } from './$types';

export type RecordMode = 'scheduled' | 'direct' | 'choose' | 'blocked';

function numberParam(value: string | null): number | null {
	if (!value || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return parsed >= 1 ? parsed : null;
}

export const load: PageServerLoad = ({ url, locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const viewerPlayerId = viewer?.playerId ?? null;
	const gate = friendlyScheduleGate(db, viewerPlayerId);
	const timezone = loadFriendlyTimezone(db);
	const today = localDateString(new Date(), timezone);
	const opponents = gate.allowed ? loadFriendlyOpponents(db, viewerPlayerId) : [];

	const friendlyId = numberParam(url.searchParams.get('friendly'));
	if (friendlyId !== null) {
		const detail = loadFriendlyDetail(db, friendlyId);
		if (!detail) throw error(404, 'Friendly not found.');
		if (detail.hasResult) {
			return {
				mode: 'blocked' as const,
				viewer: viewer ? { playerId: viewer.playerId, name: viewer.name } : null,
				opponents,
				timezone,
				today,
				friendlyId,
				low: detail.low,
				high: detail.high,
				blockedReason: 'This friendly already has a saved result — correct it instead.',
				scheduledDateNote: null as string | null
			};
		}
		const permissions = viewerPlayerId === null ? null : friendlyPermissions(db, friendlyId, viewerPlayerId);
		if (permissions && !permissions.canRecord) {
			return {
				mode: 'blocked' as const,
				viewer: viewer ? { playerId: viewer.playerId, name: viewer.name } : null,
				opponents,
				timezone,
				today,
				friendlyId,
				low: detail.low,
				high: detail.high,
				blockedReason: permissions.recordReason ?? 'You cannot record this friendly.',
				scheduledDateNote: null as string | null
			};
		}
		return {
			mode: 'scheduled' as const,
			viewer: viewer ? { playerId: viewer.playerId, name: viewer.name } : null,
			opponents,
			timezone,
			today,
			friendlyId,
			low: detail.low,
			high: detail.high,
			blockedReason: null as string | null,
			scheduledDateNote: detail.scheduledDate
				? `Planned date on file: ${detail.scheduledDate}${detail.scheduledTime ? ` at ${detail.scheduledTime}` : ''} — a plan is not proof of play, so enter the day you actually played.`
				: null
		};
	}

	const opponentId = numberParam(url.searchParams.get('opponent'));
	const opponent = opponents.find((entry) => entry.playerId === opponentId) ?? null;
	if (!gate.allowed || !viewer || !opponent) {
		return {
			mode: 'choose' as const,
			viewer: viewer ? { playerId: viewer.playerId, name: viewer.name } : null,
			opponents,
			timezone,
			today,
			friendlyId: null as number | null,
			low: null as FriendlyParty | null,
			high: null as FriendlyParty | null,
			blockedReason: !gate.allowed ? gate.reason : null,
			scheduledDateNote: null as string | null
		};
	}
	const [lowId, highId] = orderedPair(viewer.playerId, opponent.playerId);
	const byId = new Map<number, FriendlyParty>([
		[viewer.playerId, { playerId: viewer.playerId, name: viewer.name, initials: viewer.initials, tone: viewer.tone }],
		[opponent.playerId, opponent]
	]);
	return {
		mode: 'direct' as const,
		viewer: { playerId: viewer.playerId, name: viewer.name },
		opponents,
		timezone,
		today,
		friendlyId: null as number | null,
		low: byId.get(lowId)!,
		high: byId.get(highId)!,
		blockedReason: null as string | null,
		scheduledDateNote: null as string | null
	};
};

export const actions: Actions = {
	record: async ({ locals, request }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		if (!viewer) {
			return fail(403, {
				errors: ['Sign in as one of the two players to record a friendly result.'],
				values: null
			});
		}
		const form = await request.formData();
		const friendlyId = numberParam(String(form.get('friendlyId') ?? ''));
		const opponentId = numberParam(String(form.get('opponentId') ?? ''));
		const values = readFriendlyForm(form);
		let recordedId: number;
		try {
			const outcome = recordFriendlyResult(
				db,
				{
					actorPlayerId: viewer.playerId,
					...(friendlyId !== null
						? { friendlyId }
						: opponentId !== null
							? { playerAId: viewer.playerId, playerBId: opponentId }
							: {}),
					values,
					ackWarnings: form.get('ackWarnings') === '1'
				},
				{ now: new Date() }
			);
			recordedId = outcome.friendlyId;
		} catch (cause) {
			if (cause instanceof FriendlyValidationError) {
				return fail(400, { errors: cause.errors, values, warnings: [] });
			}
			if (cause instanceof FriendlyNeedsConfirmationError) {
				return fail(400, { errors: [], values, warnings: cause.warnings, needsAck: true });
			}
			if (cause instanceof FriendlyPermissionError) {
				return fail(403, { errors: [cause.message], values });
			}
			return fail(400, {
				errors: [cause instanceof Error ? cause.message : 'Could not save the friendly.'],
				values
			});
		}
		throw redirect(303, `/friendlies/${recordedId}?status=recorded`);
	}
};
