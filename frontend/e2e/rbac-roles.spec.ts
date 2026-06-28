import { test, expect } from '@playwright/test';

// Define the role presets, their allowed/forbidden routes and test configuration
const nonAdminRoles = [
  {
    name: 'Gestor (Interno)',
    key: 'gestor',
    roleType: 'internal',
    allowedPages: ['dashboard', 'leads', 'whatsapp', 'planilhas'],
    forbiddenPages: ['empresas']
  },
  {
    name: 'Operador (Interno)',
    key: 'operador',
    roleType: 'internal',
    allowedPages: ['dashboard', 'leads', 'whatsapp'],
    forbiddenPages: ['planilhas', 'empresas', 'usuarios']
  },
  {
    name: 'Gestor do Cliente',
    key: 'client_manager',
    roleType: 'client',
    allowedPages: ['dashboard', 'leads', 'whatsapp', 'planilhas'],
    forbiddenPages: ['usuarios', 'empresas']
  },
  {
    name: 'Operador do Cliente',
    key: 'client_operator',
    roleType: 'client',
    allowedPages: ['dashboard', 'leads', 'whatsapp'],
    forbiddenPages: ['planilhas', 'usuarios', 'empresas']
  },
  {
    name: 'Leitura do Cliente',
    key: 'client_viewer',
    roleType: 'client',
    allowedPages: ['dashboard', 'leads'],
    forbiddenPages: ['whatsapp', 'planilhas', 'usuarios', 'empresas']
  }
];

test.describe('Matriz de Permissões E2E - Criação e Login', () => {
  for (const role of nonAdminRoles) {
    test(`Fluxo Humano: Criar e Validar Permissões para o perfil ${role.name}`, async ({ page }) => {
      // Definir um timeout maior (90 segundos) para este fluxo complexo de criação, login e validações E2E
      test.setTimeout(90000);

      // 1. Login como Master Admin
      await page.goto('/login');
      await page.fill('input[type="email"]', 'luizz.felipe.santos17@gmail.com');
      await page.fill('input[type="password"]', '@Lfs341340');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 15000 });

      // 2. Ir para a tela de Usuários
      await page.goto('/crm/usuarios');
      await expect(page.getByRole('heading', { name: /Liberacao|Liberação/i })).toBeVisible();

      // 3. Abrir o modal "Novo Usuário"
      await page.getByRole('button', { name: /Novo usu[aá]rio/i }).click();

      // Gerar e-mail sem parênteses ou caracteres inválidos para o Supabase Auth
      const uniqueEmail = `test-${role.key}-${Date.now()}@teste.com`;
      const tempPassword = 'Senha123!';

      // Preencher Dados Básicos
      await page.fill('input[placeholder="Nome completo ou alcunha"]', `Test User ${role.name}`);
      await page.fill('input[placeholder="E-mail do usuario"]', uniqueEmail);
      await page.fill('input[placeholder="Senha inicial"]', tempPassword);

      // Selecionar o Perfil / Preset usando data-testid
      await page.getByRole('combobox').first().click();
      await page.getByTestId(`profile-option-${role.key}`).click();

      // Selecionar especificamente a empresa "Teste 2"
      await page.getByRole('combobox').nth(1).click();
      await page.getByRole('option', { name: /Teste 2/i }).first().click();

      // 4. Navegar na aba de "Permissões Iniciais" para ver/personalizar
      await page.getByRole('tab', { name: 'Permissões Iniciais' }).click();
      await expect(page.getByText('selecionados', { exact: false })).toBeVisible();

      // Voltar para Cadastro & Dados
      await page.getByRole('tab', { name: 'Cadastro & Dados' }).click();

      // 5. Finalizar Criação do Usuário
      await page.getByRole('button', { name: /Criar usu[aá]rio/i }).click();

      // Confirmar mensagem de sucesso do modal
      await expect(page.getByRole('dialog', { name: /usu[aá]rio criado/i })).toBeVisible({ timeout: 10000 });

      // Fechar modal de sucesso
      await page.getByRole('dialog', { name: /usu[aá]rio criado/i }).getByRole('button', { name: 'Fechar' }).click();
      await expect(page.getByRole('dialog', { name: /usu[aá]rio criado/i })).not.toBeVisible();

      // 6. Fazer Logout do Master Admin
      await page.getByRole('button', { name: 'Sair' }).click();
      await expect(page).toHaveURL(/.*login.*/, { timeout: 10000 });

      // 7. Fazer Login com o Usuário Criado
      await page.fill('input[type="email"]', uniqueEmail);
      await page.fill('input[type="password"]', tempPassword);
      await page.click('button[type="submit"]');

      // Se for primeiro acesso, ele vai cair na tela de mudar senha
      await expect(page).toHaveURL(/.*(set-password|clientes|crm).*/, { timeout: 15000 });

      if (page.url().includes('/set-password')) {
        await page.fill('#current-password', tempPassword);
        await page.fill('#new-password', '@NovaSenha123');
        await page.fill('#confirm-password', '@NovaSenha123');
        await page.click('button[type="submit"]');
      }

      // Definir o prefixo da URL baseado no tipo de usuário (Client ou Internal)
      const urlPrefix = role.roleType === 'client' ? '/clientes/teste-2' : '/crm';

      // Esperar entrar no painel / CRM ou Portal do Cliente
      await expect(page).toHaveURL(new RegExp(`.*${urlPrefix}.*`), { timeout: 20000 });

      // 8. Validar os acessos permitidos no menu lateral
      for (const pageName of role.allowedPages) {
        // Se for usuário interno e a página for planilhas, precisa clicar no modo "Disparos" no menu lateral
        if (role.roleType === 'internal' && pageName === 'planilhas') {
          await page.getByRole('button', { name: 'Disparos' }).click();
        } else if (role.roleType === 'internal' && ['dashboard', 'leads', 'whatsapp'].includes(pageName)) {
          // Voltar para vendas se necessário
          const salesButton = page.getByRole('button', { name: 'Vendas' });
          if (await salesButton.isVisible()) {
            await salesButton.click();
          }
        }

        const link = page.locator(`a[href="${urlPrefix}/${pageName}"]`);
        await expect(link).toBeVisible({ timeout: 15000 });
      }

      // 9. Validar os bloqueios (páginas que não deve acessar nem ver)
      for (const pageName of role.forbiddenPages) {
        // Não deve ver o link no menu lateral
        const crmLink = page.locator(`a[href="/crm/${pageName}"]`);
        const clientLink = page.locator(`a[href="/clientes/teste-2/${pageName}"]`);
        await expect(crmLink).not.toBeVisible();
        await expect(clientLink).not.toBeVisible();

        // Determinar a URL correta a testar para navegação direta de bloqueio
        // Se a página for de uso administrativo/interno (como usuarios ou empresas), o path correto é /crm/
        let testPath = '';
        if (['usuarios', 'empresas'].includes(pageName)) {
          testPath = `/crm/${pageName}`;
        } else {
          testPath = `${urlPrefix}/${pageName}`;
        }

        // Se tentar acessar via URL direta, deve ser redirecionado para longe dali
        await page.goto(testPath, { waitUntil: 'commit' });
        await page.waitForTimeout(2000); // Esperar o middleware de rotas processar
        expect(page.url()).not.toContain(testPath);
      }

      // 10. Logout do usuário de teste para o próximo loop
      await page.getByRole('button', { name: 'Sair' }).click();
      await expect(page).toHaveURL(/.*login.*/, { timeout: 10000 });
    });
  }
});
