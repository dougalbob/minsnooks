import { describe, expect, it } from 'vitest';
import { getDb } from '../src/lib/server/db';
import { seedAll } from '../src/lib/server/seed';
import { actions as knockoutActions } from '../src/routes/knockout/+page.server';

const db = getDb();
seedAll(db);

function post(action: string, values: Record<string, string> = {}): Request {
	const form = new FormData();
	for (const [key, value] of Object.entries(values)) form.append(key, value);
	return new Request(`http://localhost/knockout?/${action}`, { method: 'POST', body: form });
}

describe('Knockout route role gates', () => {
	it('rejects invitation creation for a regular player before reading or writing form state', async () => {
		const result = (await knockoutActions.announce({
			request: post('announce', { title: 'Not allowed' }),
			locals: { viewerEmail: 'leon.park@example.test' }
		} as any)) as any;
		expect(result.status).toBe(403);
		expect(result.data.message).toMatch(/administrator/i);
	});

	it('rejects opt-in by a visitor and selection, swap, or draw actions by a player', async () => {
		const visitor = (await knockoutActions.respond({
			request: post('respond', { competitionId: '1', optedIn: 'true' }),
			locals: { viewerEmail: null }
		} as any)) as any;
		expect(visitor.status).toBe(403);

		for (const [name, action] of [
			['finalise', knockoutActions.finalise],
			['swap', knockoutActions.swap],
			['draw', knockoutActions.draw]
		] as const) {
			const result = (await action({
				request: post(name, { competitionId: '1' }),
				locals: { viewerEmail: 'leon.park@example.test' }
			} as any)) as any;
			expect(result.status, name).toBe(403);
		}
	});
});
