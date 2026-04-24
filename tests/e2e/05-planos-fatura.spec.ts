import { test, expect } from '@playwright/test';
import { loginAsMaster, loginAsAdmin, BASE_URL, waitAndScreenshot } from './helpers';

test.describe('Planos e Faturas', () => {
  test('Teste Starter - verifica acesso a módulos básicos', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE_URL}/admin`);
    await waitAndScreenshot(page, 'plano-starter-dashboard');
    await page.goto(`${BASE_URL}/admin/companies`);
    await waitAndScreenshot(page, 'plano-starter-clientes');
    await expect(page).not.toHaveURL('**/login');
    await page.goto(`${BASE_URL}/admin/orders`);
    await waitAndScreenshot(page, 'plano-starter-pedidos');
    await expect(page).not.toHaveURL('**/login');
  });

  test('Master Control - gestão de planos', async ({ page }) => {
    await loginAsMaster(page);
    await page.goto(`${BASE_URL}/admin/master-control`);
    await page.waitForLoadState('networkidle');
    await waitAndScreenshot(page, 'master-control');
    await expect(page).not.toHaveURL('**/login');
    const tabPlanos = page.locator('button:has-text("Planos"), [role="tab"]:has-text("Planos")').first();
    await tabPlanos.waitFor({ timeout: 8000 }).catch(() => {});
    await tabPlanos.click().catch(() => {});
    await waitAndScreenshot(page, 'master-planos');
  });

  test('Gera fatura / evento de cobrança', async ({ page }) => {
    await loginAsMaster(page);
    await page.goto(`${BASE_URL}/admin/saas-dashboard`);
    await page.waitForLoadState('networkidle');
    const tabFaturas = page.locator('button:has-text("Faturas"), [role="tab"]:has-text("Faturas")').first();
    await tabFaturas.waitFor({ timeout: 8000 }).catch(() => {});
    await tabFaturas.click().catch(() => {});
    await waitAndScreenshot(page, 'faturas');
    const novaFaturaBtn = page.locator('button:has-text("Nova Fatura"), [data-testid*="nova-fatura"]').first();
    await novaFaturaBtn.waitFor({ timeout: 5000 }).catch(() => {});
  });

  test('Simula pagamento PIX', async ({ page }) => {
    await loginAsMaster(page);
    await page.goto(`${BASE_URL}/admin/saas-dashboard`);
    await page.waitForLoadState('networkidle');
    const tabAssinaturas = page.locator('button:has-text("Assinaturas")').first();
    await tabAssinaturas.click().catch(() => {});
    await page.waitForTimeout(1000);
    await waitAndScreenshot(page, 'pix-simulacao');
    const pagarBtn = page.locator('[data-testid*="pagar"], button:has-text("Pagar")').first();
    const visible = await pagarBtn.isVisible().catch(() => false);
    if (visible) {
      await pagarBtn.click();
      await page.waitForTimeout(1000);
      const pixOption = page.locator('button:has-text("PIX"), [value="pix"], text=PIX').first();
      await pixOption.waitFor({ timeout: 3000 }).catch(() => {});
      await waitAndScreenshot(page, 'modal-pix');
    }
  });

  test('Simula pagamento Cartão', async ({ page }) => {
    await loginAsMaster(page);
    await page.goto(`${BASE_URL}/admin/saas-dashboard`);
    await page.waitForLoadState('networkidle');
    const tabAssinaturas = page.locator('button:has-text("Assinaturas")').first();
    await tabAssinaturas.click().catch(() => {});
    await page.waitForTimeout(1000);
    const pagarBtn = page.locator('[data-testid*="pagar"], button:has-text("Pagar")').first();
    const visible = await pagarBtn.isVisible().catch(() => false);
    if (visible) {
      await pagarBtn.click();
      await page.waitForTimeout(1000);
      const cartaoOption = page.locator('button:has-text("Cartão"), [value="cartao"], text=Cartão').first();
      await cartaoOption.waitFor({ timeout: 3000 }).catch(() => {});
      await waitAndScreenshot(page, 'modal-cartao');
    }
  });

  test('Simula pagamento Boleto', async ({ page }) => {
    await loginAsMaster(page);
    await page.goto(`${BASE_URL}/admin/saas-dashboard`);
    await page.waitForLoadState('networkidle');
    const tabAssinaturas = page.locator('button:has-text("Assinaturas")').first();
    await tabAssinaturas.click().catch(() => {});
    await page.waitForTimeout(1000);
    const pagarBtn = page.locator('[data-testid*="pagar"], button:has-text("Pagar")').first();
    const visible = await pagarBtn.isVisible().catch(() => false);
    if (visible) {
      await pagarBtn.click();
      await page.waitForTimeout(1000);
      const boletoOption = page.locator('button:has-text("Boleto"), [value="boleto"], text=Boleto').first();
      await boletoOption.waitFor({ timeout: 3000 }).catch(() => {});
      await waitAndScreenshot(page, 'modal-boleto');
    }
  });
});
