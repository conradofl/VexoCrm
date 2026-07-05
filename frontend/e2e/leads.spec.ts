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

    // Testar filtro de busca
    await page.fill('input[placeholder="Buscar por nome ou telefone..."]', 'Teste de Playwright');

    // Aguardar que a tabela reflita (ou debouncer)
    await page.waitForTimeout(1000);
  });
});
