/**
 * Idempotent fictional dev seed (HANDOFF §1: fictional data only).
 * Inserts the eight prototype players. Safe to re-run; never runs in
 * production builds of the app itself (explicit script only).
 */
import { getDb, closeDb } from './db';

const PLAYERS: Array<{
	email: string;
	display_name: string;
	initials: string;
	avatar_tone: string;
	role: 'player' | 'admin' | 'super_admin';
}> = [
	{ email: 'maya.chen@example.test', display_name: 'Maya Chen', initials: 'MC', avatar_tone: 'maya', role: 'super_admin' },
	{ email: 'leon.park@example.test', display_name: 'Leon Park', initials: 'LP', avatar_tone: 'leon', role: 'player' },
	{ email: 'jules.rivera@example.test', display_name: 'Jules Rivera', initials: 'JR', avatar_tone: 'jules', role: 'admin' },
	{ email: 'sam.wilson@example.test', display_name: 'Sam Wilson', initials: 'SW', avatar_tone: 'sam', role: 'player' },
	{ email: 'priya.desai@example.test', display_name: 'Priya Desai', initials: 'PD', avatar_tone: 'priya', role: 'player' },
	{ email: 'owen.brooks@example.test', display_name: 'Owen Brooks', initials: 'OB', avatar_tone: 'owen', role: 'player' },
	{ email: 'ella.thompson@example.test', display_name: 'Ella Thompson', initials: 'ET', avatar_tone: 'ella', role: 'player' },
	{ email: 'noah.kim@example.test', display_name: 'Noah Kim', initials: 'NK', avatar_tone: 'noah', role: 'player' }
];

export function seedPlayers(): number {
	const db = getDb();
	const upsert = db.prepare(`
		INSERT INTO players (email, display_name, initials, avatar_tone, role)
		VALUES (@email, @display_name, @initials, @avatar_tone, @role)
		ON CONFLICT (email) DO UPDATE SET
			display_name = excluded.display_name,
			initials = excluded.initials,
			avatar_tone = excluded.avatar_tone,
			role = excluded.role
	`);
	const tx = db.transaction((rows: typeof PLAYERS) => {
		for (const row of rows) upsert.run(row);
	});
	tx(PLAYERS);
	return PLAYERS.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const count = seedPlayers();
	console.log(`Seeded ${count} fictional players.`);
	closeDb();
}
