/**
 * Phase 7: withdrawals, table-points-only awards, random fallback draws and
 * source-correction review. All randomness and award writes are server-side.
 */
import { randomInt } from 'node:crypto';
import type { Db } from './db';
import { createAward, previousRoundPointsAgainst, recordAudit } from './league';
import { resultPermissions, loadPlayerRole } from './results';
import type { PlayerRole } from './results';

export interface WithdrawalAwardPreview {
	fixtureId: number;
	opponentId: number;
	opponentName: string;
	sourceResultId: number | null;
	sourceRound: number | null;
	tablePoints: number | null;	// null means the one-time random fallback will be drawn on submit
}

export interface AwardReveal extends WithdrawalAwardPreview {
	awardId: number;
	tablePoints: number;
	sourceType: 'previous_round_result' | 'random_draw';
	drawValue: number | null;
}

export class AwardPermissionError extends Error {}

function adminForContext(db: Db, actorPlayerId: number | null, fixtureId: number | null): boolean {
	if (actorPlayerId === null) return false;
	if (fixtureId !== null) {
		return resultPermissions(db, fixtureId, actorPlayerId).isAdmin;
	}
	// A league with no fixtures has no result permission context yet. Use the
	// same role resolver that powers resultPermissions rather than guessing from
	// identity or email.
	const role: PlayerRole | null = loadPlayerRole(db, actorPlayerId);
	return role === 'admin' || role === 'super_admin';
}

function assertAdmin(db: Db, actorPlayerId: number | null, fixtureId: number | null): void {
	if (!adminForContext(db, actorPlayerId, fixtureId)) {
		throw new AwardPermissionError('Only an active admin or super-admin can manage withdrawals and awards.');
	}
}

function latestFixtureId(db: Db): number | null {
	const row = db.prepare('SELECT id FROM fixtures ORDER BY id DESC LIMIT 1').get() as
		| { id: number }
		| undefined;
	return row?.id ?? null;
}

/** Preview which current-round fixtures would be resolved for this withdrawal. */
export function loadWithdrawalAwardPreview(
	db: Db,
	options: { seasonId: number; playerId: number }
): WithdrawalAwardPreview[] {
	const activeRound = db
		.prepare("SELECT id, number FROM rounds WHERE season_id = ? AND status = 'open'")
		.get(options.seasonId) as { id: number; number: number } | undefined;
	if (!activeRound) return [];
	const fixtures = db
		.prepare(
			`SELECT f.id AS fixture_id,
				CASE WHEN f.player_low_id = @playerId THEN f.player_high_id ELSE f.player_low_id END AS opponent_id,
				p.display_name AS opponent_name
			 FROM fixtures f
			 JOIN players p ON p.id = CASE WHEN f.player_low_id = @playerId THEN f.player_high_id ELSE f.player_low_id END
			 WHERE f.round_id = @roundId AND f.state = 'unplayed'
			   AND (f.player_low_id = @playerId OR f.player_high_id = @playerId)
			 ORDER BY p.display_name COLLATE NOCASE`
		)
		.all({ roundId: activeRound.id, playerId: options.playerId }) as Array<{
			fixture_id: number;
			opponent_id: number;
			opponent_name: string;
		}>;
	return fixtures.map((fixture) => {
		const source = previousRoundPointsAgainst(db, {
			seasonId: options.seasonId,
			playerId: fixture.opponent_id,
			opponentId: options.playerId,
			beforeRoundNumber: activeRound.number
		});
		return {
			fixtureId: fixture.fixture_id,
			opponentId: fixture.opponent_id,
			opponentName: fixture.opponent_name,
			sourceResultId: source?.resultId ?? null,
			sourceRound: source?.roundNumber ?? null,
			tablePoints: source?.tablePoints ?? null
		};
	});
}

/**
 * Mark a player withdrawn from future rounds and resolve each still-unplayed
 * fixture in the active round, in one transaction. A genuine confirmed result
 * against the same opponent in the latest previous round supplies the points;
 * otherwise crypto.randomInt(0, 4) makes the saved, equal-odds 0–3 draw.
 */
