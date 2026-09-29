import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

let fixtureInfo: { fixtureId: number; lowEmail: string; highEmail: string };
test.beforeAll(() => {
	const fixtureInfoPath = path.join(os.tmpdir(), 'minsnooks-phase15-smoke.json');
	fixtureInfo = JSON.parse(fs.readFileSync(fixtureInfoPath, 'utf8')) as typeof fixtureInfo;
});

async function signInAs(page: import('@playwright/test').Page, email: string) {
	await page.goto(`/?as=${encodeURIComponent(email)}`);
	await expect(page.locator('main')).toBeVisible();
}

test('player journey: fixtures are available and admin reports remain forbidden', async ({ page }) => {
	await signInAs(page, 'leon.park@example.test');
	await page.goto('/fixtures');
	await expect(page.getByRole('heading', { name: /fixtures/i }).first()).toBeVisible();
	const denied = await page.goto('/admin/settings');
	expect(denied?.status()).toBe(403);
});

test('opponent journey: submitted result can be reviewed without mutating it', async ({ page }) => {
	await signInAs(page, fixtureInfo.highEmail);
	await page.goto(`/fixtures/${fixtureInfo.fixtureId}/review`);
	await expect(page.getByRole('heading', { name: 'Check the result' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Confirm result & date' })).toBeVisible();
	await expect(page.getByText(/does not count|never does/i)).toBeVisible();
});

test('admin journey: dashboard, reports and future-only settings render', async ({ page }) => {
	await signInAs(page, 'maya.chen@example.test');
	await page.goto('/admin');
	await expect(page.getByRole('heading', { name: 'Admin dashboard' })).toBeVisible();
	await expect(page.getByText('Awaiting confirmation')).toBeVisible();
	await page.goto('/admin/reports');
	await expect(page.getByRole('heading', { name: 'League reports' })).toBeVisible();
	await expect(page.getByText('AWAITING CONFIRMATION', { exact: true })).toBeVisible();
	await page.goto('/admin/settings');
	await expect(page.getByRole('heading', { name: 'Set the defaults' })).toBeVisible();
	await expect(page.getByLabel('Round duration (days)')).toHaveValue('28');
	await expect(page.getByLabel('Grace period (days)')).toHaveValue('7');
});
