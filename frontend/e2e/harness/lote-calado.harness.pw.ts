// Lote calado em Chromium de verdade. O que este arquivo prova, e que jsdom não prova:
//   - no diálogo REAL de destinatários, o motivo do lote parado está VISÍVEL no topo, dentro do diálogo e da janela, e a
//     linha do não processado mostra o motivo no lugar de "Pendente na fila", no computador e em 375 px;
//   - "Disparar não processados" fora da janela abre a confirmação de verdade, e confirmar repete com forceOutsideWindow;
//   - no acompanhamento REAL de disparos, o cartão fechado mostra "Lote 1: <motivo>" e a fila de resposta parada por chip,
//     dentro do cartão e na coluna do botão de disparo, nos dois tamanhos.
//
// Uso: npx playwright test --config playwright.harness.config.ts lote-calado
import { expect, test, type Page } from "@playwright/test";

const PAGE_URL = "/e2e/harness/lote-calado.html";
const SHOTS = process.env.HARNESS_SHOTS_DIR || "test-results/harness";
const MOTIVO_CHIP = "Pausado — chip desconectado (Chip 2-NOUS). Reconecte o chip em Conexões para retomar.";
const JANELA = {
  localTime: "20:22",
  start: "08:00",
  end: "20:00",
  days: ["mon", "tue", "wed", "thu", "fri"],
  timezone: "America/Sao_Paulo",
  sendWindow: "08:00–20:00 [mon,tue,wed,thu,fri] (America/Sao_Paulo)",
  nextOpening: "2026-11-17T11:00:00.000Z",
  nextOpeningLocal: "08:00 (17/11)",
};

function recipients() {
  const items = Array.from({ length: 10 }, (_, i) => ({
    index: i + 1,
    leadId: `lead-${i + 1}`,
    nome: `Lead ${i + 1}`,
    telefone: `55349900010${String(i).padStart(2, "0")}`,
    status: i < 2 ? "invalid_number" : "pending",
    statusLabel: i < 2 ? "Número inválido" : "Não processado",
    sentAt: null,
    attemptedAt: i < 2 ? "2026-11-16T23:22:10Z" : null,
    failureReason: i < 2 ? "Número não existe no WhatsApp" : null,
    technicalDetails: null,
    campaignName: "Evento Mesa de Negocios 2 - Planilha 1",
    dispatchName: "Lote 1/50",
  }));
  return {
    dispatchId: "lote-1",
    dispatchName: "Lote 1/50",
    campaignName: "Evento Mesa de Negocios 2 - Planilha 1",
    dispatchStatus: "paused",
    dispatchErrorMessage: MOTIVO_CHIP,
    total: 10,
    sentCount: 0,
    failedCount: 0,
    invalidCount: 2,
    skippedCount: 0,
    pendingCount: 8,
    optedOutPendingCount: 0,
    items,
  };
}

function resumo(scope: string) {
  const campanha = {
    campaignId: "c-nous",
    campaignName: "Evento Mesa de Negocios 2 - Planilha 1",
    chipName: "Chip 2-NOUS",
    loteCount: 2,
    leadsTotal: 20,
    leadsPending: 18,
    sentTotal: 0,
    failedTotal: 0,
    repliedCount: 0,
    status: "agendada",
    statusLabel: "Agendada",
    nextScheduledAt: "2026-11-17T12:00:00Z",
    eta: null,
    leadsActionable: { pause: 0, resume: 0, cancel: 10 },
    batches: [
      { id: "lote-1", status: "paused", sentCount: 0, failedCount: 0, targetCount: 10, scheduledAt: null, createdAt: "2026-11-16T20:00:00Z", errorMessage: MOTIVO_CHIP },
      { id: "lote-2", status: "scheduled", sentCount: 0, failedCount: 0, targetCount: 10, scheduledAt: "2026-11-17T12:00:00Z", createdAt: "2026-11-16T20:00:01Z", errorMessage: null },
    ],
    queueBlock: {
      reason: "chip_unavailable",
      message: "Fila de resposta parada: chip nous-gestao-chip-4-nous desconectado (close). Reconecte em Conexões; o sistema tenta de novo sozinho.",
      chipName: "nous-gestao-chip-4-nous",
      connectionState: "close",
      since: "2026-11-16T23:00:00Z",
      retryAfter: "2026-11-16T23:30:00Z",
      attempts: 4,
    },
  };
  const campaigns = scope === "active" ? [campanha] : [];
  return {
    campaigns,
    counts: { active: 1, ended: 0, trashed: 0 },
    scope,
    page: 1,
    pageSize: 100,
    totalForScope: campaigns.length,
    kpis: { periodLabel: "últimos 30 dias", campaigns: 1, leads: 20, sent: 0, deliveryRate: 0 },
  };
}

