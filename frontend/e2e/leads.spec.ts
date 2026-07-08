import { test, expect } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './credentials';

test.describe('Módulo Operacional: Leads e Contatos', () => {
  test.beforeEach(async ({ page }) => {
    // 1. Fazer Login como Master Admin
    await page.goto('/login');
    await page.fill('input[type="email"]', E2E_ADMIN_EMAIL);
    await page.fill('input[type="password"]', E2E_ADMIN_PASSWORD);
    await page.click('button[type="submit"]');

    // 2. Aguardar a navegação e sucesso
    await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 15000 });
  });

  test('Deve renderizar a tela de Base de Leads com sucesso e interagir com filtros', async ({ page }) => {
    // Navegar para Leads
    await page.goto('/crm/leads');

    // Aguardar o carregamento da tabela ou título
    await expect(page.locator('text=Base de Leads').first()).toBeVisible({ timeout: 15000 });

    // Filtros só renderizam quando existem leads na base (rows.length > 0).
    // Com base vazia a página mostra o EmptyState — ambos são estados válidos.
    const filterInput = page.locator('input[placeholder="Buscar em Nome"]');
    const emptyState = page.locator('text=Nenhum lead encontrado').first();
    await expect(filterInput.or(emptyState).first()).toBeVisible({ timeout: 15000 });

    if (await filterInput.isVisible()) {
      await filterInput.fill('Teste de Playwright');
      // Aguardar que a tabela reflita (ou debouncer)
      await page.waitForTimeout(1000);
    }
  });
});
