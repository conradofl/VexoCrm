import { test, expect } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './credentials';

test.describe('Módulo Operacional: Dashboard', () => {
  test('Deve renderizar a tela de Dashboard com sucesso', async ({ page }) => {
    // 1. Fazer Login como Master Admin
    await page.goto('/login');
    await page.fill('input[type="email"]', E2E_ADMIN_EMAIL);
    await page.fill('input[type="password"]', E2E_ADMIN_PASSWORD);
    await page.click('button[type="submit"]');

    // 2. Aguardar a navegação e sucesso
    await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 15000 });

    // 3. Navegar para o Dashboard
    await page.goto('/crm/dashboard');

    // 4. Aguardar o carregamento e buscar o H2 principal
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 });
  });
});
