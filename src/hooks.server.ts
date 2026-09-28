import type { Handle } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { runRoundLifecycle } from '$lib/server/lifecycle';

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
		} catch (error) {
			console.error('[round-lifecycle] scheduler run failed', error);
		}
	}, 60_000);
	timer.unref();
	lifecycleGlobal[timerKey] = timer;
}

export const handle: Handle = async ({ event, resolve }) => resolve(event);
