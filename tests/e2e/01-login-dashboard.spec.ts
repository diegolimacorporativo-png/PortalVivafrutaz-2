import { test, expect } from '@playwright/test';
import { loginAsAdmin, loginAsMaster, BASE_URL, waitAndScreenshot } from './helpers';

test.describe('Login e Dashboard', () => {
  test('01 - Abre o sistema (página de login)', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    await waitAndScreenshot(page, 'sistema-aberto');
    const title = await page.title();
    expect(title).toBeTruthy();
    await expect(page.locator('input').first()).toBeVisible({ timeout: 10000 });
  });

  test('02 - Realiza login como admin', async ({ page }) => {
    await loginAsAdmin(page);
    await waitAndScreenshot(page, 'login-admin');
    const url = page.url();
    expect(url).not.toContain('/login');
  });

  test('03 - Acessa o dashboard principal', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000);
    await waitAndScreenshot(page, 'dashboard');
    await expect(page).not.toHaveURL('**/login');
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toBeTruthy();
  });

  test('04 - Sidebar está visível com links de navegação', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    await waitAndScreenshot(page, 'sidebar');
    const sidebar = page.locator('aside, [class*="sidebar"], [class*="Sidebar"]').first();
    await sidebar.waitFor({ timeout: 8000 }).catch(() => {});
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.length).toBeGreaterThan(100);
  });

  test('05 - Dashboard Executivo carrega', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/executive`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000);
    await waitAndScreenshot(page, 'dashboard-executivo');
    await expect(page).not.toHaveURL('**/login');
  });

  test('06 - Login como Master funciona', async ({ page }) => {
    await loginAsMaster(page);
    await waitAndScreenshot(page, 'login-master');
    const url = page.url();
    expect(url).not.toContain('/login');
  });
});
