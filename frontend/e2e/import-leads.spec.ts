import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Módulo: Importação de Leads', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'luizz.felipe.santos17@gmail.com');
    await page.fill('input[type="password"]', '@Lfs341340');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 15000 });
  });

  test('Deve navegar e abrir interface de upload de leads', async ({ page }) => {
    // Navigate to Lead Imports (ajustar a rota correta baseada no router se necessário)
    await page.goto('/crm/importar-leads');
    
    // Check if page rendered
    await expect(page.locator('text=Importação de Leads').first()).toBeVisible({ timeout: 10000 });
  });
});
