import { test, expect } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './credentials';

test.describe('Módulo: Chatbot e Automação Inbound', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', E2E_ADMIN_EMAIL);
    await page.fill('input[type="password"]', E2E_ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 15000 });
  });

  test('Deve acessar as configurações do Agente de Inbound e Treinamento (Pitch)', async ({ page }) => {
    await page.goto('/crm/agente');
    await expect(page.locator('text=Agente').first()).toBeVisible({ timeout: 10000 });

    // Switch to Pitch
    await page.goto('/crm/vexo-pitch');
    await expect(page.locator('text=Vexo Pitch').first()).toBeVisible({ timeout: 10000 });
  });
});
