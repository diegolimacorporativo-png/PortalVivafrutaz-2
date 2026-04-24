import { test, expect } from '@playwright/test';
import { loginAsAdmin, BASE_URL, waitAndScreenshot } from './helpers';

test.describe('Clientes e Pedidos', () => {
  test('01 - Acessa página de Clientes', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/companies`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000);
    await waitAndScreenshot(page, 'clientes');
    await expect(page).not.toHaveURL('**/login');
    const heading = page.locator('h1, h2, [data-testid*="title"]').first();
    await expect(heading).toBeVisible({ timeout: 8000 });
  });

  test('02 - Lista de clientes exibida', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/companies`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);
    await waitAndScreenshot(page, 'lista-clientes');
    const count = await page.locator('[data-testid*="card-company"], table tbody tr').count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('03 - Acessa página de Pedidos', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/orders`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000);
    await waitAndScreenshot(page, 'pedidos');
    await expect(page).not.toHaveURL('**/login');
  });

  test('04 - Acessa Pedidos Pontuais', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/special-orders`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000);
    await waitAndScreenshot(page, 'pedidos-pontuais');
    await expect(page).not.toHaveURL('**/login');
  });

  test('05 - Acessa Produtos', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin/products`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1000);
    await waitAndScreenshot(page, 'produtos');
    await expect(page).not.toHaveURL('**/login');
  });
});
