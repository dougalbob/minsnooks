import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/lib/server/db';
import { runMigrations } from '../src/lib/server/migrate';
import { seedAll } from '../src/lib/server/seed';
import {
	createKnockoutCompetition,
	drawKnockoutOpeningStage,
	finaliseKnockoutEntry,
	KnockoutPermissionError,
	KnockoutValidationError,
	loadKnockoutCompetitions,
	recordKnockoutSwap,
	respondToKnockoutInvitation
} from '../src/lib/server/knockout';

const migrations = path.resolve(process.cwd(), 'migrations');
const databases: Db[] = [];
const openingTime = new Date('2026-04-01T12:00:00.000Z');
const beforeDeadline = new Date('2026-04-05T10:00:00.000Z');
const afterDeadline = new Date('2026-04-05T12:00:00.000Z');

function freshDb(): Db {
	const file = path.join(os.tmpdir(), `minsnooks-knockout-${Date.now()}-${Math.random()}.db`);
	const db = openDb(file);
	databases.push(db);
	runMigrations(db, migrations);
	return db;
}

afterEach(() => {
	while (databases.length) {
		const db = databases.pop()!;
		const file = db.name;
		db.close();
		for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true });
	}
});

interface TestPeople {
	adminId: number;
	superAdminId: number;
	playerIds: number[];
	inactiveId: number;
}

/** Admin, super-admin, ten players and one inactive row; all content is fictional. */
function addPeople(db: Db): TestPeople {
	const insert = db.prepare(
		`INSERT INTO players (email, display_name, initials, avatar_tone, role, is_active)
		 VALUES (?, ?, ?, 'maya', ?, ?)`
	);
	const add = (email: string, name: string, role: string, active = 1) =>
		Number(insert.run(email, name, name.slice(0, 2).toUpperCase(), role, active).lastInsertRowid);
	const adminId = add('admin@example.test', 'Admin', 'admin');
	const superAdminId = add('super@example.test', 'Super', 'super_admin');
	const playerIds = Array.from({ length: 10 }, (_, index) => {
		const number = index + 1;
		return add(`player${number}@example.test`, `Player ${number}`, 'player');
	});
	const inactiveId = add('inactive@example.test', 'Inactive', 'player', 0);
	return { adminId, superAdminId, playerIds, inactiveId };
}

function createInvitation(db: Db, actorPlayerId: number, title = 'Test knockout'): number {
	return createKnockoutCompetition(
		db,
		{
			actorPlayerId,
			title,
			announcement: 'A friendly fictional competition.',
			replyDeadlineAt: '2026-04-05T11:00:00.000Z',
			framesToWin: 3
		},
		{ now: openingTime }
	);
}

function optIn(db: Db, competitionId: number, playerId: number, now = beforeDeadline): void {
	respondToKnockoutInvitation(db, { competitionId, actorPlayerId: playerId, optedIn: true }, { now });
}

function fillEntries(db: Db, competitionId: number, ids: number[], now = beforeDeadline): void {
	for (const id of ids) optIn(db, competitionId, id, now);
}

function seededRandom(seed: number): (maxExclusive: number) => number {
	let state = seed >>> 0;
	return (maxExclusive) => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state % maxExclusive;
	};
}

