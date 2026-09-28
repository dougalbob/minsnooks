/**
 * Authentication skeleton (HANDOFF §9).
 *
 * Production: Cloudflare Access sits in front of the app and injects
 * `Cf-Access-Jwt-Assertion`. We verify it cryptographically (issuer, audience,
 * signature, expiry) and enforce an explicit approved-email allowlist.
 * Configuration errors fail closed. Roles come from the database only.
 *
 * Development: an explicit dev identity may be used, and can never work
 * when NODE_ENV=production.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';

export type Role = 'player' | 'admin' | 'super_admin';

export interface Identity {
	sub: string;
	email: string;
}

export class AuthConfigError extends Error {}
export class AuthError extends Error {}

export interface AuthConfig {
	mode: 'access' | 'dev';
	/** Cloudflare team domain, e.g. `yourteam.cloudflareaccess.com`. */
	teamDomain: string;
	/** Application AUD tag configured in Cloudflare Access. */
	audience: string;
	allowlist: string[];
	devEmail: string;
	isProduction: boolean;
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
	const mode = env.AUTH_MODE;
	if (mode !== 'access' && mode !== 'dev') {
		throw new AuthConfigError(
			'AUTH_MODE must be set to "access" or "dev". Refusing to authenticate without explicit configuration.'
		);
	}
	const isProduction = env.NODE_ENV === 'production';
	if (mode === 'dev' && isProduction) {
		throw new AuthConfigError('AUTH_MODE=dev is never allowed in production.');
	}

	const teamDomain = (env.CF_TEAM_DOMAIN ?? '').trim().replace(/^https:\/\//, '').replace(/\/$/, '');
	const audience = (env.CF_AUD ?? '').trim();
	const allowlist = (env.ACCESS_EMAIL_ALLOWLIST ?? '')
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
	const devEmail = (env.DEV_USER_EMAIL ?? '').trim().toLowerCase();

	if (mode === 'access') {
		if (!teamDomain) throw new AuthConfigError('CF_TEAM_DOMAIN is required for AUTH_MODE=access.');
		if (!audience) throw new AuthConfigError('CF_AUD is required for AUTH_MODE=access.');
		if (allowlist.length === 0) {
			throw new AuthConfigError(
				'ACCESS_EMAIL_ALLOWLIST must list at least one approved email for AUTH_MODE=access.'
			);
		}
	} else {
		if (!devEmail) throw new AuthConfigError('DEV_USER_EMAIL is required for AUTH_MODE=dev.');
		if (allowlist.length > 0 && !allowlist.includes(devEmail)) {
			throw new AuthConfigError('DEV_USER_EMAIL must be in ACCESS_EMAIL_ALLOWLIST when a allowlist is set.');
		}
	}

	return { mode, teamDomain, audience, allowlist, devEmail, isProduction };
}

export function isEmailAllowed(email: string, config: AuthConfig): boolean {
	if (config.allowlist.length === 0) {
		// No allowlist configured: only dev mode tolerates this (any dev email).
		return config.mode === 'dev';
	}
	return config.allowlist.includes(email.trim().toLowerCase());
}

/**
 * Resolve the request identity, or null if there is no valid identity.
 * Throws AuthConfigError (fail closed) when configuration is missing/invalid.
 */
export async function getIdentity(
	request: Request,
	env: NodeJS.ProcessEnv = process.env
): Promise<Identity | null> {
	const config = loadAuthConfig(env);
	if (config.mode === 'dev') {
		return { sub: 'dev', email: config.devEmail };
	}

	const token = request.headers.get('cf-access-jwt-assertion');
	if (!token) return null;

	const issuer = `https://${config.teamDomain}`;
	const jwks = createRemoteJWKSet(new URL(`https://${config.teamDomain}/cdn-cgi/access/certs`));
	let payload;
	try {
		({ payload } = await jwtVerify(token, jwks, { issuer, audience: config.audience }));
	} catch {
		return null; // invalid signature, issuer, audience or expiry → no identity
	}

	const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
	if (!email || !isEmailAllowed(email, config)) return null;
	return { sub: String(payload.sub ?? ''), email };
}