export function withdrawPlayerAndResolveFixtures(
	db: Db,
	input: { seasonId: number; playerId: number; actorPlayerId: number | null; reason: string },
	rng: (maxExclusive: number) => number = (maxExclusive) => randomInt(maxExclusive)
): { effectiveFromRound: number; alreadyWithdrawn: boolean; awards: AwardReveal[] } {
	const reason = input.reason.trim();
	if (reason.length < 3) throw new Error('Add a short reason for the audit record.');
	return db.transaction(() => {
		const activeRound = db
			.prepare("SELECT id, number FROM rounds WHERE season_id = ? AND status = 'open'")
			.get(input.seasonId) as { id: number; number: number } | undefined;
		const contextFixture = activeRound
			? (db.prepare('SELECT id FROM fixtures WHERE round_id = ? ORDER BY id LIMIT 1').get(activeRound.id) as
					| { id: number }
					| undefined)?.id ?? null
			: latestFixtureId(db);
		assertAdmin(db, input.actorPlayerId, contextFixture);

		const existing = db
			.prepare('SELECT effective_from_round FROM player_withdrawals WHERE player_id = ?')
			.get(input.playerId) as { effective_from_round: number } | undefined;
		if (existing) return { effectiveFromRound: existing.effective_from_round, alreadyWithdrawn: true, awards: [] };

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
		).run(input.playerId, input.seasonId, effectiveFromRound, input.actorPlayerId, reason);

		const awards: AwardReveal[] = [];
		if (activeRound) {
			const outstanding = loadWithdrawalAwardPreview(db, {
				seasonId: input.seasonId,
				playerId: input.playerId
			});
			for (const fixture of outstanding) {
				const fallback = fixture.tablePoints === null;
				const drawValue = fallback ? rng(4) : null;
				if (fallback && (!Number.isInteger(drawValue) || drawValue! < 0 || drawValue! > 3)) {
					throw new Error('The server draw must be a whole number from 0 to 3.');
				}
				const tablePoints = fallback ? drawValue! : fixture.tablePoints!;
				const awardId = createAward(db, {
					fixtureId: fixture.fixtureId,
					playerId: fixture.opponentId,
					tablePoints,
					sourceType: fallback ? 'random_draw' : 'previous_round_result',
					sourceResultId: fixture.sourceResultId,
					drawValue,
					createdByPlayerId: input.actorPlayerId!,
					reason: fallback
						? `Withdrawal award: no genuine previous-round result was available; server draw 0–3.`
						: `Withdrawal award based on Round ${fixture.sourceRound} result ${fixture.sourceResultId}.`
				});
				awards.push({
					...fixture,
					awardId,
					tablePoints,
					sourceType: fallback ? 'random_draw' : 'previous_round_result',
					drawValue
				});
			}
		}

		recordAudit(db, {
			entityType: 'player',
			entityId: input.playerId,
			action: 'withdrawn_from_future_rounds',
			actorPlayerId: input.actorPlayerId,
			reason,
			detail: { seasonId: input.seasonId, effectiveFromRound, awardIds: awards.map((award) => award.awardId) }
		});
		return { effectiveFromRound, alreadyWithdrawn: false, awards };
	})();
}

export interface AwardReviewItem {
	awardId: number;
	fixtureId: number;
	resultId: number;
	resultFixtureId: number;
	playerId: number;
	playerName: string;
	opponentName: string;
	roundNumber: number;
	currentAwardPoints: number;
	updatedSourcePoints: number;
	flaggedAt: string;
	sourceRevision: number;
}

