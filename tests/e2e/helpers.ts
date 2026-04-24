import { Page } from '@playwright/test';

export const ADMIN_USERNAME = 'admin';
export const ADMIN_PASSWORD = '123456';
export const MASTER_USERNAME = 'master';
export const MASTER_PASSWORD = 'Master@2026!';
export const BASE_URL = 'http://localhost:5000';

export async function loginAsAdmin(page: Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('load');
  await page.waitForTimeout(1000);
  const adminTab = page.locator('[data-testid="tab-admin"]');
  const adminTabVisible = await adminTab.isVisible().catch(() => false);
  if (adminTabVisible) {
    await adminTab.click();
    await page.waitForTimeout(500);
  }
  const usernameInput = page.locator('[data-testid="input-username"]');
  await usernameInput.waitFor({ timeout: 8000 });
  await usernameInput.fill(ADMIN_USERNAME);
  await page.locator('[data-testid="input-password"]').fill(ADMIN_PASSWORD);
  await page.locator('[data-testid="button-login"]').click();
  await page.waitForTimeout(2500);
  await page.waitForLoadState('load');
}

export async function loginAsMaster(page: Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('load');
  await page.waitForTimeout(1000);
  const adminTab = page.locator('[data-testid="tab-admin"]');
  const adminTabVisible = await adminTab.isVisible().catch(() => false);
  if (adminTabVisible) {
    await adminTab.click();
    await page.waitForTimeout(500);
  }
  const usernameInput = page.locator('[data-testid="input-username"]');
  await usernameInput.waitFor({ timeout: 8000 });
  await usernameInput.fill(MASTER_USERNAME);
  await page.locator('[data-testid="input-password"]').fill(MASTER_PASSWORD);
  await page.locator('[data-testid="button-login"]').click();
  await page.waitForTimeout(2500);
  await page.waitForLoadState('load');
}

export async function waitAndScreenshot(page: Page, _name: string) {
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(500);
}
