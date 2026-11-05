import { test, expect } from '@playwright/test';

// Prova de Visibilidade e Layout em Chromium de verdade (Regra 11 do Vexo OS).
// Garante que o Portal do Cliente não renderiza fora da janela e que
// os elementos principais estão visíveis com coordenadas reais de layout.

const PORTAL_MOCK = {
  cliente: {
    nome: "Acme Indústria Solar",
    estado_atual: "AGUARDANDO_ASSINATURA_CLIENTE",
    estado_desde: "2026-11-05T10:00:00.000Z",
    estado_data_estimada: false,
    proposal_id: "prop-123",
    drive_url: "https://drive.google.com/drive/folders/pasta-acme",
    escopo: ["google", "meta"],
  },
  estados: [
    { codigo: "PROPOSTA_ENVIADA", ordem: 10, fase: "comercial", rotulo_portal: "Proposta enviada", terminal: false, acao_do_cliente: false },
    { codigo: "AGUARDANDO_ASSINATURA_CLIENTE", ordem: 50, fase: "comercial", rotulo_portal: "Aguardando sua assinatura", terminal: false, acao_do_cliente: true },
    { codigo: "GRUPOS_CRIADOS", ordem: 70, fase: "entrada", rotulo_portal: "Equipe montada", terminal: false, acao_do_cliente: false },
    { codigo: "ATIVO", ordem: 160, fase: "regime", rotulo_portal: "Contrato ativo", terminal: false, acao_do_cliente: false },
  ],
  eventos: [
    { estado: "PROPOSTA_ENVIADA", ocorrido_em: "2026-11-04T10:00:00.000Z", data_estimada: false },
    { estado: "AGUARDANDO_ASSINATURA_CLIENTE", ocorrido_em: "2026-11-05T10:00:00.000Z", data_estimada: false },
  ],
};

test.describe('Portal do Cliente GD - Prova de Layout no Chromium', () => {
  test('renderiza dentro da viewport no desktop com layout correto e rolagem automática', async ({ page }) => {
    await page.route('**/api/gd/public/portal/*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PORTAL_MOCK),
      });
    });

    await page.goto('/acompanhamento/tok-valido-123');

    // 1. Etapa atual é rolada para o centro pelo scrollIntoView da TrilhaGd
    const etapaAtual = page.locator('li[aria-current="step"]');
    await expect(etapaAtual).toBeVisible();
    const boxEtapa = await etapaAtual.boundingBox();
    expect(boxEtapa).not.toBeNull();
    const viewportHeight = page.viewportSize()?.height || 720;
    expect(boxEtapa!.y).toBeGreaterThan(0);
    expect(boxEtapa!.y).toBeLessThan(viewportHeight);

    // 2. Rola para o título e confere cabeçalho e título
    const titulo = page.getByRole('heading', { name: 'Acme Indústria Solar' });
    await titulo.scrollIntoViewIfNeeded();
    await expect(titulo).toBeVisible();
    const boxTitulo = await titulo.boundingBox();
    expect(boxTitulo).not.toBeNull();
    expect(boxTitulo!.y).toBeGreaterThanOrEqual(0);
    expect(boxTitulo!.y).toBeLessThan(400);

    // 3. Card de Ação necessária visível
    const cardAcao = page.getByRole('region', { name: /ação necessária/i });
    await expect(cardAcao).toBeVisible();

    // 4. Botões de acesso visíveis
    await expect(page.getByText('Ver Proposta')).toBeVisible();
    await expect(page.getByText('Pasta no Drive')).toBeVisible();

    // Salva screenshot para comprovação visual
    await page.screenshot({ path: '/tmp/gd-portal-desktop.png', fullPage: true });
  });

  test('renderiza com layout responsivo no mobile (375x667)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.route('**/api/gd/public/portal/*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PORTAL_MOCK),
      });
    });

    await page.goto('/acompanhamento/tok-valido-123');

    const titulo = page.getByRole('heading', { name: 'Acme Indústria Solar' });
    await titulo.scrollIntoViewIfNeeded();
    await expect(titulo).toBeVisible();

    const box = await titulo.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(375); // Sem transbordar horizontalmente!

    const trilha = page.getByRole('region', { name: /trilha do cliente/i });
    await expect(trilha).toBeVisible();

    await page.screenshot({ path: '/tmp/gd-portal-mobile.png', fullPage: true });
  });

  test('renderiza tela amigável de link inválido/expirado em caso de 404', async ({ page }) => {
    await page.route('**/api/gd/public/portal/*', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Link de acompanhamento inválido ou expirado.' }),
      });
    });

    await page.goto('/acompanhamento/tok-invalido');

    const avisoErro = page.getByText('Link inválido ou expirado');
    await expect(avisoErro).toBeVisible();
    const box = await avisoErro.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThan(0);
    expect(box!.y).toBeLessThan(500);

    await page.screenshot({ path: '/tmp/gd-portal-404.png' });
  });
});
