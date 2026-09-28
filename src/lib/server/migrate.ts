import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db';

/**
 * Minimal forward-only SQL migration runner.
 *
 * - Files live in `migrations/` and are applied in filename order.
 * - Applied filenames are recorded in `_migrations`; re-running is a no-op.
 * - A previously applied file whose contents changed is a hard error
 *   (history is never silently rewritten).
 */
export function runMigrations(db: Db, dir: string): string[] {
	db.exec(`
		CREATE TABLE IF NOT EXISTS _migrations (
			name TEXT PRIMARY KEY,
			applied_at TEXT NOT NULL DEFAULT (datetime('now')),
			checksum TEXT NOT NULL
		);
	`);

	const files = fs
		.readdirSync(dir)
		.filter((name) => name.endsWith('.sql'))
		.sort();

	const recorded = new Map<string, string>(
		db
			.prepare('SELECT name, checksum FROM _migrations')
			.all()
			.map((row) => {
				const r = row as { name: string; checksum: string };
				return [r.name, r.checksum] as const;
			})
	);

	const applied: string[] = [];
	for (const name of files) {
		const sql = fs.readFileSync(path.join(dir, name), 'utf8');
		const checksum = simpleChecksum(sql);
		const previous = recorded.get(name);
		if (previous !== undefined) {
			if (previous !== checksum) {
				throw new Error(
					`Migration ${name} has changed since it was applied. Add a new migration instead of editing applied ones.`
				);
			}
			continue;
		}
		db.transaction(() => {
			db.exec(sql);
			db.prepare('INSERT INTO _migrations (name, checksum) VALUES (?, ?)').run(name, checksum);
		})();
		applied.push(name);
	}
	return applied;
}

/** Fast non-cryptographic fingerprint; guards accidental edits, not attackers. */
function simpleChecksum(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}