/** Latest still-unresolved correction flags, joined to the current source result. */
export function loadAwardReviewQueue(db: Db): AwardReviewItem[] {
	const auditRows = db
		.prepare(
			`SELECT id, entity_type, entity_id, action, detail, created_at
			 FROM audit_log WHERE action IN ('award_review_needed', 'award_reviewed') ORDER BY id`
		)
		.all() as Array<{
			id: number;
			entity_type: string;
			entity_id: number;
			action: string;
			detail: string | null;
			created_at: string;
		}>;
	const latestFlag = new Map<number, { auditId: number; resultId: number; createdAt: string }>();
	const latestReview = new Map<number, number>();
	for (const row of auditRows) {
		if (row.action === 'award_reviewed' && row.entity_type === 'award') {
			latestReview.set(row.entity_id, row.id);
			continue;
		}
		if (row.action !== 'award_review_needed' || row.entity_type !== 'result') continue;
		try {
			const detail = JSON.parse(row.detail ?? '{}') as { awards?: Array<{ id?: number }> };
			for (const item of detail.awards ?? []) {
				if (Number.isInteger(item.id)) {
					latestFlag.set(item.id!, { auditId: row.id, resultId: row.entity_id, createdAt: row.created_at });
				}
			}
		} catch {
			// A malformed historic audit detail should not take down the admin queue.
		}
	}
	const pending = [...latestFlag.entries()].filter(
		([awardId, flag]) => (latestReview.get(awardId) ?? 0) < flag.auditId
	);
	const items: AwardReviewItem[] = [];
	for (const [awardId, flag] of pending) {
		const row = db
			.prepare(
				`SELECT a.id AS award_id, a.fixture_id, a.player_id, a.table_points,
					f.round_id, f.player_low_id, f.player_high_id,
					ro.number AS round_number,
					r.id AS result_id, r.fixture_id AS result_fixture_id, r.player_low_frames,
					r.player_high_frames, r.status AS result_status, r.revision,
					award_player.display_name AS player_name,
					CASE WHEN f.player_low_id = a.player_id THEN high_player.display_name ELSE low_player.display_name END AS opponent_name
				 FROM awards a
				 JOIN fixtures f ON f.id = a.fixture_id
				 JOIN rounds ro ON ro.id = f.round_id
				 JOIN players award_player ON award_player.id = a.player_id
				 JOIN players low_player ON low_player.id = f.player_low_id
				 JOIN players high_player ON high_player.id = f.player_high_id
				 JOIN results r ON r.id = a.source_result_id
				 WHERE a.id = ?`
			)
			.get(awardId) as
			| {
					award_id: number;
					fixture_id: number;
					player_id: number;
					table_points: number;
					round_id: number;
					player_low_id: number;
					player_high_id: number;
					round_number: number;
					result_id: number;
					result_fixture_id: number;
					player_low_frames: number;
					player_high_frames: number;
					result_status: string;
					revision: number;
					player_name: string;
					opponent_name: string;
				}
			| undefined;
		if (!row || row.result_status !== 'confirmed') continue;
		const updatedSourcePoints =
			row.player_id === row.player_low_id ? row.player_low_frames : row.player_high_frames;
		items.push({
			awardId: row.award_id,
			fixtureId: row.fixture_id,
			resultId: row.result_id,
			resultFixtureId: row.result_fixture_id,
			playerId: row.player_id,
			playerName: row.player_name,
			opponentName: row.opponent_name,
			roundNumber: row.round_number,
			currentAwardPoints: row.table_points,
			updatedSourcePoints,
			flaggedAt: flag.createdAt,
			sourceRevision: row.revision
		});
	}
	return items.sort((a, b) => b.flaggedAt.localeCompare(a.flaggedAt) || a.awardId - b.awardId);
}

