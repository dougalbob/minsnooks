import fs from 'node:fs';
import { closeDb, getDb } from '../src/lib/server/db';
import { seedAll } from '../src/lib/server/seed';

const db = getDb();
seedAll(db);
const fixture = db.prepare(`SELECT f.id AS id, f.player_low_id AS lowId, f.player_high_id AS highId
	FROM fixtures f JOIN rounds r ON r.id = f.round_id
	WHERE r.number = 6 AND r.status = 'open' AND f.state = 'unplayed'
	ORDER BY f.id LIMIT 1`).get() as { id: number; lowId: number; highId: number } | undefined;
if (!fixture) throw new Error('Smoke fixture not found in fictional seed.');
const submittedAt = new Date().toISOString();
db.prepare(`INSERT INTO results (fixture_id, player_low_frames, player_high_frames, actual_played_date,
	status, entry_source, submitted_by_player_id, submitted_at)
	VALUES (?, 2, 1, '2026-09-28', 'submitted', 'player', ?, ?)`).run(fixture.id, fixture.lowId, submittedAt);
db.prepare("UPDATE fixtures SET state = 'awaiting_confirmation' WHERE id = ?").run(fixture.id);
const players = db.prepare('SELECT id, email FROM players WHERE id IN (?, ?)').all(fixture.lowId, fixture.highId) as Array<{id:number;email:string}>;
const low = players.find((player) => player.id === fixture.lowId)!;
const high = players.find((player) => player.id === fixture.highId)!;
const target = process.env.SMOKE_FIXTURE_INFO;
if (!target) throw new Error('SMOKE_FIXTURE_INFO path is required.');
fs.writeFileSync(target, JSON.stringify({ fixtureId: fixture.id, lowEmail: low.email, highEmail: high.email }));
closeDb();
console.log(`Prepared isolated fictional smoke fixture ${fixture.id}.`);
