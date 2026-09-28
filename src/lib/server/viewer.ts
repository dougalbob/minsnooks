/**
 * Viewer resolution (provisional — Phase 5).
 *
 * The app needs to know which player is looking at a page so it can emphasise
 * "your fixture" and decide whether the planned-date actions belong to them.
 *
 * Phase 8 replaces this with the full identity/role/permission matrix: real
 * Cloudflare Access verification piped into `locals`, database roles enforced on
 * every write path, and a signed-off security checklist. Until then:
 *
 *   * the verified email (dev identity or an Access JWT, via `getIdentity`) is
 *     resolved to a player row — never to a role by inference;
 *   * if authentication is unconfigured or the identity is invalid, there is
 *     simply no viewer: pages still render, and nothing is writable;
 *   * a viewer is only ever a player row that already exists in the database, so
 *     the dev identity cannot invent a player.
 */
import type { Db } from './db';
import { getIdentity, type AuthEnv } from './auth';

export type ViewerRole = 'player' | 'admin' | 'super_admin';

export interface ViewerPlayer {
	playerId: number;
	name: string;
	initials: string;
	tone: string;
	email: string;
	role: ViewerRole;
}

/**
 * Resolve the request's verified email, or null. Configuration problems fail
 * closed (no viewer) instead of breaking every page while auth is being wired.
 */
export async function resolveViewerEmail(
	request: Request,
	env: AuthEnv = process.env
): Promise<string | null> {
	try {
		const identity = await getIdentity(request, env);
		return identity?.email ?? null;
	} catch {
		return null;
	}
}

/** Match a verified email to a seeded/registered player. */
export function loadViewerPlayer(db: Db, email: string | null | undefined): ViewerPlayer | null {
	if (!email) return null;
	const row = db
		.prepare(
			`SELECT id, display_name, initials, avatar_tone, email, role
			 FROM players WHERE email = ? COLLATE NOCASE AND is_active = 1`
		)
		.get(email.trim().toLowerCase()) as
		| {
				id: number;
				display_name: string;
				initials: string;
				avatar_tone: string;
				email: string;
				role: ViewerRole;
		  }
		| undefined;
	if (!row) return null;
	return {
		playerId: row.id,
		name: row.display_name,
		initials: row.initials,
		tone: row.avatar_tone,
		email: row.email,
		role: row.role
	};
}

export function viewerIsAdmin(viewer: ViewerPlayer | null): boolean {
	return viewer?.role === 'admin' || viewer?.role === 'super_admin';
}