function count(db: Db, table: string): number {
	return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe('Phase 11 knockout entry and opening draw', () => {
	it('seeds an open invitation and a six-player close-and-draw demo without changing league fixtures', () => {
		const db = freshDb();
		const first = seedAll(db);
		expect(first.knockoutInvitations).toBe(2);
		const competitions = loadKnockoutCompetitions(db);
		const open = competitions.find((item) => item.title === 'Autumn Knockout · Preview')!;
		const practice = competitions.find((item) => item.title === 'Practice Draw · Ready to Close')!;
		expect(open.status).toBe('inviting');
		expect(open.optedInPlayers).toHaveLength(0);
		expect(new Date(open.replyDeadlineAt).getTime()).toBeGreaterThan(Date.now());
		expect(practice.status).toBe('inviting');
		expect(new Date(practice.replyDeadlineAt).getTime()).toBeLessThan(Date.now());
		expect(practice.optedInPlayers).toHaveLength(6);
		expect(count(db, 'fixtures')).toBe(168);
		expect(count(db, 'results')).toBe(138);
		expect(seedAll(db).knockoutInvitations).toBe(0);
		expect(loadKnockoutCompetitions(db)).toHaveLength(2);
	});

	it('announces an admin-owned invitation with a fixed deadline and match format', () => {
		const db = freshDb();
		const people = addPeople(db);
		const id = createInvitation(db, people.adminId, 'Winter Knockout');
		const row = db
			.prepare('SELECT title, announcement, reply_deadline_at, frames_to_win, status FROM knockout_competitions WHERE id = ?')
			.get(id);
		expect(row).toEqual({
			title: 'Winter Knockout',
			announcement: 'A friendly fictional competition.',
			reply_deadline_at: '2026-04-05T11:00:00.000Z',
			frames_to_win: 3,
			status: 'inviting'
		});
		expect(() => createInvitation(db, people.playerIds[0])).toThrow(KnockoutPermissionError);
		expect(() =>
			createKnockoutCompetition(
				db,
				{ actorPlayerId: people.adminId, title: 'Invalid format', replyDeadlineAt: '2026-04-06T12:00:00Z', framesToWin: 5 },
				{ now: openingTime }
			)
		).toThrow(KnockoutValidationError);
		expect(() =>
			createKnockoutCompetition(
				db,
				{ actorPlayerId: people.adminId, title: 'Late invite', replyDeadlineAt: '2026-04-01T11:00:00Z', framesToWin: 2 },
				{ now: openingTime }
			)
		).toThrow(/future/);
		expect(
			(db
				.prepare("SELECT action, actor_player_id FROM audit_log WHERE entity_type = 'knockout_competition' AND entity_id = ?")
				.get(id) as { action: string; actor_player_id: number })
		).toEqual({ action: 'announced', actor_player_id: people.adminId });
	});

	it('allows an active player to opt in or out until the deadline and audits only changes', () => {
		const db = freshDb();
		const people = addPeople(db);
		const competitionId = createInvitation(db, people.adminId);
		const playerId = people.playerIds[0];

		expect(respondToKnockoutInvitation(db, { competitionId, actorPlayerId: playerId, optedIn: true }, { now: beforeDeadline }))
			.toEqual({ changed: true, optedIn: true });
		expect(respondToKnockoutInvitation(db, { competitionId, actorPlayerId: playerId, optedIn: true }, { now: beforeDeadline }))
			.toEqual({ changed: false, optedIn: true });
			expect(respondToKnockoutInvitation(db, { competitionId, actorPlayerId: playerId, optedIn: false }, { now: beforeDeadline }))
			.toEqual({ changed: true, optedIn: false });
		expect(() =>
			respondToKnockoutInvitation(db, { competitionId, actorPlayerId: people.inactiveId, optedIn: true }, { now: beforeDeadline })
		).toThrow(KnockoutPermissionError);
		expect(() =>
			respondToKnockoutInvitation(db, { competitionId, actorPlayerId: playerId, optedIn: true }, { now: afterDeadline })
		).toThrow(/deadline has passed/);
		expect(
			(db.prepare('SELECT opted_in FROM knockout_responses WHERE competition_id = ? AND player_id = ?')
				.get(competitionId, playerId) as { opted_in: number }).opted_in
		).toBe(0);
		expect(
			(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'knockout_competition' AND entity_id = ?")
				.get(competitionId) as { n: number }).n
		).toBe(3); // announce, opt-in, opt-out; unchanged repeat is not duplicated
	});

	it('waits for the deadline, then abandons an attempt with fewer than six entrants', () => {
		const db = freshDb();
		const people = addPeople(db);
		const competitionId = createInvitation(db, people.adminId);
		fillEntries(db, competitionId, people.playerIds.slice(0, 5));

		expect(() =>
			finaliseKnockoutEntry(db, { competitionId, actorPlayerId: people.adminId }, { now: beforeDeadline })
		).toThrow(/until the reply deadline/);
		const result = finaliseKnockoutEntry(
			db,
			{ competitionId, actorPlayerId: people.adminId },
			{ now: afterDeadline, randomInt: seededRandom(11) }
		);
		expect(result).toEqual({ status: 'abandoned', entrantCount: 5, selectedPlayerIds: [], waitingPlayerIds: [] });
		expect((db.prepare('SELECT status FROM knockout_competitions WHERE id = ?').get(competitionId) as { status: string }).status)
			.toBe('abandoned');
		expect(count(db, 'knockout_entries')).toBe(0);
		expect(() =>
			finaliseKnockoutEntry(db, { competitionId, actorPlayerId: people.adminId }, { now: afterDeadline })
		).toThrow(/already been closed/);
	});

	it.each([6, 7, 8])('selects all %i eligible entrants without creating a smaller or oversized field', (size) => {
		const db = freshDb();
		const people = addPeople(db);
		const competitionId = createInvitation(db, people.adminId);
		fillEntries(db, competitionId, people.playerIds.slice(0, size));
		const result = finaliseKnockoutEntry(
			db,
			{ competitionId, actorPlayerId: people.adminId },
			{ now: afterDeadline, randomInt: seededRandom(size) }
		);
		expect(result.status).toBe('selected');
		expect(result.entrantCount).toBe(size);
		expect(result.selectedPlayerIds).toHaveLength(size);
		expect(result.waitingPlayerIds).toEqual([]);
		expect(new Set(result.selectedPlayerIds).size).toBe(size);
		expect((db.prepare("SELECT COUNT(*) AS n FROM knockout_entries WHERE entry_status = 'selected'").get() as { n: number }).n)
			.toBe(size);
	});

	it('randomly selects eight from more than eight opt-ins and preserves a randomized waiting list', () => {
		const db = freshDb();
		const people = addPeople(db);
		const competitionId = createInvitation(db, people.adminId);
		fillEntries(db, competitionId, people.playerIds);
		const result = finaliseKnockoutEntry(
			db,
			{ competitionId, actorPlayerId: people.adminId },
			{ now: afterDeadline, randomInt: seededRandom(91) }
		);
		expect(result.status).toBe('selected');
		expect(result.entrantCount).toBe(10);
		expect(result.selectedPlayerIds).toHaveLength(8);
		expect(result.waitingPlayerIds).toHaveLength(2);
		expect(new Set([...result.selectedPlayerIds, ...result.waitingPlayerIds]).size).toBe(10);
		expect(new Set([...result.selectedPlayerIds, ...result.waitingPlayerIds])).toEqual(new Set(people.playerIds));
		expect(() => finaliseKnockoutEntry(db, { competitionId, actorPlayerId: people.adminId }, { now: afterDeadline }))
			.toThrow(/already been closed/);
	});

	it('records a consensual selected/waitlist swap once, before the opening draw, without rerunning selection', () => {
		const db = freshDb();
		const people = addPeople(db);
		const competitionId = createInvitation(db, people.adminId);
		fillEntries(db, competitionId, people.playerIds);
		const selection = finaliseKnockoutEntry(
			db,
			{ competitionId, actorPlayerId: people.adminId },
			{ now: afterDeadline, randomInt: seededRandom(7) }
		);
		const selectedOut = selection.selectedPlayerIds[0];
		const waitingIn = selection.waitingPlayerIds[0];

		expect(() => recordKnockoutSwap(db, {
			competitionId, actorPlayerId: people.adminId, selectedPlayerId: selectedOut,
			waitingPlayerId: waitingIn, consentConfirmed: false
		})).toThrow(/both players agreed/);
		expect(() => recordKnockoutSwap(db, {
			competitionId, actorPlayerId: people.playerIds[0], selectedPlayerId: selectedOut,
			waitingPlayerId: waitingIn, consentConfirmed: true
		})).toThrow(KnockoutPermissionError);

		recordKnockoutSwap(db, {
			competitionId,
			actorPlayerId: people.adminId,
			selectedPlayerId: selectedOut,
			waitingPlayerId: waitingIn,
			consentConfirmed: true,
			reason: 'Both players agreed to the change.'
		}, { now: new Date('2026-04-05T12:01:00Z') });
		const view = loadKnockoutCompetitions(db, selectedOut).find((item) => item.competitionId === competitionId)!;
		expect(view.selectedPlayers.map((player) => player.playerId)).toContain(waitingIn);
		expect(view.selectedPlayers.map((player) => player.playerId)).not.toContain(selectedOut);
		expect(view.waitingPlayers.map((player) => player.playerId)).toContain(selectedOut);
		expect(view.swaps).toHaveLength(1);
		expect(view.swaps[0]).toMatchObject({ reason: 'Both players agreed to the change.' });

		drawKnockoutOpeningStage(db, { competitionId, actorPlayerId: people.adminId }, { now: new Date('2026-04-05T12:02:00Z'), randomInt: seededRandom(8) });
		expect(() => recordKnockoutSwap(db, {
			competitionId, actorPlayerId: people.adminId, selectedPlayerId: waitingIn,
			waitingPlayerId: selectedOut, consentConfirmed: true
		})).toThrow(/already saved/);
	});

	it.each([
		{ size: 6, expectedByes: 2, expectedMatches: 2 },
		{ size: 7, expectedByes: 1, expectedMatches: 3 },
		{ size: 8, expectedByes: 0, expectedMatches: 4 }
	])('draws $expectedMatches opening ties and $expectedByes byes for $size entrants', ({ size, expectedByes, expectedMatches }) => {
		const db = freshDb();
		const people = addPeople(db);
		const competitionId = createInvitation(db, people.adminId);
		const entrants = people.playerIds.slice(0, size);
		fillEntries(db, competitionId, entrants);
		finaliseKnockoutEntry(db, { competitionId, actorPlayerId: people.adminId }, { now: afterDeadline, randomInt: seededRandom(size * 10) });
		const draw = drawKnockoutOpeningStage(
			db,
			{ competitionId, actorPlayerId: people.adminId },
			{ now: new Date('2026-04-05T12:01:00Z'), randomInt: seededRandom(size * 100) }
		);
		expect(draw.matchups).toHaveLength(expectedMatches);
		expect(draw.byePlayerIds).toHaveLength(expectedByes);
		expect(draw.framesToWin).toBe(3);
		expect(new Set([...draw.matchups.flat(), ...draw.byePlayerIds])).toEqual(new Set(entrants));
		expect(new Set([...draw.matchups.flat(), ...draw.byePlayerIds]).size).toBe(size);
		expect(() => drawKnockoutOpeningStage(db, { competitionId, actorPlayerId: people.adminId }, { now: afterDeadline }))
			.toThrow(/already been saved/);

		const view = loadKnockoutCompetitions(db, entrants[0]).find((item) => item.competitionId === competitionId)!;
		expect(view.status).toBe('drawn');
		expect(view.viewerOptedIn).toBe(true);
		expect(view.stages[0].ties.filter((tie) => tie.type === 'match')).toHaveLength(expectedMatches);
		expect(view.stages[0].ties.filter((tie) => tie.type === 'bye')).toHaveLength(expectedByes);
		expect(
			(db.prepare("SELECT action FROM audit_log WHERE entity_type = 'knockout_competition' AND entity_id = ? ORDER BY id DESC LIMIT 1")
				.get(competitionId) as { action: string }).action
		).toBe('opening_draw_saved');
		// Knockout rows do not create league fixtures or results.
		expect(count(db, 'fixtures')).toBe(0);
		expect(count(db, 'results')).toBe(0);
	});

	it('reproduces selection and first-draw results with the same seeded test random source', () => {
		const scenarios = [freshDb(), freshDb()];
		const outcomes = scenarios.map((db) => {
			const people = addPeople(db);
			const competitionId = createInvitation(db, people.adminId);
			fillEntries(db, competitionId, people.playerIds);
			const selection = finaliseKnockoutEntry(
				db,
				{ competitionId, actorPlayerId: people.adminId },
				{ now: afterDeadline, randomInt: seededRandom(2026) }
			);
			const draw = drawKnockoutOpeningStage(
				db,
				{ competitionId, actorPlayerId: people.adminId },
				{ now: new Date('2026-04-05T12:01:00Z'), randomInt: seededRandom(2027) }
			);
			return { selected: selection.selectedPlayerIds, waiting: selection.waitingPlayerIds, matchups: draw.matchups, byes: draw.byePlayerIds };
		});
		expect(outcomes[0]).toEqual(outcomes[1]);
	});
});
