import { describe, expect, it } from 'vitest';
import { decideDevViewerEmail, devIdentitySwitchAllowed } from '../src/lib/server/viewer';

const devEnv = { AUTH_MODE: 'dev', DEV_USER_EMAIL: 'maya@example.test', NODE_ENV: 'development' };

describe('development preview identity switch', () => {
	it('applies a chosen player and persists the choice in the cookie', () => {
		expect(decideDevViewerEmail('jules@example.test', null, devEnv)).toEqual({
			email: 'jules@example.test', setCookie: 'jules@example.test'
		});
		expect(decideDevViewerEmail(null, 'jules@example.test', devEnv)).toEqual({
			email: 'jules@example.test', setCookie: null
		});
	});

	it('clears the preview choice back to the configured dev identity and supports nobody', () => {
		expect(decideDevViewerEmail('none', 'jules@example.test', devEnv)).toEqual({ email: null, setCookie: '' });
		expect(decideDevViewerEmail('nobody', null, devEnv)).toEqual({ email: 'nobody', setCookie: 'nobody' });
	});

	it('fails closed in production and when dev identity is not explicitly configured', () => {
		expect(devIdentitySwitchAllowed({ ...devEnv, NODE_ENV: 'production' })).toBe(false);
		expect(decideDevViewerEmail('jules@example.test', null, { ...devEnv, NODE_ENV: 'production' })).toEqual({ email: null, setCookie: null });
		expect(devIdentitySwitchAllowed({ DEV_USER_EMAIL: 'maya@example.test' })).toBe(false);
	});
});
