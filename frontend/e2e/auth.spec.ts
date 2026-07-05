import { test, expect } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './credentials';

// Use test.describe.serial to ensure tests run sequentially and share the same page/context
test.describe.serial('Módulo 1: Autenticação e Gestão de Usuários', () => {
  let page: any;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('Deve logar como Master Admin com sucesso', async () => {
    await page.goto('/login');

    try {
      await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 5000 });
    } catch (e) {
      console.log('Page URL:', page.url());
      console.log('Page content:', await page.content());
      throw e;
    }
    await page.fill('input[type="email"]', E2E_ADMIN_EMAIL);
    await page.fill('input[type="password"]', E2E_ADMIN_PASSWORD);

    await page.locator('button[type="submit"]').click();

    // Verify successful login by checking URL or a common dashboard element
    await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 15000 });
  });

  test('Deve acessar Configurações > Usuários e listar a tabela', async () => {
    // Navigate to user access management
    await page.goto('/crm/usuarios');

    // Wait for the table or header to load
    await expect(page.locator('text=Liberacao e acessos dos usuarios')).toBeVisible({ timeout: 15000 });
  });

  test('Deve criar um Gestor do Cliente com sucesso', async () => {
    // Click "Novo usuario" button
    await page.getByRole('button', { name: /Novo usuario/i }).click();

    // Verify modal is open by expecting modal title
    await expect(page.getByRole('heading', { name: 'Novo usuário', exact: true })).toBeVisible();

    // Fill form
    const email = `e2e_client_${Date.now()}@vexoia.com`;
    await page.fill('input[placeholder="E-mail do usuario"]', email);
    await page.fill('input[placeholder="Senha inicial"]', 'TestPassword123!');
    await page.fill('input[placeholder="Nome completo ou alcunha"]', 'Cliente Teste Playwright');

    // Select Tipo de Usuário (accessPreset)
    await page.locator('div:has(> label:has-text("Tipo de Usuário")) button').click();
    await page.click('div[role="option"]:has-text("Gestor do cliente")');

    // Select Empresa / Tenant
    await page.locator('div:has(> label:has-text("Empresa / Tenant")) button').click();
    // We select the first available company in the list that is NOT "Selecionar empresa" or "Sem empresa vinculada"
    const option = page.locator('div[role="option"]').filter({ hasNotText: /Sem empresa vinculada|Selecionar empresa/i }).first();
    await option.click();

    // Click "Criar usuario" button
    await page.getByRole('button', { name: /Criar usuario/i }).click();

    // Expect the feedback dialog to show up with "Usuario criado"
    await expect(page.locator('text=Usuario criado')).toBeVisible({ timeout: 15000 });

    // Click "Fechar" button inside the feedback dialog to dismiss it
    await page.getByRole('button', { name: /Fechar/i }).click();
  });
});
