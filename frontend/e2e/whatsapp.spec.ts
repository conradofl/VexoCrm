import { test, expect } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './credentials';

test.describe('Módulo Operacional: WhatsApp', () => {
  test.beforeEach(async ({ page }) => {
    // 1. Fazer Login como Master Admin
    await page.goto('/login');
    await page.fill('input[type="email"]', E2E_ADMIN_EMAIL);
    await page.fill('input[type="password"]', E2E_ADMIN_PASSWORD);
    await page.click('button[type="submit"]');

    // 2. Aguardar a navegação e sucesso
    await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 15000 });
  });

  test('Deve renderizar a tela de WhatsApp/Conexões com sucesso', async ({ page }) => {
    // Navegar para WhatsApp / Conexões
    await page.goto('/crm/conexoes');

    // Aguardar o carregamento
    await expect(page.locator('text=WhatsApp').first()).toBeVisible({ timeout: 15000 });
  });
});
