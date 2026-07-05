import { test, expect } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './credentials';
import path from 'path';

test.describe('Módulo: Importação de Leads', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', E2E_ADMIN_EMAIL);
    await page.fill('input[type="password"]', E2E_ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 15000 });
  });

  test('Deve navegar e abrir interface de upload de leads', async ({ page }) => {
    // Navigate to Lead Imports (ajustar a rota correta baseada no router se necessário)
    await page.goto('/crm/planilhas');

    // Check if page rendered
    await expect(page.locator('text=Envios por Planilha').first()).toBeVisible({ timeout: 10000 });
  });
});
