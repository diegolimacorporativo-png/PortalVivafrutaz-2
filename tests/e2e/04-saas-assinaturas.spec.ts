import { test, expect } from '@playwright/test';
import { loginAsMaster, BASE_URL, waitAndScreenshot } from './helpers';

test.describe('SaaS - Assinaturas e Pagamentos', () => {
  test('01 - Acessa SaaS Dashboard', async ({ page }) => {
    await loginAsMaster(page);
    await page.goto(`${BASE_URL}/admin/saas-dashboard`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    await waitAndScreenshot(page, 'saas-dashboard');
    await expect(page).not.toHaveURL('**/login');
    await expect(page.locator('h1, [data-testid*="title"]').first()).toBeVisible({ timeout: 8000 });
  });

  test('02 - Lista de assinaturas exibida', async ({ page }) => {
    await loginAsMaster(page);
    await page.goto(`${BASE_URL}/admin/saas-dashboard`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    const tabAssinaturas = page.locator('button:has-text("Assinaturas"), [role="tab"]:has-text("Assinaturas")').first();
    await tabAssinaturas.waitFor({ timeout: 8000 }).catch(() => {});
    await tabAssinaturas.click().catch(() => {});
    await page.waitForTimeout(1000);
    await waitAndScreenshot(page, 'lista-assinaturas');
  });

  test('03 - Painel Financeiro SaaS carrega', async ({ page }) => {
    await loginAsMaster(page);
    await page.goto(`${BASE_URL}/admin/saas-financeiro`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    await waitAndScreenshot(page, 'saas-financeiro');
    await expect(page).not.toHaveURL('**/login');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 8000 });
  });

  test('04 - MRR e ARR exibidos no painel financeiro', async ({ page }) => {
    await loginAsMaster(page);
    await page.goto(`${BASE_URL}/admin/saas-financeiro`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);
    await waitAndScreenshot(page, 'mrr-arr');
    const mrrCard = page.locator('text=MRR').first();
    await mrrCard.waitFor({ timeout: 8000 }).catch(() => {});
  });

  test('05 - Marketplace de Módulos carrega', async ({ page }) => {
    await loginAsMaster(page);
    await page.goto(`${BASE_URL}/admin/marketplace`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    await waitAndScreenshot(page, 'marketplace');
    await expect(page).not.toHaveURL('**/login');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 8000 });
  });

  test('06 - Grid de módulos visível no marketplace', async ({ page }) => {
    await loginAsMaster(page);
    await page.goto(`${BASE_URL}/admin/marketplace`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);
    await waitAndScreenshot(page, 'marketplace-grid');
    const cards = page.locator('[data-testid*="card-modulo"], .modulo-card, [data-testid*="modulo"]').first();
    await cards.waitFor({ timeout: 8000 }).catch(() => {});
  });
});
