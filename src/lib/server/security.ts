import type { Db } from './db';

/** Shared SQLite-backed ceiling across app instances: authenticated writes per route per minute. */
export function consumeWriteRateLimit(
	db: Db,
	identityEmail: string,
	routeKey: string,
	options: { now?: number; limit?: number; windowMs?: number } = {}
): boolean {
	const now = options.now ?? Date.now();
	const limit = options.limit ?? 30;
	const windowMs = options.windowMs ?? 60_000;
	if (!Number.isFinite(now) || !Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1) {
		throw new Error('Invalid write rate-limit configuration.');
	}
	const identity = identityEmail.trim().toLowerCase();
	if (!identity || !routeKey.startsWith('/')) return false;
	return db.transaction(() => {
		// Bound table growth without running a separate scheduler.
		db.prepare('DELETE FROM request_rate_limits WHERE window_started_at < ?').run(now - 86_400_000);
		const current = db.prepare(`SELECT window_started_at AS startedAt, hit_count AS hits
			FROM request_rate_limits WHERE identity_email = ? AND route_key = ?`).get(identity, routeKey) as
			| { startedAt: number; hits: number }
			| undefined;
		if (!current || now - current.startedAt >= windowMs) {
			db.prepare(`INSERT INTO request_rate_limits (identity_email, route_key, window_started_at, hit_count)
				VALUES (?, ?, ?, 1) ON CONFLICT(identity_email, route_key) DO UPDATE SET
				window_started_at = excluded.window_started_at, hit_count = 1`).run(identity, routeKey, now);
			return true;
		}
		if (current.hits >= limit) return false;
		db.prepare('UPDATE request_rate_limits SET hit_count = hit_count + 1 WHERE identity_email = ? AND route_key = ?').run(identity, routeKey);
		return true;
	})();
}

export function applySecurityHeaders(response: Response, production = process.env.NODE_ENV === 'production'): Response {
	response.headers.set('Cache-Control', 'private, no-store');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
	response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
	if (production) {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
		response.headers.set('Content-Security-Policy', [
			"default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'",
			"form-action 'self'", "img-src 'self' data:", "font-src 'self' data:",
			"style-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline'",
			"connect-src 'self'", "worker-src 'self'", "manifest-src 'self'"
		].join('; '));
	}
	return response;
}
