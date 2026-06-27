import { test, expect } from '@playwright/test';

test.describe('Módulo Operacional: WhatsApp', () => {
  test.beforeEach(async ({ page }) => {
    // 1. Fazer Login como Master Admin
    await page.goto('/login');
    await page.fill('input[type="email"]', 'luizz.felipe.santos17@gmail.com');
    await page.fill('input[type="password"]', '@Lfs341340');
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
