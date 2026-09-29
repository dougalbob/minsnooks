import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const databasePath = path.join(os.tmpdir(), 'minsnooks-phase15-smoke.db');
const fixtureInfo = path.join(os.tmpdir(), 'minsnooks-phase15-smoke.json');
process.env.DATABASE_PATH = databasePath;
process.env.SMOKE_FIXTURE_INFO = fixtureInfo;

export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	workers: 1,
	reporter: 'list',
	use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
	webServer: {
		command: 'npm exec tsx scripts/prepare-smoke.ts && npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			...process.env,
			DATABASE_PATH: databasePath,
			SMOKE_FIXTURE_INFO: fixtureInfo,
			AUTH_MODE: 'dev',
			DEV_USER_EMAIL: 'maya.chen@example.test',
			NODE_ENV: 'development'
		}
	},
	globalTeardown: './e2e/global-teardown.ts'
});
