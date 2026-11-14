// Aviso de opt-out em Chromium de verdade. O que este arquivo prova, e que jsdom não prova:
//   - no diálogo REAL de destinatários do lote, a linha do aviso está VISÍVEL, dentro da janela e dentro do diálogo,
//     no computador e em 375 px, sem empurrar os filtros para fora;
//   - sem o que avisar (zero) ou sem o servidor saber (null), a linha não aparece;
//   - no público, a linha cabe dentro da caixa do assistente e do cartão de Campanhas, sem transbordar.
//
// Uso: npx playwright test --config playwright.harness.config.ts optout-aviso
import { expect, test, type Page } from "@playwright/test";

const PAGE_URL = "/e2e/harness/optout-aviso.html";
const SHOTS = process.env.HARNESS_SHOTS_DIR || "test-results/harness";

function recipients(optedOutPendingCount: number | null) {
  const items = Array.from({ length: 12 }, (_, i) => ({
    index: i + 1,
    leadId: `lead-${i + 1}`,
    nome: `Lead ${i + 1}`,
    telefone: `55349900000${String(i).padStart(2, "0")}`,
    status: "pending",
    statusLabel: "Não processado",
    sentAt: null,
    attemptedAt: null,
    failureReason: null,
    technicalDetails: null,
    campaignName: "Campanha de teste",
    dispatchName: "Lote 1",
  }));
  return {
    dispatchId: "lote-1",
    dispatchName: "Lote 1",
    campaignName: "Campanha de teste",
    total: 12,
    sentCount: 0,
    failedCount: 0,
    invalidCount: 0,
    skippedCount: 0,
    pendingCount: 12,
    optedOutPendingCount,
    items,
  };
}

async function abrirLote(page: Page, optedOutPendingCount: number | null) {
  await page.route("**/api/campaigns/dispatches/lote-1/recipients**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(recipients(optedOutPendingCount)) })
  );
  await page.goto(`${PAGE_URL}?cena=lote`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Não processados (12)", exact: true })).toBeVisible();
}

async function dentroDe(page: Page, interno: string, externoBox: { x: number; y: number; width: number; height: number }) {
  const box = await page.getByTestId(interno).first().boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(40);
  expect(box!.height).toBeGreaterThan(10);
  expect(box!.x).toBeGreaterThanOrEqual(externoBox.x - 0.5);
  expect(box!.y).toBeGreaterThanOrEqual(externoBox.y - 0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(externoBox.x + externoBox.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(externoBox.y + externoBox.height + 0.5);
  return box!;
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 375, height: 700 }]) {
  test(`lote, ${viewport.width}px: o aviso aparece em linha própria, dentro do diálogo e da janela`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await abrirLote(page, 3);

    const aviso = page.getByTestId("optout-skip-notice");
    await expect(aviso).toBeVisible();
    await expect(aviso).toHaveText("3 dos não processados pediram para não receber mensagens e serão pulados no envio.");

    const dialogo = (await page.getByRole("dialog").boundingBox())!;
    const box = await dentroDe(page, "optout-skip-notice", dialogo);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

    // linha separada: fica acima dos filtros, e os filtros continuam visíveis e com o total de sempre
    const filtro = (await page.getByRole("button", { name: "Não processados (12)", exact: true }).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(filtro.y + 0.5);
    await expect(page.getByText("Todos (12)")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/optout-aviso-lote-${viewport.width}.png` });
  });
}

for (const [rotulo, valor] of [["zero", 0], ["null (servidor não soube contar)", null]] as const) {
  test(`lote: com ${rotulo} a linha do aviso não existe`, async ({ page }) => {
    await abrirLote(page, valor);
    await expect(page.getByTestId("optout-skip-notice")).toHaveCount(0);
  });
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 375, height: 700 }]) {
  test(`público, ${viewport.width}px: o aviso cabe na caixa do assistente e no cartão de Campanhas`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${PAGE_URL}?publico=2`);
    const avisos = page.getByTestId("optout-skip-notice");
    await expect(avisos).toHaveCount(2);
    for (const [i, recipiente] of ["caixa-assistente", "cartao-campanhas"].entries()) {
      const aviso = avisos.nth(i);
      await expect(aviso).toBeVisible();
      await expect(aviso).toHaveText("2 leads deste público pediram para não receber mensagens e serão pulados no envio. O total não muda.");
      const fora = (await page.getByTestId(recipiente).boundingBox())!;
      const box = (await aviso.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(fora.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(fora.x + fora.width + 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y).toBeGreaterThanOrEqual(fora.y - 0.5);
      expect(box.y + box.height).toBeLessThanOrEqual(fora.y + fora.height + 0.5);
    }
    await page.screenshot({ path: `${SHOTS}/optout-aviso-publico-${viewport.width}.png` });
  });
}

test("público: singular, e nada quando é zero", async ({ page }) => {
  await page.goto(`${PAGE_URL}?publico=1`);
  await expect(page.getByTestId("optout-skip-notice").first()).toHaveText("1 lead deste público pediu para não receber mensagens e será pulado no envio. O total não muda.");
  await page.goto(`${PAGE_URL}?publico=0`);
  await expect(page.getByText("Público do Banco de Dados Ativo")).toBeVisible();
  await expect(page.getByTestId("optout-skip-notice")).toHaveCount(0);
});
