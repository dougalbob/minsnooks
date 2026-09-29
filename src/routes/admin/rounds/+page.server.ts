import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { createSeason, openRound, recordAudit } from '$lib/server/league';
import {
	loadLifecycleDefaults,
	runRoundLifecycle,
	setRoundFinal
} from '$lib/server/lifecycle';
import { loadViewerPlayer } from '$lib/server/viewer';
import {
	canCreateSeason,
	canManageRounds,
	canWithdrawPlayer,
	isAdminOrSuperAdmin,
	isSuperAdmin
} from '$lib/server/permissions';
import { withdrawPlayerAndResolveFixtures } from '$lib/server/withdrawals-awards';
import {
	deadlineAfterLocalDays,
	deadlineAtForLocalDate,
	localDateString,
	localDateTimeInputValue,
	parseLocalDateTimeInput
} from '$lib/server/league-time';
import { loadSeason } from '$lib/server/standings';
import { loadAdminSettings } from '$lib/server/admin-settings';

interface SeasonIdRow {
	id: number;
	label: string;
}

function currentSeason(db: ReturnType<typeof getDb>) {
	const season = db.prepare('SELECT id, label FROM seasons ORDER BY id DESC LIMIT 1').get() as
		| SeasonIdRow
		| undefined;
	if (!season) return null;
	return loadSeason(db, season.id);
}

function parseWholeNumber(value: FormDataEntryValue | null, label: string, minimum: number): number {
	const raw = String(value ?? '');
	if (!/^\d+$/.test(raw)) throw new Error(`${label} must be a whole number.`);
	const parsed = Number(raw);
	if (!Number.isSafeInteger(parsed) || parsed < minimum) {
		throw new Error(`${label} must be at least ${minimum}.`);
	}
	return parsed;
}

function getOpenRound(db: ReturnType<typeof getDb>) {
	return db.prepare("SELECT id, season_id, number, status FROM rounds WHERE status = 'open'").get() as
		| { id: number; season_id: number; number: number; status: 'open' }
		| undefined;
}

export const load: PageServerLoad = ({ locals }) => {
	const db = getDb();
	const viewer = loadViewerPlayer(db, locals.viewerEmail);
	const season = currentSeason(db);
	const defaults = loadLifecycleDefaults(db);
	const settings = loadAdminSettings(db);
	const now = new Date();
	const allPlayers = db
		.prepare(
			'SELECT id, display_name AS name, initials, avatar_tone AS tone, is_active FROM players ORDER BY display_name COLLATE NOCASE'
		)
		.all() as Array<{ id: number; name: string; initials: string; tone: string; is_active: number }>;
	const eligiblePlayers = allPlayers.filter(
		(player) =>
			player.is_active === 1 &&
			!db.prepare('SELECT 1 FROM player_withdrawals WHERE player_id = ?').get(player.id)
	);
	const activeRound = getOpenRound(db);
	const withdrawals = db
		.prepare(
			`SELECT pw.effective_from_round, pw.reason, p.display_name AS player_name,
					s.label AS season_label
			 FROM player_withdrawals pw
			 JOIN players p ON p.id = pw.player_id
			 JOIN seasons s ON s.id = pw.effective_from_season_id
		 ORDER BY pw.created_at DESC, p.display_name COLLATE NOCASE`
		)
		.all() as Array<{
			effective_from_round: number;
			reason: string | null;
			player_name: string;
			season_label: string;
		}>;
	const runRows = db
		.prepare(
			'SELECT id, trigger, evaluated_at, completed_at, events_json FROM lifecycle_runs ORDER BY id DESC LIMIT 12'
		)
		.all() as Array<{
			id: number;
			trigger: 'timer' | 'admin';
			evaluated_at: string;
			completed_at: string;
			events_json: string;
		}>;
	const runs = runRows.map((run) => {
		let events: Array<{ kind: string; message: string }> = [];
		try {
			events = JSON.parse(run.events_json) as Array<{ kind: string; message: string }>;
		} catch {
			/* Keep a malformed historic event record from breaking the admin view. */
		}
		return { ...run, events };
	});
	const lastRound = season?.rounds.at(-1) ?? null;
	const nextNumber = (lastRound?.number ?? 0) + 1;
	const timezone = season?.timezone ?? settings.timezone;

	const manageCheck = canManageRounds(viewer);
	const seasonCheck = canCreateSeason(viewer);

	return {
		season,
		activeRound,
		lastRound,
		allPlayers: allPlayers.map(({ is_active: _active, ...player }) => player),
		eligiblePlayers,
		withdrawals,
		runs,
		defaults,
		timezone,
		newSeasonTimezone: settings.timezone,
		nowLocal: localDateTimeInputValue(now, timezone),
		defaultDeadlineDate: localDateString(
			new Date(deadlineAfterLocalDays(now, defaults.roundDurationDays, timezone)),
			timezone
		),
		nextNumber,
		viewer: viewer ? { playerId: viewer.playerId, name: viewer.name, role: viewer.role } : null,
		isAdmin: isAdminOrSuperAdmin(viewer),
		isSuperAdmin: isSuperAdmin(viewer),
		canManage: manageCheck.allowed,
		manageReason: manageCheck.reason,
		canCreateSeason: seasonCheck.allowed,
		createSeasonReason: seasonCheck.reason
	};
};

