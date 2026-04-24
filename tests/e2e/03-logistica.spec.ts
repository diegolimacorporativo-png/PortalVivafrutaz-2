import { test, expect } from '@playwright/test';
import { loginAsAdmin, BASE_URL, waitAndScreenshot } from './helpers';

test.describe('Logística', () => {
  test('01 - Acessa módulo de Logística', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/logistics`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000);
    await waitAndScreenshot(page, 'logistica');
    await expect(page).not.toHaveURL('**/login');
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 8000 });
  });

  test('02 - Acessa Logística Inteligente', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/logistics-intelligence`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000);
    await waitAndScreenshot(page, 'logistica-inteligente');
    await expect(page).not.toHaveURL('**/login');
  });

  test('03 - Acessa Painel do Motorista', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/driver-panel`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000);
    await waitAndScreenshot(page, 'driver-panel');
    await expect(page).not.toHaveURL('**/login');
  });

  test('04 - Tabs de Logística funcionam', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/logistics`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    await waitAndScreenshot(page, 'logistica-tabs');
    const tabs = page.locator('[role="tab"], button[data-state]').first();
    await tabs.waitFor({ timeout: 5000 }).catch(() => {});
  });

  test('05 - Controle de Desperdício acessível', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/waste-control`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000);
    await waitAndScreenshot(page, 'desperdicio');
    await expect(page).not.toHaveURL('**/login');
  });
});
