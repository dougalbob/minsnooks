import { describe, expect, it } from 'vitest';
import { actions as adminRoundActions } from '../src/routes/admin/rounds/+page.server';
import { actions as adminAwardActions } from '../src/routes/admin/awards/+page.server';
import { actions as profileActions } from '../src/routes/profile/+page.server';
import { getDb } from '../src/lib/server/db';
import { seedAll } from '../src/lib/server/seed';

describe('Server-side Role Gates on Write Paths', () => {
	const db = getDb();
	seedAll(db);

	it('rejects round scheduler execution for regular players and unauthenticated visitors with 403', async () => {
		const playerLocals = {
			viewerEmail: 'leon.park@example.test',
			viewerIsPreview: false,
			devIdentitySwitch: true
		};
		const visitorLocals = {
			viewerEmail: null,
			viewerIsPreview: false,
			devIdentitySwitch: true
		};

		const playerRequest = new Request('http://localhost/admin/rounds?/runScheduler', {
			method: 'POST',
			body: new FormData()
		});
		const resultPlayer = (await adminRoundActions.runScheduler({
			request: playerRequest,
			locals: playerLocals
		} as any)) as any;
		expect(resultPlayer.status).toBe(403);
		expect(resultPlayer.data.message).toMatch(/Administrator privileges/);

		const visitorRequest = new Request('http://localhost/admin/rounds?/runScheduler', {
			method: 'POST',
			body: new FormData()
		});
		const resultVisitor = (await adminRoundActions.runScheduler({
			request: visitorRequest,
			locals: visitorLocals
		} as any)) as any;
		expect(resultVisitor.status).toBe(403);
	});

	it('rejects markFinal for regular players with 403', async () => {
		const form = new FormData();
		form.append('roundId', '6');
		form.append('isFinal', 'true');
		const request = new Request('http://localhost/admin/rounds?/markFinal', {
			method: 'POST',
			body: form
		});
		const result = (await adminRoundActions.markFinal({
			request,
			locals: { viewerEmail: 'leon.park@example.test' }
		} as any)) as any;
		expect(result.status).toBe(403);
	});

	it('rejects openRound for regular players with 403', async () => {
		const form = new FormData();
		form.append('deadlineDate', '2026-11-01');
		form.append('graceDays', '7');
		form.append('playerIds', '1');
		form.append('playerIds', '2');
		const request = new Request('http://localhost/admin/rounds?/openRound', {
			method: 'POST',
			body: form
		});
		const result = (await adminRoundActions.openRound({
			request,
			locals: { viewerEmail: 'leon.park@example.test' }
		} as any)) as any;
		expect(result.status).toBe(403);
	});

	it('rejects createSeason for regular players and for admin (reserved for super-admin)', async () => {
		const form = new FormData();
		form.append('label', '2027');
		form.append('framesPerMatch', '3');
		form.append('pointsPerFrame', '1');
		form.append('matchWinBonus', '0');
		const request = new Request('http://localhost/admin/rounds?/createSeason', {
			method: 'POST',
			body: form
		});

		// Player rejected with 403
		const playerResult = (await adminRoundActions.createSeason({
			request,
			locals: { viewerEmail: 'leon.park@example.test' }
		} as any)) as any;
		expect(playerResult.status).toBe(403);

		// Admin rejected with 403 (requires super_admin)
		const adminResult = (await adminRoundActions.createSeason({
			request,
			locals: { viewerEmail: 'jules.rivera@example.test' } // Jules is admin
		} as any)) as any;
		expect(adminResult.status).toBe(403);
		expect(adminResult.data.message).toMatch(/super-admin/i);
	});

	it('rejects withdrawPlayer on awards screen for regular players with 403', async () => {
		const form = new FormData();
		form.append('playerId', '6');
		const request = new Request('http://localhost/admin/awards?/withdrawPlayer', {
			method: 'POST',
			body: form
		});
		const result = (await adminAwardActions.withdrawPlayer({
			request,
			locals: { viewerEmail: 'leon.park@example.test' }
		} as any)) as any;
		expect(result.status).toBe(403);
	});

	it('rejects award review for regular players with 403', async () => {
		const form = new FormData();
		form.append('awardId', '1');
		form.append('decision', 'keep');
		const request = new Request('http://localhost/admin/awards?/reviewAward', {
			method: 'POST',
			body: form
		});
		const result = (await adminAwardActions.reviewAward({
			request,
			locals: { viewerEmail: 'leon.park@example.test' }
		} as any)) as any;
		expect(result.status).toBe(403);
	});

	it('allows admin and super-admin to run scheduler', async () => {
		const requestAdmin = new Request('http://localhost/admin/rounds?/runScheduler', {
			method: 'POST',
			body: new FormData()
		});
		const resultAdmin = (await adminRoundActions.runScheduler({
			request: requestAdmin,
			locals: { viewerEmail: 'jules.rivera@example.test' } // Jules is admin
		} as any)) as any;
		expect(resultAdmin).toHaveProperty('message');

		const requestSuper = new Request('http://localhost/admin/rounds?/runScheduler', {
			method: 'POST',
			body: new FormData()
		});
		const resultSuper = (await adminRoundActions.runScheduler({
			request: requestSuper,
			locals: { viewerEmail: 'maya.chen@example.test' } // Maya is super_admin
		} as any)) as any;
		expect(resultSuper).toHaveProperty('message');
	});

	it('enforces profile update role gates and persists contact visibility', async () => {
		// Visitor cannot update profile
		const visitorForm = new FormData();
		visitorForm.append('contactVisible', '0');
		const visitorReq = new Request('http://localhost/profile?/updateProfile', {
			method: 'POST',
			body: visitorForm
		});
		const visitorResult = (await profileActions.updateProfile({
			request: visitorReq,
			locals: { viewerEmail: null }
		} as any)) as any;
		expect(visitorResult.status).toBe(403);

		// Leon Park (player) updates own contact visibility to hidden
		const leonForm = new FormData();
		leonForm.append('contactVisible', '0');
		leonForm.append('phone', '07700 999888');
		const leonReq = new Request('http://localhost/profile?/updateProfile', {
			method: 'POST',
			body: leonForm
		});
		const leonResult = (await profileActions.updateProfile({
			request: leonReq,
			locals: { viewerEmail: 'leon.park@example.test' }
		} as any)) as any;
		expect(leonResult.success).toBe(true);

		const updatedRow = db
			.prepare('SELECT contact_visible, phone FROM players WHERE email = ?')
			.get('leon.park@example.test') as { contact_visible: number; phone: string | null };
		expect(updatedRow.contact_visible).toBe(0);
		expect(updatedRow.phone).toBe('07700 999888');

		// Audit record written
		const audit = db
			.prepare(
				"SELECT * FROM audit_log WHERE entity_type = 'player' AND action = 'profile_updated' ORDER BY id DESC LIMIT 1"
			)
			.get() as { actor_player_id: number; detail: string };
		expect(audit.actor_player_id).toBe(2); // Leon Park is id 2
		expect(audit.detail).toContain('"contact_visible":0');
	});
});
