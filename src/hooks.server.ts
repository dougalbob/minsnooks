import type { Handle, HandleServerError } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getDb } from '$lib/server/db';
import { applySecurityHeaders, consumeWriteRateLimit } from '$lib/server/security';
import { dispatchPush } from '$lib/server/notifications';
import { runRoundLifecycle } from '$lib/server/lifecycle';
import {
	DEV_VIEWER_COOKIE,
	decideDevViewerEmail,
	devIdentitySwitchAllowed,
	resolveViewerEmail
} from '$lib/server/viewer';

const timerKey = '__minsnooksRoundLifecycleTimer' as const;
type LifecycleGlobal = typeof globalThis & { [timerKey]?: NodeJS.Timeout };
const lifecycleGlobal = globalThis as LifecycleGlobal;

// A process-level timer runs independently of page loads. The production app
// is intentionally a single Node instance, and the timer is unref'd so it does
// not keep a graceful shutdown alive. HMR reuses this global timer in dev.
if (process.env.NODE_ENV !== 'test' && !lifecycleGlobal[timerKey]) {
	const timer = setInterval(() => {
		try {
			const run = runRoundLifecycle(getDb(), { trigger: 'timer' });
			if (run.events.length > 0) {
				console.info(`[round-lifecycle] ${run.events.map((event) => event.message).join(' ')}`);
			}
			void dispatchPush(getDb(), { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT }).catch((error) => console.error('[push] worker failed', error));
		} catch (error) {
			console.error('[round-lifecycle] scheduler run failed', error);
		}
	}, 60_000);
	timer.unref();
	lifecycleGlobal[timerKey] = timer;
}

export const handle: Handle = async ({ event, resolve }) => {
	// Verified email only (dev identity or an Access JWT). Missing/unusable
	// configuration resolves to "no viewer"; Phase 8 hardens the Access path and
	// enforces roles on every write. A page load never changes league state.
	const ownEmail = await resolveViewerEmail(event.request, env);

	// Dev-only preview identity, so the two-sided Phase 6 journeys (record →
	// opponent review) can be clicked through in one browser. Ignored unless
	// AUTH_MODE=dev and not production; it can only select an existing player.
	const preview = decideDevViewerEmail(
		event.url.searchParams.get('as'),
		event.cookies.get(DEV_VIEWER_COOKIE),
		env
	);
	if (preview.setCookie !== null) {
		if (preview.setCookie === '') {
			event.cookies.delete(DEV_VIEWER_COOKIE, { path: '/' });
		} else {
			event.cookies.set(DEV_VIEWER_COOKIE, preview.setCookie, {
				path: '/',
				sameSite: 'lax',
				maxAge: 60 * 60 * 12
			});
		}
	}

	event.locals.viewerEmail = preview.email ?? ownEmail;
	event.locals.viewerIsPreview = preview.email !== null;
	event.locals.devIdentitySwitch = devIdentitySwitchAllowed(env);
	if (event.request.method === 'POST' && event.locals.viewerEmail) {
		const allowed = consumeWriteRateLimit(getDb(), event.locals.viewerEmail, event.url.pathname);
		if (!allowed) {
			const limited = new Response('Too many write requests. Please wait a minute and try again.', {
				status: 429,
				headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60' }
			});
			return applySecurityHeaders(limited);
		}
	}
	const response = await resolve(event);
	// Member and public responses share one origin; never cache HTML or API
	// responses, and apply the production CSP/security baseline consistently.
	return applySecurityHeaders(response);
};

export const handleError: HandleServerError = ({ error, event, status, message }) => {
	const incidentId = crypto.randomUUID();
	// Keep details in server logs only. Do not echo stack traces or SQLite/JWT
	// diagnostics back to a browser response.
	console.error(`[request-error:${incidentId}] ${event.request.method} ${event.url.pathname} (${status})`, error);
	return { message: status >= 500 ? 'An unexpected server error occurred.' : message, incidentId };
};
