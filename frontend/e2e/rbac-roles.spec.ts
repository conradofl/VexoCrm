import { test, expect } from '@playwright/test';

// Profile keys match the `data-testid="profile-option-{key}"` attribute on each SelectItem
const nonAdminRoles = [
  { name: 'Gestor (Interno)',    key: 'gestor' },
  { name: 'Operador (Interno)',  key: 'operador' },
  { name: 'Gestor do Cliente',   key: 'client_manager' },
  { name: 'Operador do Cliente', key: 'client_operator' },
  { name: 'Leitura do Cliente',  key: 'client_viewer' },
];

test.describe('Criação de Usuários para todos os perfis não-admin', () => {
  test.beforeEach(async ({ page }) => {
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

      // Email sem caracteres especiais e único por role e timestamp
      const uniqueEmail = `test-${role.key}-${Date.now()}@teste.com`;

      await page.fill('input[placeholder="Nome completo ou alcunha"]', `Test User ${role.name}`);
      await page.fill('input[placeholder="E-mail do usuario"]', uniqueEmail);
      await page.fill('input[placeholder="Senha inicial"]', 'Senha123!');

      // Selecionar Tipo de Usuário via data-testid — único, estável e sem depender de texto
      await page.getByRole('combobox').first().click();
      await page.getByTestId(`profile-option-${role.key}`).click();

      // Selecionar a primeira empresa disponível (pular o __none placeholder)
      await page.getByRole('combobox').nth(1).click();
      await page.locator('[role="listbox"] [role="option"]').filter({
        hasNot: page.locator('[data-value="__none"]'),
      }).first().click();

      // Criar o usuário
      await page.getByRole('button', { name: /Criar usu[aá]rio/i }).click();

      // Aguardar modal de sucesso
      await expect(page.getByRole('dialog', { name: /usu[aá]rio criado/i })).toBeVisible({ timeout: 10000 });

      // Fechar o modal de sucesso para liberar a tabela
      await page.getByRole('dialog', { name: /usu[aá]rio criado/i }).getByRole('button', { name: 'Fechar' }).click();
      await expect(page.getByRole('dialog', { name: /usu[aá]rio criado/i })).not.toBeVisible();

      // Buscar o usuário recém-criado na tabela
      await page.getByPlaceholder('Buscar por nome, e-mail ou empresa').fill(uniqueEmail);

      // Aguardar a linha aparecer — escopo seguro para pegar o botão Configurar correto
      const userRow = page.getByRole('row').filter({ hasText: uniqueEmail });
      await expect(userRow).toBeVisible({ timeout: 10000 });

      await userRow.getByRole('button', { name: /Configurar/i }).click();

      // Navegar para aba de Permissões
      await page.getByRole('tab', { name: /Permissões/i }).click();

      // Confirmar que a seção de permissões está visível
      await expect(page.getByText('Módulos e Acessos')).toBeVisible();

      // Fechar a gaveta
      await page.keyboard.press('Escape');
    });
  }
});