export const actions: Actions = {
	runScheduler: async ({ request, locals }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const check = canManageRounds(viewer);
		if (!check.allowed) {
			return fail(403, { message: check.reason ?? 'Administrator privileges required.' });
		}
		const form = await request.formData();
		const value = String(form.get('effectiveAt') ?? '').trim();
		let now = new Date();
		if (value) {
			const timezone = currentSeason(db)?.timezone ?? 'Europe/London';
			const parsed = parseLocalDateTimeInput(value, timezone);
			if (!parsed) return fail(400, { message: `Enter a valid local date and time in ${timezone}.` });
			now = parsed;
		}
		const run = runRoundLifecycle(db, { now, trigger: 'admin' });
		const message = run.events.length
			? `Scheduler processed ${run.events.length} lifecycle event${run.events.length === 1 ? '' : 's'}.`
			: 'Scheduler checked the league; no deadline or round transition was due.';
		return { message };
	},

	markFinal: async ({ request, locals }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const check = canManageRounds(viewer);
		if (!check.allowed) {
			return fail(403, { message: check.reason ?? 'Administrator privileges required.' });
		}
		const form = await request.formData();
		try {
			const roundId = parseWholeNumber(form.get('roundId'), 'Round', 1);
			const isFinal = form.get('isFinal') === 'true';
			setRoundFinal(db, roundId, isFinal, viewer!.playerId);
			return { message: isFinal ? 'This round is marked as the season final.' : 'Final-round marking removed.' };
		} catch (cause) {
			return fail(400, { message: cause instanceof Error ? cause.message : 'Could not update the final-round setting.' });
		}
	},

	openRound: async ({ request, locals }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const check = canManageRounds(viewer);
		if (!check.allowed) {
			return fail(403, { message: check.reason ?? 'Administrator privileges required.' });
		}
		const form = await request.formData();
		try {
			const season = currentSeason(db);
			if (!season) throw new Error('Seed a fictional season before opening a round.');
			if (getOpenRound(db)) throw new Error('A league round is already open for scheduling.');
			const lastRound = season.rounds.at(-1);
			if (lastRound?.isFinal) throw new Error('This season has ended. An admin must create the next season.');
			if (lastRound && lastRound.status !== 'closed') throw new Error('Resolve and close the previous round before opening another.');
			const deadlineDate = String(form.get('deadlineDate') ?? '');
			const graceDays = parseWholeNumber(form.get('graceDays'), 'Grace days', 0);
			if (graceDays > 90) throw new Error('Grace days cannot exceed 90.');
			const selectedIds = [...new Set(form.getAll('playerIds').map((value) => Number(value)))];
			if (selectedIds.length < 2 || selectedIds.some((id) => !Number.isInteger(id))) {
				throw new Error('Choose at least two active players for the round.');
			}
			const allowed = new Set(
				(db
					.prepare(
						`SELECT p.id FROM players p WHERE p.is_active = 1
						 AND NOT EXISTS (SELECT 1 FROM player_withdrawals pw WHERE pw.player_id = p.id)`
					)
					.all() as Array<{ id: number }>).map((player) => player.id)
			);
			if (selectedIds.some((id) => !allowed.has(id))) throw new Error('A withdrawn or inactive player cannot join a new round.');
			const roundId = openRound(db, {
				seasonId: season.seasonId,
				number: season.rounds.length ? season.rounds[season.rounds.length - 1].number + 1 : 1,
				playerIds: selectedIds,
				deadlineAt: deadlineAtForLocalDate(deadlineDate, season.timezone),
				graceDays,
				isFinal: form.get('isFinal') === 'true'
			});
			recordAudit(db, {
				entityType: 'round',
				entityId: roundId,
				action: 'admin_opened',
				actorPlayerId: viewer!.playerId,
				detail: { deadlineDate, graceDays, playerIds: selectedIds }
			});
			return { message: `Round ${lastRound ? lastRound.number + 1 : 1} opened with a saved roster and deadline snapshot.` };
		} catch (cause) {
			return fail(400, { message: cause instanceof Error ? cause.message : 'Could not open the round.' });
		}
	},

	withdrawPlayer: async ({ request, locals }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const check = canWithdrawPlayer(viewer);
		if (!check.allowed) {
			return fail(403, { message: check.reason ?? 'Administrator privileges required.' });
		}
		const form = await request.formData();
		try {
			const season = currentSeason(db);
			if (!season) throw new Error('There is no active season.');
			const playerId = parseWholeNumber(form.get('playerId'), 'Player', 1);
			const reason = String(form.get('reason') ?? '').trim();
			const result = withdrawPlayerAndResolveFixtures(db, {
				seasonId: season.seasonId,
				playerId,
				actorPlayerId: viewer!.playerId,
				reason
			});
			return {
				message: result.alreadyWithdrawn
					? 'This player was already withdrawn from future rounds.'
					: `Player withdrawn from Round ${result.effectiveFromRound} onward. ${result.awards.length} outstanding fixture${result.awards.length === 1 ? ' was' : 's were'} resolved by an audited table-points award.`,
				reveals: result.awards
			};
		} catch (cause) {
			return fail(400, { message: cause instanceof Error ? cause.message : 'Could not withdraw the player.' });
		}
	},

	createSeason: async ({ request, locals }) => {
		const db = getDb();
		const viewer = loadViewerPlayer(db, locals.viewerEmail);
		const check = canCreateSeason(viewer);
		if (!check.allowed) {
			return fail(403, { message: check.reason ?? 'Super-admin privileges required.' });
		}
		const form = await request.formData();
		try {
			if (getOpenRound(db)) throw new Error('Resolve and close the active round before starting a season.');
			const prior = currentSeason(db);
			if (prior) {
				const finalRound = prior.rounds.at(-1);
				if (!finalRound || finalRound.status !== 'closed' || !finalRound.isFinal) {
					throw new Error('An admin can start a new season only after closing a round marked as final.');
				}
			}
			const label = String(form.get('label') ?? '').trim();
			if (!label || label.length > 32) throw new Error('Enter a season label up to 32 characters.');
			if (db.prepare('SELECT 1 FROM seasons WHERE label = ?').get(label)) throw new Error('That season label already exists.');
			const timezone = String(form.get('timezone') ?? loadAdminSettings(db).timezone);
			new Intl.DateTimeFormat('en-GB', { timeZone: timezone });
			const seasonId = createSeason(db, {
				label,
				framesPerMatch: parseWholeNumber(form.get('framesPerMatch'), 'Frames per match', 1),
				pointsPerFrame: parseWholeNumber(form.get('pointsPerFrame'), 'Points per frame', 0),
				matchWinBonus: parseWholeNumber(form.get('matchWinBonus'), 'Match-win bonus', 0),
				timezone
			});
			recordAudit(db, {
				entityType: 'season',
				entityId: seasonId,
				action: 'admin_created',
				actorPlayerId: viewer!.playerId,
				detail: { label, timezone }
			});
			return { message: `Season ${label} created. An admin must open its first round.` };
		} catch (cause) {
			return fail(400, { message: cause instanceof Error ? cause.message : 'Could not create the season.' });
		}
	}
};
