/**
 * Viewer resolution & role checks (HANDOFF §9, PLAN Phase 8).
 *
 * Cloudflare Access verification or the dev preview identity is piped into
 * `locals`, database roles are enforced on every write path, and contact
 * visibility is respected.
 *
 *   * the verified email (dev identity or an Access JWT, via `getIdentity`) is
 *     resolved to a player row — never to a role by inference;
 *   * if authentication is unconfigured or the identity is invalid, there is
 *     simply no viewer: pages still render in read-only mode, and nothing is writable;
 *   * a viewer is only ever a player row that already exists in the database, so
 *     the dev identity cannot invent a player.
 */
import type { Db } from './db';
import { getIdentity, loadAuthConfig, type AuthEnv, type VerifyAccessOptions } from './auth';

export type ViewerRole = 'player' | 'admin' | 'super_admin';

export interface ViewerPlayer {
	playerId: number;
	name: string;
	initials: string;
	tone: string;
	email: string;
	role: ViewerRole;
	phone: string | null;
	contactVisible: boolean;
}

/**
 * Resolve the request's verified email, or null. Configuration problems fail
 * closed (no viewer) instead of breaking every page while auth is being wired.
 */
export async function resolveViewerEmail(
	request: Request,
	env: AuthEnv = process.env,
	options: VerifyAccessOptions = {}
): Promise<string | null> {
	try {
		const identity = await getIdentity(request, env, options);
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
			`SELECT id, display_name, initials, avatar_tone, email, role, phone, contact_visible
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
				phone: string | null;
				contact_visible: number;
		  }
		| undefined;
	if (!row) return null;
	return {
		playerId: row.id,
		name: row.display_name,
		initials: row.initials,
		tone: row.avatar_tone,
		email: row.email,
		role: row.role,
		phone: row.phone ?? null,
		contactVisible: row.contact_visible === 1
	};
}

export function viewerIsAdmin(viewer: ViewerPlayer | null): boolean {
	return viewer?.role === 'admin' || viewer?.role === 'super_admin';
}

export function viewerIsSuperAdmin(viewer: ViewerPlayer | null): boolean {
	return viewer?.role === 'super_admin';
}

/* ------------------------------------------------------------------ *
 * Dev preview identity
 * ------------------------------------------------------------------ *
 *
 * The Phase 6 journey is two-sided: a player records a result and the *other*
 * player confirms it or sends it back. A preview runs with a single dev
 * identity, so the owner could never see the opponent's half of the journey.
 *
 * This switch exists only for that. It is gated on the same rule as the dev
 * identity itself (HANDOFF §9): `AUTH_MODE=dev` and never production. With
 * `AUTH_MODE=access`, or in a production build, `?as=` and the cookie are
 * ignored entirely and the verified Access identity is the only viewer.
 *
 * It cannot invent a player either: the chosen address still has to resolve to
 * a player row through `loadViewerPlayer`, and roles still come from the
 * database.
 */

export const DEV_VIEWER_COOKIE = 'minsnooks_dev_viewer';

/** True only when the dev identity is allowed: `AUTH_MODE=dev`, not production. */
export function devIdentitySwitchAllowed(env: AuthEnv = process.env): boolean {
	try {
		const config = loadAuthConfig(env);
		return config.mode === 'dev' && !config.isProduction;
	} catch {
		// Missing or invalid configuration fails closed: no preview switch.
		return false;
	}
}

export interface DevViewerDecision {
	/** The preview email to use, or null for the request's own identity. */
	email: string | null;
	/** Cookie value to store, '' to clear it, or null to leave it alone. */
	setCookie: string | null;
}

/**
 * Decide the preview identity for a request: an explicit `?as=` wins, otherwise
 * the stored cookie, otherwise the request's own (dev or Access) identity.
 * Pure, so the production gate is testable without a server.
 */
export function decideDevViewerEmail(
	requested: string | null | undefined,
	stored: string | null | undefined,
	env: AuthEnv = process.env
): DevViewerDecision {
	if (!devIdentitySwitchAllowed(env)) return { email: null, setCookie: null };

	const asked = (requested ?? '').trim().toLowerCase();
	if (asked === 'none' || asked === 'clear') return { email: null, setCookie: '' };
	if (asked) return { email: asked, setCookie: asked };

	const remembered = (stored ?? '').trim().toLowerCase();
	return { email: remembered || null, setCookie: null };
}
