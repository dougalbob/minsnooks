import type { Db } from './db';
import { openRound, recordAudit } from './league';
import { closeFixtureNeutrally } from './league';
import { deadlineAfterLocalDays, gracePeriodEndsAt } from './league-time';

export type LifecycleTrigger = 'timer' | 'admin';

export interface LifecycleEvent {
	kind: string;
	message: string;
	seasonId: number;
	roundId?: number;
	fixtureId?: number;
}

export interface LifecycleRun {
	runId: number;
	trigger: LifecycleTrigger;
	evaluatedAt: string;
	events: LifecycleEvent[];
}

export interface LifecycleDefaults {
	roundDurationDays: number;
	graceDays: number;
}

function numericSetting(db: Db, key: string, fallback: number, minimum: number): number {
	const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
		| { value: string }
		| undefined;
	const value = Number(row?.value);
	return Number.isInteger(value) && value >= minimum ? value : fallback;
}

export function loadLifecycleDefaults(db: Db): LifecycleDefaults {
	return {
		roundDurationDays: numericSetting(db, 'round_duration_days', 28, 1),
		graceDays: numericSetting(db, 'round_grace_days', 7, 0)
	};
}

function addEvent(db: Db, events: LifecycleEvent[], event: LifecycleEvent): void {
	events.push(event);
	recordAudit(db, {
		entityType: 'round_lifecycle',
		entityId: event.roundId ?? event.seasonId,
		action: event.kind,
		detail: event
	});
}

/**
 * Server-side, idempotent deadline/round worker. A read-only page load never
 * advances league state; this is called by the process timer or an explicit
 * admin action. An optional clock makes fictional preview runs reproducible.
 */
export function runRoundLifecycle(
	db: Db,
	options: { now?: Date; trigger?: LifecycleTrigger } = {}
): LifecycleRun {
	const now = options.now ?? new Date();
	if (!Number.isFinite(now.getTime())) throw new Error('Scheduler time is invalid.');
	const trigger = options.trigger ?? 'admin';
	const evaluatedAt = now.toISOString();

	return db.transaction(() => {
		const run = db
			.prepare('INSERT INTO lifecycle_runs (trigger, evaluated_at, completed_at) VALUES (?, ?, ?)')
			.run(trigger, evaluatedAt, evaluatedAt);
		const runId = Number(run.lastInsertRowid);
		const events: LifecycleEvent[] = [];
		const openRounds = db
			.prepare(
				`SELECT ro.id, ro.season_id, ro.number, ro.is_final, ro.deadline_at, ro.grace_days,
						s.timezone
				 FROM rounds ro JOIN seasons s ON s.id = ro.season_id
				 WHERE ro.status = 'open'
				 ORDER BY ro.number`
			)
			.all() as Array<{
				id: number;
				season_id: number;
				number: number;
				is_final: number;
				deadline_at: string | null;
				grace_days: number;
				timezone: string;
			}>;

		for (const round of openRounds) {
			const cutoff = round.deadline_at
				? gracePeriodEndsAt(round.deadline_at, round.grace_days, round.timezone)
				: null;
			if (cutoff && now.getTime() > cutoff.getTime()) {
				const unplayed = db
					.prepare("SELECT id FROM fixtures WHERE round_id = ? AND state = 'unplayed' ORDER BY id")
					.all(round.id) as Array<{ id: number }>;
				for (const fixture of unplayed) {
					closeFixtureNeutrally(db, fixture.id, now);
					addEvent(db, events, {
						kind: 'fixture_closed_neutrally',
						message: `Fixture ${fixture.id} closed neutrally after its deadline and grace period.`,
						seasonId: round.season_id,
						roundId: round.id,
						fixtureId: fixture.id
					});
				}
			}

			const unresolved = db
				.prepare(
					`SELECT COUNT(*) AS count FROM fixtures
					 WHERE round_id = ? AND state NOT IN ('confirmed', 'awarded', 'closed_unplayed')`
				)
				.get(round.id) as { count: number };
			if (unresolved.count > 0) continue;

			const changed = db
				.prepare("UPDATE rounds SET status = 'closed', closed_at = ? WHERE id = ? AND status = 'open'")
				.run(evaluatedAt, round.id).changes;
			if (changed === 0) continue;
			addEvent(db, events, {
				kind: 'round_closed',
				message: `Round ${round.number} is fully resolved and has been closed.`,
				seasonId: round.season_id,
				roundId: round.id
			});

			if (round.is_final === 1) {
				addEvent(db, events, {
					kind: 'final_round_resolved',
					message: `Final Round ${round.number} is resolved; a new season requires an admin.`,
					seasonId: round.season_id,
					roundId: round.id
				});
				continue;
			}

			const nextNumber = round.number + 1;
			const existingNext = db
				.prepare('SELECT id FROM rounds WHERE season_id = ? AND number = ?')
				.get(round.season_id, nextNumber) as { id: number } | undefined;
			if (existingNext) {
				addEvent(db, events, {
					kind: 'next_round_exists',
					message: `Round ${nextNumber} already exists; no duplicate round was opened.`,
					seasonId: round.season_id,
					roundId: existingNext.id
				});
				continue;
			}

			const roster = db
				.prepare(
					`SELECT p.id FROM players p
					 WHERE p.is_active = 1
					   AND NOT EXISTS (
						 SELECT 1 FROM player_withdrawals pw
						 WHERE pw.player_id = p.id
					   )
					   AND NOT EXISTS (
						 SELECT 1 FROM round_players rp
						 WHERE rp.round_id = @roundId AND rp.player_id = p.id AND rp.withdrawn = 1
					   )
					 ORDER BY p.id`
				)
				.all({ roundId: round.id }) as Array<{ id: number }>;
			if (roster.length < 2) {
				addEvent(db, events, {
					kind: 'auto_advance_blocked',
					message: `Round ${nextNumber} was not opened because fewer than two active players remain.`,
					seasonId: round.season_id,
					roundId: round.id
				});
				continue;
			}

			const season = db
				.prepare('SELECT timezone FROM seasons WHERE id = ?')
				.get(round.season_id) as { timezone: string };
			const defaults = loadLifecycleDefaults(db);
			const nextRoundId = openRound(db, {
				seasonId: round.season_id,
				number: nextNumber,
				playerIds: roster.map((player) => player.id),
				deadlineAt: deadlineAfterLocalDays(now, defaults.roundDurationDays, season.timezone),
				graceDays: defaults.graceDays,
				openedAt: evaluatedAt
			});
			addEvent(db, events, {
				kind: 'round_auto_opened',
				message: `Round ${nextNumber} opened automatically with ${roster.length} active players.`,
				seasonId: round.season_id,
				roundId: nextRoundId
			});
		}

		db.prepare('UPDATE lifecycle_runs SET events_json = ? WHERE id = ?').run(
			JSON.stringify(events),
			runId
		);
		return { runId, trigger, evaluatedAt, events };
	})();
}

