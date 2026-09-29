/**
 * Chat route authorization (Phase 13, docs/spec/chat.md §9).
 *
 * The SvelteKit actions are invoked directly against an isolated database (set
 * before the app module loads), so every refusal below is exercised without
 * touching the development database or any preview data.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const databaseFile = path.join(
	os.tmpdir(),
	`minsnooks-chat-routes-${Date.now()}-${Math.random()}.db`
);
process.env.DATABASE_PATH = databaseFile;

const { getDb } = await import('../src/lib/server/db');
const { seedAll } = await import('../src/lib/server/seed');
const db = getDb();
seedAll(db);

const { actions: channelActions } = await import('../src/routes/chat/+page.server');
const { actions: directActions } = await import('../src/routes/chat/direct/+page.server');
const { actions: threadActions } = await import('../src/routes/chat/direct/[threadId]/+page.server');
const { actions: adminActions } = await import('../src/routes/admin/chat/+page.server');
const { GET: chatFeed } = await import('../src/routes/chat/feed/+server');
const { loadDirectThreads } = await import('../src/lib/server/chat');

const maya = db.prepare("SELECT id FROM players WHERE email = 'maya.chen@example.test'").get() as {
	id: number;
};
const leon = db.prepare("SELECT id FROM players WHERE email = 'leon.park@example.test'").get() as {
	id: number;
};

const mayaViewer = {
	playerId: maya.id,
	name: 'Maya Chen',
	initials: 'MC',
	tone: 'maya',
	email: 'maya.chen@example.test',
	role: 'player' as const,
	phone: null,
	contactVisible: true
};
const mayaThread = loadDirectThreads(db, mayaViewer).threads.find(
	(thread) => thread.partner.playerId === leon.id
)!;
const mayaMessage = db
	.prepare(
		`SELECT m.id FROM chat_messages m
		  JOIN chat_threads t ON t.id = m.thread_id
		 WHERE t.player_low_id = ? AND t.player_high_id = ? AND m.author_player_id = ?
		 ORDER BY m.id LIMIT 1`
	)
	.get(maya.id, leon.id, maya.id) as { id: number };
const openReport = db.prepare("SELECT id FROM chat_reports WHERE status = 'open' LIMIT 1").get() as {
	id: number;
};

afterAll(() => {
	try {
		db.close();
		for (const suffix of ['', '-wal', '-shm']) {
			fs.rmSync(`${databaseFile}${suffix}`, { force: true });
		}
	} catch {
		/* best effort */
	}
});

function post(action: string, values: Record<string, string> = {}): Request {
	const form = new FormData();
	for (const [key, value] of Object.entries(values)) form.append(key, value);
	return new Request(`http://localhost/chat?/${action}`, { method: 'POST', body: form });
}

describe('chat route role gates', () => {
	it('refuses every chat write for a visitor', async () => {
		const posts = [
			[channelActions.post, 'post', { body: 'Hello' }],
			[channelActions.delete, 'delete', { messageId: String(mayaMessage.id) }],
			[channelActions.report, 'report', { messageId: String(mayaMessage.id), reason: 'Testing' }],
			[directActions.start, 'start', { playerId: String(leon.id) }],
			[threadActions.post, 'post', { body: 'Hello' }]
		] as const;
		for (const [action, name, values] of posts) {
			const result = (await action({
				request: post(name, values),
				locals: { viewerEmail: null },
				params: { threadId: String(mayaThread.threadId) }
			} as never)) as { status?: number; data?: { message?: string } };
			expect(result.status, name).toBe(403);
			expect(result.data?.message, name).toMatch(/sign in/i);
		}
	});

	it('refuses a visitor at the polling endpoint', async () => {
		const response = await chatFeed({
			url: new URL('http://localhost/chat/feed?scope=channel'),
			locals: { viewerEmail: null }
		} as never);
		expect(response.status).toBe(401);
	});

	it('rejects an over-length message for a member without storing it', async () => {
		const result = (await channelActions.post({
			request: post('post', { body: 'x'.repeat(2001) }),
			locals: { viewerEmail: 'leon.park@example.test' }
		} as never)) as { status?: number; data?: { message?: string } };
		expect(result.status).toBe(400);
		expect(result.data?.message).toMatch(/limited to 2000/i);
	});

	it('hides a private thread from a non-participant at the action and the feed', async () => {
		const stranger = 'priya.desai@example.test';
		const postResult = (await threadActions.post({
			request: post('post', { body: 'Butting in' }),
			locals: { viewerEmail: stranger },
			params: { threadId: String(mayaThread.threadId) }
		} as never)) as { status?: number };
		expect(postResult.status).toBe(404);

		const response = await chatFeed({
			url: new URL(
				`http://localhost/chat/feed?scope=thread&threadId=${mayaThread.threadId}&after=0`
			),
			locals: { viewerEmail: stranger }
		} as never);
		expect(response.status).toBe(404);
	});

	it('refuses deletion by anyone but the author', async () => {
		const result = (await threadActions.delete({
			request: post('delete', { messageId: String(mayaMessage.id) }),
			locals: { viewerEmail: 'leon.park@example.test' },
			params: { threadId: String(mayaThread.threadId) }
		} as never)) as { status?: number; data?: { message?: string } };
		expect(result.status).toBe(403);
		expect(result.data?.message).toMatch(/author/i);
		const stillThere = db
			.prepare('SELECT deleted_at FROM chat_messages WHERE id = ?')
			.get(mayaMessage.id) as { deleted_at: string | null };
		expect(stillThere.deleted_at).toBeNull();
	});

	it('refuses self-messaging', async () => {
		const result = (await directActions.start({
			request: post('start', { playerId: String(maya.id) }),
			locals: { viewerEmail: 'maya.chen@example.test' }
		} as never)) as { status?: number; data?: { message?: string } };
		expect(result.status).toBe(400);
		expect(result.data?.message).toMatch(/yourself/i);
	});

	it('refuses chat moderation for a player and requires a valid decision from an admin', async () => {
		const playerResult = (await adminActions.review({
			request: post('review', {
				reportId: String(openReport.id),
				decision: 'hide',
				note: 'Let me decide'
			}),
			locals: { viewerEmail: 'leon.park@example.test' }
		} as never)) as { status?: number; data?: { message?: string } };
		expect(playerResult.status).toBe(403);
		expect(playerResult.data?.message).toMatch(/administrator/i);

		const missingDecision = (await adminActions.review({
			request: post('review', { reportId: String(openReport.id), note: 'Forgot the decision' }),
			locals: { viewerEmail: 'jules.rivera@example.test' }
		} as never)) as { status?: number };
		expect(missingDecision.status).toBe(400);

		const missingNote = (await adminActions.review({
			request: post('review', { reportId: String(openReport.id), decision: 'keep', note: '  ' }),
			locals: { viewerEmail: 'jules.rivera@example.test' }
		} as never)) as { status?: number };
		expect(missingNote.status).toBe(400);

		const stillOpen = db
			.prepare("SELECT COUNT(*) AS n FROM chat_reports WHERE status = 'open'")
			.get() as { n: number };
		expect(stillOpen.n).toBe(1);
	});
});
