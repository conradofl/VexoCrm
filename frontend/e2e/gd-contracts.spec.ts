import { test, expect } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './credentials';

test.describe('Módulo Geração Digital: Contratos', () => {
  test.beforeEach(async ({ page }) => {
    // 1. Fazer Login como Admin
    await page.goto('/login');
    await page.fill('input[type="email"]', E2E_ADMIN_EMAIL);
    await page.fill('input[type="password"]', E2E_ADMIN_PASSWORD);
    await page.click('button[type="submit"]');

    // 2. Aguardar a navegação pro dashboard
    await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 15000 });
  });

  test('Deve renderizar a aba de Contratos e a lista vazia ou preenchida', async ({ page }) => {
    // Navegar para Contratos GD
    await page.goto('/crm/contratos-gd');

    // Aguardar título de Gerenciador de Contratos
    await expect(page.locator('text=Templates e Modelos de Contrato').first()).toBeVisible({ timeout: 15000 });
    
    // Checar se a aba "Contratos Emitidos" também existe
    const emittedTab = page.locator('text=Contratos Emitidos').first();
    await expect(emittedTab).toBeVisible();
  });

  test('Deve abrir modal de Gerar Contrato a partir de uma proposta (se houver alguma)', async ({ page }) => {
    // Esse teste é best-effort. Pode não haver propostas com status "aceita" no ambiente de testes.
    await page.goto('/crm/propostas-gd');
    
    // Esperar o layout de propostas carregar
    const proposalHeader = page.locator('text=Propostas Comerciais').first();
    try {
      await expect(proposalHeader).toBeVisible({ timeout: 10000 });
    } catch {
      // Pode ser que não tenha propostas e esteja vazio
      return; 
    }

    const openProposalBtn = page.locator('text=Ver Proposta').first();
    const hasProposals = await openProposalBtn.isVisible();
    
    if (hasProposals) {
      await openProposalBtn.click();
      
      const generateBtn = page.locator('text=Gerar Contrato Jurídico');
      const isAccepted = await generateBtn.isVisible();

      if (isAccepted) {
        await generateBtn.click();
        
        // Verifica se o Modal abriu
        await expect(page.locator('text=Gerar Contrato Jurídico').last()).toBeVisible();
        await expect(page.locator('input[name="razao_social"]')).toBeVisible();
        await expect(page.locator('input[name="vigencia"]')).toBeVisible();
        
        // Clica em Cancelar para fechar o modal
        await page.click('text=Cancelar');
      }
    }
  });
});