/** Resolve a correction flag: keep the saved value, or copy the corrected source score. */
export function reviewCorrectedAward(
	db: Db,
	input: { awardId: number; actorPlayerId: number | null; decision: 'keep' | 'apply_source'; reason: string }
): { before: number; after: number } {
	const reason = input.reason.trim();
	return db.transaction(() => {
		const award = db
			.prepare('SELECT id, fixture_id, player_id, table_points, source_result_id FROM awards WHERE id = ?')
			.get(input.awardId) as
			| { id: number; fixture_id: number; player_id: number; table_points: number; source_result_id: number | null }
			| undefined;
		if (!award || award.source_result_id === null) throw new Error('This source-linked award no longer exists.');
		assertAdmin(db, input.actorPlayerId, award.fixture_id);
		if (!loadAwardReviewQueue(db).some((item) => item.awardId === award.id)) {
			throw new Error('This award is not waiting for a source-correction review.');
		}
		if (reason.length < 3) throw new Error('Add a short reason for the award review.');
		const source = db
			.prepare('SELECT id, fixture_id, player_low_frames, player_high_frames, status FROM results WHERE id = ?')
			.get(award.source_result_id) as
			| { id: number; fixture_id: number; player_low_frames: number; player_high_frames: number; status: string }
			| undefined;
		if (!source || source.status !== 'confirmed') throw new Error('The award source is no longer a confirmed result.');
		const sides = db
			.prepare('SELECT player_low_id, player_high_id FROM fixtures WHERE id = ?')
			.get(source.fixture_id) as { player_low_id: number; player_high_id: number } | undefined;
		if (!sides || ![sides.player_low_id, sides.player_high_id].includes(award.player_id)) {
			throw new Error('The award recipient is not a player in its source result.');
		}
		const updatedSourcePoints =
			award.player_id === sides.player_low_id ? source.player_low_frames : source.player_high_frames;
		const after = input.decision === 'apply_source' ? updatedSourcePoints : award.table_points;
		if (input.decision === 'apply_source') {
			db.prepare('UPDATE awards SET table_points = ? WHERE id = ?').run(after, award.id);
		}
		recordAudit(db, {
			entityType: 'award',
			entityId: award.id,
			action: 'award_reviewed',
			actorPlayerId: input.actorPlayerId,
			reason,
			detail: {
				decision: input.decision,
				resultId: source.id,
				sourceRevision: (db.prepare('SELECT revision FROM results WHERE id = ?').get(source.id) as { revision: number }).revision,
				before: award.table_points,
				after,
				updatedSourcePoints
			}
		});
		return { before: award.table_points, after };
	})();
}

export interface AwardLedgerItem {
	awardId: number;
	fixtureId: number;
	playerName: string;
	opponentName: string;
	roundNumber: number;
	tablePoints: number;
	sourceType: string;
	sourceResultId: number | null;
	sourceFixtureId: number | null;
	drawValue: number | null;
	reason: string | null;
}

export function loadAwardLedger(db: Db, seasonId: number | null): AwardLedgerItem[] {
	const rows = db
		.prepare(
			`SELECT a.id AS award_id, a.fixture_id, p.display_name AS player_name,
					CASE WHEN f.player_low_id = a.player_id THEN hp.display_name ELSE lp.display_name END AS opponent_name,
					ro.number AS round_number, a.table_points, a.source_type,
					a.source_result_id, source.fixture_id AS source_fixture_id,
				a.draw_value, a.reason
			 FROM awards a
			 LEFT JOIN results source ON source.id = a.source_result_id
			 JOIN fixtures f ON f.id = a.fixture_id
			 JOIN rounds ro ON ro.id = f.round_id
			 JOIN players p ON p.id = a.player_id
			 JOIN players lp ON lp.id = f.player_low_id
			 JOIN players hp ON hp.id = f.player_high_id
			 WHERE (? IS NULL OR ro.season_id = ?)
			 ORDER BY ro.number DESC, a.id DESC`
		)
		.all(seasonId, seasonId) as Array<{
			award_id: number;
			fixture_id: number;
			player_name: string;
			opponent_name: string;
			round_number: number;
			table_points: number;
			source_type: string;
			source_result_id: number | null;
			source_fixture_id: number | null;
			draw_value: number | null;
			reason: string | null;
		}>;
	return rows.map((row) => ({
		awardId: row.award_id,
		fixtureId: row.fixture_id,
		playerName: row.player_name,
		opponentName: row.opponent_name,
		roundNumber: row.round_number,
		tablePoints: row.table_points,
		sourceType: row.source_type,
		sourceResultId: row.source_result_id,
		sourceFixtureId: row.source_fixture_id,
		drawValue: row.draw_value,
		reason: row.reason
	}));
}