export function setRoundFinal(db: Db, roundId: number, isFinal: boolean, actorPlayerId: number | null): void {
	const round = db.prepare('SELECT season_id, number, status, is_final FROM rounds WHERE id = ?').get(roundId) as
		| { season_id: number; number: number; status: string; is_final: number }
		| undefined;
	if (!round) throw new Error(`Round ${roundId} does not exist.`);
	if (round.status !== 'open') throw new Error('Only the active scheduling round can be marked final.');
	if ((round.is_final === 1) === isFinal) return;
	db.prepare('UPDATE rounds SET is_final = ? WHERE id = ? AND status = \'open\'').run(isFinal ? 1 : 0, roundId);
	recordAudit(db, {
		entityType: 'round',
		entityId: roundId,
		action: isFinal ? 'marked_final' : 'unmarked_final',
		actorPlayerId,
		detail: { seasonId: round.season_id, number: round.number }
	});
}

export function withdrawPlayerFromFutureRounds(
	db: Db,
	input: { seasonId: number; playerId: number; actorPlayerId: number | null; reason: string }
): { effectiveFromRound: number; alreadyWithdrawn: boolean } {
	const existing = db
		.prepare('SELECT effective_from_round FROM player_withdrawals WHERE player_id = ?')
		.get(input.playerId) as { effective_from_round: number } | undefined;
	if (existing) return { effectiveFromRound: existing.effective_from_round, alreadyWithdrawn: true };

	return db.transaction(() => {
		const activeRound = db
			.prepare("SELECT id, number FROM rounds WHERE season_id = ? AND status = 'open'")
			.get(input.seasonId) as { id: number; number: number } | undefined;
		const last = db
			.prepare('SELECT MAX(number) AS number FROM rounds WHERE season_id = ?')
			.get(input.seasonId) as { number: number | null };
		const effectiveFromRound = activeRound ? activeRound.number + 1 : (last.number ?? 0) + 1;
		const player = db.prepare('SELECT id FROM players WHERE id = ? AND is_active = 1').get(input.playerId);
		if (!player) throw new Error('Choose an active league player.');
		if (activeRound) {
			db.prepare('UPDATE round_players SET withdrawn = 1 WHERE round_id = ? AND player_id = ?').run(
				activeRound.id,
				input.playerId
			);
		}
		db.prepare(
			`INSERT INTO player_withdrawals (
				player_id, effective_from_season_id, effective_from_round, actor_player_id, reason
			) VALUES (?, ?, ?, ?, ?)`
		).run(input.playerId, input.seasonId, effectiveFromRound, input.actorPlayerId, input.reason.trim());
		recordAudit(db, {
			entityType: 'player',
			entityId: input.playerId,
			action: 'withdrawn_from_future_rounds',
			actorPlayerId: input.actorPlayerId,
			reason: input.reason.trim(),
			detail: { seasonId: input.seasonId, effectiveFromRound }
		});
		return { effectiveFromRound, alreadyWithdrawn: false };
	})();
}
