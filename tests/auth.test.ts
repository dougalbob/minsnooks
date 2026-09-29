import { beforeAll, describe, expect, it } from 'vitest';
import {
	generateKeyPair,
	exportJWK,
	SignJWT,
	createLocalJWKSet,
	type GenerateKeyPairResult
} from 'jose';
import {
	AuthConfigError,
	getIdentity,
	isEmailAllowed,
	loadAuthConfig,
	verifyAccessJwt,
	type AuthConfig
} from '../src/lib/server/auth';
import { decideDevViewerEmail, devIdentitySwitchAllowed } from '../src/lib/server/viewer';

describe('loadAuthConfig', () => {
	it('fails closed when AUTH_MODE is missing or invalid', () => {
		expect(() => loadAuthConfig({})).toThrow(AuthConfigError);
		expect(() => loadAuthConfig({ AUTH_MODE: 'maybe' })).toThrow(AuthConfigError);
	});

	it('never allows the dev identity in production (env or process.env)', () => {
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

describe('Cloudflare Access cryptographic JWT verification', () => {
	let keyPair: GenerateKeyPairResult;
	let attackerKeyPair: GenerateKeyPairResult;
	let jwks: ReturnType<typeof createLocalJWKSet>;

	const accessConfig: AuthConfig = {
		mode: 'access',
		teamDomain: 'minsnooks.cloudflareaccess.com',
		audience: 'minsnooks-aud-tag',
		allowlist: ['alice@example.test', 'bob@example.test'],
		devEmail: '',
		isProduction: true
	};

	beforeAll(async () => {
		keyPair = await generateKeyPair('RS256');
		attackerKeyPair = await generateKeyPair('RS256');
		const publicJwk = await exportJWK(keyPair.publicKey);
		publicJwk.kid = 'key-1';
		publicJwk.alg = 'RS256';
		jwks = createLocalJWKSet({ keys: [publicJwk] });
	});

	it('validates a cryptographically signed token with matching claims and allowlist', async () => {
		const token = await new SignJWT({ email: 'alice@example.test' })
			.setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
			.setIssuer('https://minsnooks.cloudflareaccess.com')
			.setAudience('minsnooks-aud-tag')
			.setSubject('sub-1234')
			.setIssuedAt()
			.setExpirationTime('1h')
			.sign(keyPair.privateKey);

		const identity = await verifyAccessJwt(token, accessConfig, { keySource: jwks });
		expect(identity).toEqual({
			sub: 'sub-1234',
			email: 'alice@example.test'
		});
	});

	it('normalises email case from JWT payload', async () => {
		const token = await new SignJWT({ email: 'ALICE@EXAMPLE.TEST' })
			.setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
			.setIssuer('https://minsnooks.cloudflareaccess.com')
			.setAudience('minsnooks-aud-tag')
			.setSubject('sub-alice')
			.setExpirationTime('1h')
			.sign(keyPair.privateKey);

		const identity = await verifyAccessJwt(token, accessConfig, { keySource: jwks });
		expect(identity?.email).toBe('alice@example.test');
	});

	it('rejects an invalid signature signed with an untrusted key', async () => {
		const token = await new SignJWT({ email: 'alice@example.test' })
			.setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
			.setIssuer('https://minsnooks.cloudflareaccess.com')
			.setAudience('minsnooks-aud-tag')
			.setSubject('sub-1234')
			.setExpirationTime('1h')
			.sign(attackerKeyPair.privateKey);

		const identity = await verifyAccessJwt(token, accessConfig, { keySource: jwks });
		expect(identity).toBeNull();
	});

	it('rejects an expired token', async () => {
		const past = Math.floor(Date.now() / 1000) - 120;
		const token = await new SignJWT({ email: 'alice@example.test' })
			.setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
			.setIssuer('https://minsnooks.cloudflareaccess.com')
			.setAudience('minsnooks-aud-tag')
			.setSubject('sub-1234')
			.setIssuedAt(past - 3600)
			.setExpirationTime(past)
			.sign(keyPair.privateKey);

		const identity = await verifyAccessJwt(token, accessConfig, { keySource: jwks });
		expect(identity).toBeNull();
	});

	it('rejects a token not yet valid (nbf in future)', async () => {
		const future = Math.floor(Date.now() / 1000) + 3600;
		const token = await new SignJWT({ email: 'alice@example.test' })
			.setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
			.setIssuer('https://minsnooks.cloudflareaccess.com')
			.setAudience('minsnooks-aud-tag')
			.setSubject('sub-1234')
			.setNotBefore(future)
			.setExpirationTime(future + 3600)
			.sign(keyPair.privateKey);

		const identity = await verifyAccessJwt(token, accessConfig, { keySource: jwks });
		expect(identity).toBeNull();
	});

	it('rejects a token with mismatched audience', async () => {
		const token = await new SignJWT({ email: 'alice@example.test' })
			.setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
			.setIssuer('https://minsnooks.cloudflareaccess.com')
			.setAudience('wrong-audience-tag')
			.setSubject('sub-1234')
			.setExpirationTime('1h')
			.sign(keyPair.privateKey);

		const identity = await verifyAccessJwt(token, accessConfig, { keySource: jwks });
		expect(identity).toBeNull();
	});

	it('rejects a token with mismatched issuer', async () => {
		const token = await new SignJWT({ email: 'alice@example.test' })
			.setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
			.setIssuer('https://attacker.cloudflareaccess.com')
			.setAudience('minsnooks-aud-tag')
			.setSubject('sub-1234')
			.setExpirationTime('1h')
			.sign(keyPair.privateKey);

		const identity = await verifyAccessJwt(token, accessConfig, { keySource: jwks });
		expect(identity).toBeNull();
	});

	it('rejects a token whose email is not on the allowlist', async () => {
		const token = await new SignJWT({ email: 'mallory@example.test' })
			.setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
			.setIssuer('https://minsnooks.cloudflareaccess.com')
			.setAudience('minsnooks-aud-tag')
			.setSubject('sub-mallory')
			.setExpirationTime('1h')
			.sign(keyPair.privateKey);

		const identity = await verifyAccessJwt(token, accessConfig, { keySource: jwks });
		expect(identity).toBeNull();
	});

	it('rejects a token missing an email claim', async () => {
		const token = await new SignJWT({ custom: 'no-email' })
			.setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
			.setIssuer('https://minsnooks.cloudflareaccess.com')
			.setAudience('minsnooks-aud-tag')
			.setSubject('sub-no-email')
			.setExpirationTime('1h')
			.sign(keyPair.privateKey);

		const identity = await verifyAccessJwt(token, accessConfig, { keySource: jwks });
		expect(identity).toBeNull();
	});

	it('getIdentity extracts token from cf-access-jwt-assertion header', async () => {
		const token = await new SignJWT({ email: 'bob@example.test' })
			.setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
			.setIssuer('https://minsnooks.cloudflareaccess.com')
			.setAudience('minsnooks-aud-tag')
			.setSubject('sub-bob')
			.setExpirationTime('1h')
			.sign(keyPair.privateKey);

		const request = new Request('https://league.example.test/', {
			headers: { 'cf-access-jwt-assertion': token }
		});

		const env = {
			AUTH_MODE: 'access',
			CF_TEAM_DOMAIN: 'minsnooks.cloudflareaccess.com',
			CF_AUD: 'minsnooks-aud-tag',
			ACCESS_EMAIL_ALLOWLIST: 'bob@example.test'
		};

		const identity = await getIdentity(request, env, { keySource: jwks });
		expect(identity).toEqual({
			sub: 'sub-bob',
			email: 'bob@example.test'
		});
	});

	it('getIdentity returns null when cf-access-jwt-assertion header is missing in access mode', async () => {
		const request = new Request('https://league.example.test/');
		const env = {
			AUTH_MODE: 'access',
			CF_TEAM_DOMAIN: 'minsnooks.cloudflareaccess.com',
			CF_AUD: 'minsnooks-aud-tag',
			ACCESS_EMAIL_ALLOWLIST: 'bob@example.test'
		};

		const identity = await getIdentity(request, env, { keySource: jwks });
		expect(identity).toBeNull();
	});

	it('dev bypass is strictly impossible in production configuration', async () => {
		const request = new Request('https://league.example.test/');
		const prodEnv = {
			AUTH_MODE: 'dev',
			NODE_ENV: 'production',
			DEV_USER_EMAIL: 'maya.chen@example.test'
		};

		await expect(getIdentity(request, prodEnv)).rejects.toThrow(AuthConfigError);
		expect(devIdentitySwitchAllowed(prodEnv)).toBe(false);
		expect(decideDevViewerEmail('maya.chen@example.test', null, prodEnv)).toEqual({
			email: null,
			setCookie: null
		});
	});
});