async function abrirLote(page: Page) {
  const corpos: unknown[] = [];
  let chamadas = 0;
  await page.route("**/api/campaigns/dispatches/lote-1/recipients**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(recipients()) })
  );
  await page.route("**/api/campaigns/dispatches/lote-1/run-pending", (route) => {
    chamadas += 1;
    corpos.push(JSON.parse(route.request().postData() || "{}"));
    if (chamadas === 1) {
      return route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "OUTSIDE_SEND_WINDOW", message: "Fora da janela de envio: horário local 20:22", details: JANELA } }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, pendingCount: 8, message: "8 lead(s) pendente(s) em execução." }) });
  });
  await page.goto(`${PAGE_URL}?cena=lote`);
  await expect(page.getByRole("dialog")).toBeVisible();
  return { corpos };
}

function dentro(box: { x: number; y: number; width: number; height: number }, fora: { x: number; y: number; width: number; height: number }) {
  expect(box.width).toBeGreaterThan(40);
  expect(box.height).toBeGreaterThan(10);
  expect(box.x).toBeGreaterThanOrEqual(fora.x - 0.5);
  expect(box.y).toBeGreaterThanOrEqual(fora.y - 0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(fora.x + fora.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(fora.y + fora.height + 0.5);
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 375, height: 760 }]) {
  test(`destinatários, ${viewport.width}px: motivo no topo e na linha do não processado, dentro do diálogo e da janela`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await abrirLote(page);
    const aviso = page.getByTestId("dispatch-stop-notice");
    await expect(aviso).toBeVisible();
    await expect(aviso).toHaveText(MOTIVO_CHIP);
    const dialogo = (await page.getByRole("dialog").boundingBox())!;
    const box = (await aviso.boundingBox())!;
    dentro(box, dialogo);
    dentro(box, { x: 0, y: 0, width: viewport.width, height: viewport.height });
    // acima dos filtros, que continuam visíveis
    const filtro = (await page.getByRole("button", { name: "Não processados (8)", exact: true }).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(filtro.y + 0.5);

    const linhas = page.getByTestId("pending-recipient-reason");
    await expect(linhas).toHaveCount(8);
    await linhas.first().scrollIntoViewIfNeeded();
    await expect(linhas.first()).toBeVisible();
    await expect(linhas.first()).toHaveText("Pausado — chip desconectado (Chip 2-NOUS)");
    await expect(page.getByText("Pendente na fila", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/lote-calado-destinatarios-${viewport.width}.png` });
  });
}

test("destinatários: 'Disparar não processados' fora da janela confirma e repete com forceOutsideWindow", async ({ page }) => {
  const { corpos } = await abrirLote(page);
  await page.getByRole("button", { name: /Disparar não processados \(8\)/ }).click();
  const confirmacao = page.getByTestId("outside-send-window-dialog");
  await expect(confirmacao).toBeVisible();
  await expect(page.getByTestId("outside-send-window-text")).toContainText("Agora são 20:22");
  await page.screenshot({ path: `${SHOTS}/lote-calado-confirmacao-janela.png` });
  await page.getByTestId("outside-send-window-force").click();
  await expect.poll(() => corpos.length).toBe(2);
  expect(corpos).toEqual([{}, { forceOutsideWindow: true }]);
  await expect(page.getByText("Disparo iniciado")).toBeVisible();
});

for (const viewport of [{ width: 1366, height: 768 }, { width: 375, height: 760 }]) {
  test(`cartão da campanha, ${viewport.width}px: 'Lote 1: <motivo>' e fila parada por chip, dentro do cartão e na coluna do botão`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/campaigns/dispatch-summary**", (route) => {
      const scope = new URL(route.request().url()).searchParams.get("scope") || "active";
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(resumo(scope)) });
    });
    await page.goto(`${PAGE_URL}?cena=cartao`);
    const cartao = page.getByTestId("dispatch-card-c-nous");
    await expect(cartao).toBeVisible();
    const motivo = page.getByTestId("dispatch-stop-notice-c-nous");
    await expect(motivo).toBeVisible();
    await expect(motivo).toHaveText(`Lote 1: ${MOTIVO_CHIP}`);
    const fila = cartao.getByTestId("queue-block-notice");
    await expect(fila).toBeVisible();
    await expect(fila).toContainText("chip nous-gestao-chip-4-nous desconectado (close)");
    const caixa = (await cartao.boundingBox())!;
    // Em 375 px o próprio cartão já passa da janela no main (medido em 16/11: termina em 404 px sem os avisos; anotado no
    // PR, fora do escopo). O que se prova aqui é que o aviso não alarga nada: fica dentro do cartão e na mesma coluna do
    // botão "Disparar Lote" que já existia.
    const botao = (await page.getByTestId("btn-trigger-batch-1-c-nous").boundingBox())!;
    for (const el of [motivo, fila]) {
      const b = (await el.boundingBox())!;
      dentro(b, caixa);
      expect(b.x).toBeGreaterThanOrEqual(botao.x - 0.5);
      expect(b.x + b.width).toBeLessThanOrEqual(botao.x + botao.width + 0.5);
    }
    await expect(page.getByTestId("btn-trigger-batch-1-c-nous")).toHaveText(/Disparar Lote 1 Agora/);
    await page.screenshot({ path: `${SHOTS}/lote-calado-cartao-${viewport.width}.png`, fullPage: true });
  });
}
