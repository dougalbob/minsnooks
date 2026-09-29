import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { loadViewerPlayer } from '$lib/server/viewer';
import { canReviewAward, canWithdrawPlayer, isAdminOrSuperAdmin, isSuperAdmin } from '$lib/server/permissions';
import {
	loadAwardLedger,
	loadAwardReviewQueue,
	loadWithdrawalAwardPreview,
	reviewCorrectedAward,
	withdrawPlayerAndResolveFixtures
} from '$lib/server/withdrawals-awards';

function wholeNumber(value: FormDataEntryValue | null, label: string): number {
	const raw = String(value ?? '');
	if (!/^\d+$/.test(raw)) throw new Error(`${label} must be a whole number.`);
	const number = Number(raw);
	if (!Number.isSafeInteger(number) || number < 1) throw new Error(`Choose a valid ${label.toLowerCase()}.`);
	return number;
}

export const load: PageServerLoad = ({ locals, url }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const season = db.prepare('SELECT id, label FROM seasons ORDER BY id DESC LIMIT 1').get() as
		| { id: number; label: string }
		| undefined;
	const eligiblePlayers = db
		.prepare(
			`SELECT p.id, p.display_name AS name
			 FROM players p
			 WHERE p.is_active = 1
			   AND NOT EXISTS (SELECT 1 FROM player_withdrawals pw WHERE pw.player_id = p.id)
			 ORDER BY p.display_name COLLATE NOCASE`
		)
		.all() as Array<{ id: number; name: string }>;
	const requestedPlayerId = Number(url.searchParams.get('playerId'));
	const activeRound = season
		? (db.prepare("SELECT id, number FROM rounds WHERE season_id = ? AND status = 'open'").get(season.id) as
				| { id: number; number: number }
				| undefined) ?? null
		: null;
	const playersWithOutstanding = activeRound
		? new Set(
				(
					db
						.prepare(
							`SELECT DISTINCT player_low_id AS id FROM fixtures WHERE round_id = ? AND state = 'unplayed'
							 UNION
							 SELECT DISTINCT player_high_id AS id FROM fixtures WHERE round_id = ? AND state = 'unplayed'`
						)
						.all(activeRound.id, activeRound.id) as Array<{ id: number }>
				).map((row) => row.id)
			)
		: new Set<number>();
	const selectedPlayer =
		eligiblePlayers.find((player) => player.id === requestedPlayerId) ??
		eligiblePlayers.find((player) => playersWithOutstanding.has(player.id)) ??
		eligiblePlayers[0] ??
		null;
	const withdrawals = db
		.prepare(
			`SELECT p.display_name AS player_name, pw.effective_from_round, pw.reason, s.label AS season_label
			 FROM player_withdrawals pw
			 JOIN players p ON p.id = pw.player_id
			 JOIN seasons s ON s.id = pw.effective_from_season_id
			 ORDER BY pw.created_at DESC, p.display_name COLLATE NOCASE`
		)
		.all() as Array<{ player_name: string; effective_from_round: number; reason: string | null; season_label: string }>;

	const canWithdraw = canWithdrawPlayer(viewer);
	const canReview = canReviewAward(viewer);

	return {
		season: season ?? null,
		activeRound,
		viewer: viewer ? { playerId: viewer.playerId, name: viewer.name, role: viewer.role } : null,
		isAdmin: isAdminOrSuperAdmin(viewer),
		isSuperAdmin: isSuperAdmin(viewer),
		canWithdraw: canWithdraw.allowed,
		withdrawReason: canWithdraw.reason,
		canReview: canReview.allowed,
		reviewReason: canReview.reason,
		eligiblePlayers,
		selectedPlayer,
		withdrawalPreview:
			season && selectedPlayer
				? loadWithdrawalAwardPreview(db, { seasonId: season.id, playerId: selectedPlayer.id })
				: [],
		withdrawals,
		awardReviewQueue: loadAwardReviewQueue(db),
		awardLedger: loadAwardLedger(db, season?.id ?? null)
	};
};

export const actions: Actions = {
	withdrawPlayer: async ({ request, locals }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const check = canWithdrawPlayer(viewer);
		if (!check.allowed) {
			return fail(403, { message: check.reason ?? 'Administrator privileges required.' });
		}
		const form = await request.formData();
		try {
			const season = db.prepare('SELECT id FROM seasons ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
			if (!season) throw new Error('There is no active season.');
			const result = withdrawPlayerAndResolveFixtures(db, {
				seasonId: season.id,
				playerId: wholeNumber(form.get('playerId'), 'Player'),
				actorPlayerId: viewer!.playerId,
				reason: String(form.get('reason') ?? '')
			});
			return {
				message: result.alreadyWithdrawn
					? 'This player was already withdrawn from future rounds.'
					: `${result.awards.length} outstanding fixture${result.awards.length === 1 ? ' was' : 's were'} resolved. Earned points were preserved and future rounds will exclude this player.`,
				reveals: result.awards
			};
		} catch (cause) {
			return fail(400, { message: cause instanceof Error ? cause.message : 'Could not withdraw the player.' });
		}
	},

	reviewAward: async ({ request, locals }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const check = canReviewAward(viewer);
		if (!check.allowed) {
			return fail(403, { message: check.reason ?? 'Administrator privileges required.' });
		}
		const form = await request.formData();
		try {
			const decision = String(form.get('decision') ?? '');
			if (decision !== 'keep' && decision !== 'apply_source') throw new Error('Choose a valid award-review decision.');
			const outcome = reviewCorrectedAward(db, {
				awardId: wholeNumber(form.get('awardId'), 'Award'),
				actorPlayerId: viewer!.playerId,
				decision,
				reason: String(form.get('reason') ?? '')
			});
			return {
				message:
					decision === 'apply_source'
						? `Award updated to match the corrected source result (${outcome.after} table points).`
						: `Award kept at its existing value (${outcome.after} table points) with your reason recorded in the ledger.`
			};
		} catch (cause) {
			return fail(400, { message: cause instanceof Error ? cause.message : 'Could not review the award.' });
		}
	}
};
