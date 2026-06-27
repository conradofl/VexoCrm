import { test, expect } from '@playwright/test';

// Utilizando os usuários que podem ser criados ou os dados que temos
// Como estamos num fluxo contínuo, vamos testar primeiro se o sistema proibe corretamente as rotas via URL direta
// Para um teste cego, se não tivermos a senha do usuário gestor do cliente (gerado dinamicamente),
// Vamos testar se uma sessão NÃO AUTENTICADA é bloqueada, e depois logar como Master Admin para ver se ele ACESSA tudo.

test.describe('Matriz de Permissões (RBAC) e Rotas Privadas', () => {
  test('Usuário Deslogado não deve acessar Rotas Protegidas e ser redirecionado para /login', async ({ page }) => {
    const rotasProtegidas = [
      '/crm/dashboard',
      '/crm/usuarios',
      '/crm/empresas',
      '/crm/leads',
      '/crm/conexoes'
    ];

    for (const rota of rotasProtegidas) {
      await page.goto(rota);
      // Wait for network idle or URL change
      await page.waitForURL('**/login*');
      expect(page.url()).toContain('/login');
    }
  });

  test('Master Admin deve acessar Rotas Estratégicas', async ({ page }) => {
    // Fazer login como Master
    await page.goto('/login');
    await page.fill('input[type="email"]', 'luizz.felipe.santos17@gmail.com');
    await page.fill('input[type="password"]', '@Lfs341340');
    await page.click('button[type="submit"]');

    // Verify successful login by checking URL
    await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 15000 });
    
    // Testar acesso a Empresas (Admin)
    await page.goto('/crm/empresas');
    await expect(page.getByRole('heading', { name: 'Empresas' })).toBeVisible({ timeout: 10000 });

    // Testar acesso a Usuários (Admin)
    await page.goto('/crm/usuarios');
    await expect(page.getByRole('heading', { name: /Liberacao|Liberação/i })).toBeVisible({ timeout: 10000 });
  });
});
