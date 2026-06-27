import { test, expect } from '@playwright/test';

test.describe('Módulo Operacional: Dashboard', () => {
  test('Deve renderizar a tela de Dashboard com sucesso', async ({ page }) => {
    // 1. Fazer Login como Master Admin
    await page.goto('/login');
    await page.fill('input[type="email"]', 'luizz.felipe.santos17@gmail.com');
    await page.fill('input[type="password"]', '@Lfs341340');
    await page.click('button[type="submit"]');

    // 2. Aguardar a navegação e sucesso
    await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 15000 });
    
    // 3. Navegar para o Dashboard
    await page.goto('/crm/dashboard');
    
    // 4. Aguardar o carregamento e buscar o H2 principal
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 });
  });
});
