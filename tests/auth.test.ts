import { describe, expect, it } from 'vitest';
import { AuthConfigError, isEmailAllowed, loadAuthConfig } from '../src/lib/server/auth';

describe('loadAuthConfig', () => {
	it('fails closed when AUTH_MODE is missing or invalid', () => {
		expect(() => loadAuthConfig({})).toThrow(AuthConfigError);
		expect(() => loadAuthConfig({ AUTH_MODE: 'maybe' })).toThrow(AuthConfigError);
	});

	it('never allows the dev identity in production', () => {
		expect(() =>
			loadAuthConfig({
				AUTH_MODE: 'dev',
				NODE_ENV: 'production',
				DEV_USER_EMAIL: 'maya.chen@example.test'
			})
		).toThrow(/never allowed in production/);
	});

	it('fails closed when access mode is missing team, audience or allowlist', () => {
		expect(() => loadAuthConfig({ AUTH_MODE: 'access' })).toThrow(/CF_TEAM_DOMAIN/);
		expect(() =>
			loadAuthConfig({ AUTH_MODE: 'access', CF_TEAM_DOMAIN: 'team.cloudflareaccess.com' })
		).toThrow(/CF_AUD/);
		expect(() =>
			loadAuthConfig({
				AUTH_MODE: 'access',
				CF_TEAM_DOMAIN: 'team.cloudflareaccess.com',
				CF_AUD: 'aud-tag'
			})
		).toThrow(/ACCESS_EMAIL_ALLOWLIST/);
	});

	it('accepts a complete access config and normalises the team domain', () => {
		const config = loadAuthConfig({
			AUTH_MODE: 'access',
			CF_TEAM_DOMAIN: 'https://team.cloudflareaccess.com/',
			CF_AUD: 'aud-tag',
			ACCESS_EMAIL_ALLOWLIST: ' Alice@Example.com , bob@example.com '
		});
		expect(config.mode).toBe('access');
		expect(config.teamDomain).toBe('team.cloudflareaccess.com');
		expect(config.allowlist).toEqual(['alice@example.com', 'bob@example.com']);
	});

	it('requires a dev email in dev mode and honours the allowlist', () => {
		expect(() => loadAuthConfig({ AUTH_MODE: 'dev' })).toThrow(/DEV_USER_EMAIL/);
		expect(() =>
			loadAuthConfig({
				AUTH_MODE: 'dev',
				DEV_USER_EMAIL: 'maya.chen@example.test',
				ACCESS_EMAIL_ALLOWLIST: 'someone.else@example.test'
			})
		).toThrow(/must be in ACCESS_EMAIL_ALLOWLIST/);
		const config = loadAuthConfig({
			AUTH_MODE: 'dev',
			DEV_USER_EMAIL: 'maya.chen@example.test'
		});
		expect(config.devEmail).toBe('maya.chen@example.test');
	});
});

describe('isEmailAllowed', () => {
	const config = loadAuthConfig({
		AUTH_MODE: 'access',
		CF_TEAM_DOMAIN: 'team.cloudflareaccess.com',
		CF_AUD: 'aud-tag',
		ACCESS_EMAIL_ALLOWLIST: 'alice@example.com'
	});

	it('enforces the explicit allowlist', () => {
		expect(isEmailAllowed('alice@example.com', config)).toBe(true);
		expect(isEmailAllowed('ALICE@example.com', config)).toBe(true);
		expect(isEmailAllowed('mallory@example.com', config)).toBe(false);
	});
});
