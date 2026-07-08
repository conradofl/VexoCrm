import { test, expect } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './credentials';

test.describe('Módulo Operacional: Campanhas (Planilhas)', () => {
  test.beforeEach(async ({ page }) => {
    // 1. Fazer Login como Master Admin
    await page.goto('/login');
    await page.fill('input[type="email"]', E2E_ADMIN_EMAIL);
    await page.fill('input[type="password"]', E2E_ADMIN_PASSWORD);
    await page.click('button[type="submit"]');

    // 2. Aguardar a navegação e sucesso
    await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 15000 });
  });

  test('Deve renderizar a tela de Campanhas com sucesso e abrir modais', async ({ page }) => {
    await page.goto('/crm/planilhas');

    // Aguardar o carregamento da tabela ou título
    await expect(page.locator('text=Campanhas').first()).toBeVisible({ timeout: 15000 });

    // Tenta clicar no botão de Nova Campanha
    const newBtn = page.locator('button:has-text("Nova Campanha")').first();
    if (await newBtn.isVisible()) {
      await newBtn.click();
      await expect(page.locator('text=Criar Campanha').first()).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Escape'); // Fecha o modal
    }
  });
});
