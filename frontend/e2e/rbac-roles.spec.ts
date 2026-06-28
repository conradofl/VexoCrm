import { test, expect } from '@playwright/test';

const nonAdminRoles = [
  { name: 'Gestor (Interno)', optionRegex: /^Gestor /i },
  { name: 'Operador (Interno)', optionRegex: /^Operador /i },
  { name: 'Gestor do Cliente', optionRegex: /^Gestor do cliente /i },
  { name: 'Operador do Cliente', optionRegex: /^Operador do cliente /i },
  { name: 'Leitura do Cliente', optionRegex: /^Leitura do cliente /i }
];

test.describe('Criação de Usuários para todos os perfis não-admin', () => {
  test.beforeEach(async ({ page }) => {
    // Logar como Master Admin antes de cada teste de criação
    await page.goto('/login');
    await page.fill('input[type="email"]', 'luizz.felipe.santos17@gmail.com');
    await page.fill('input[type="password"]', '@Lfs341340');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 15000 });
  });

  for (const role of nonAdminRoles) {
    test(`Criar usuário com o perfil: ${role.name}`, async ({ page }) => {
      await page.goto('/crm/usuarios');
      await expect(page.getByRole('heading', { name: /Liberacao|Liberação/i })).toBeVisible();

      await page.getByRole('button', { name: /Novo usu[aá]rio/i }).click();

      const uniqueEmail = `test-${role.name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}@teste.com`;
      
      await page.fill('input[placeholder="Nome completo ou alcunha"]', `Test User ${role.name}`);
      await page.fill('input[placeholder="E-mail do usuario"]', uniqueEmail);
      await page.fill('input[placeholder="Senha inicial"]', 'Senha123!');

      // Selecionar o Tipo de Usuário
      await page.getByRole('combobox').first().click();
      await page.getByRole('option', { name: role.optionRegex }).click();

      // Selecionar Empresa (A primeira disponível, geralmente "Teste 2" ou "Vexo Adm")
      await page.getByRole('combobox').nth(1).click();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');

      // Finalizar Criação
      await page.getByRole('button', { name: /Criar usu[aá]rio/i }).click();

      // Confirmar criação
      await expect(page.getByText('sucesso', { exact: false })).toBeVisible({ timeout: 10000 });
      
      // Abrir a edição do usuário recém criado para checar as permissões
      await page.getByPlaceholder('Buscar por nome, e-mail ou empresa').fill(uniqueEmail);
      await page.waitForTimeout(1000); // Wait for debounce
      
      const configureButton = page.getByRole('button', { name: /Configurar/i }).first();
      await configureButton.click();
      
      // Navegar para a aba de Permissões
      await page.getByRole('tab', { name: /Permissões/i }).click();
      
      // Apenas verificar se a aba abriu corretamente e tem os toggles
      await expect(page.getByText('Módulos e Acessos')).toBeVisible();
      
      // Fechar a gaveta
      await page.keyboard.press('Escape');
    });
  }
});
