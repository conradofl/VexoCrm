// Diário do chip em Chromium de verdade. O que este arquivo prova, e que jsdom não prova:
//   - a aba Saúde & Volume pede /api/reports/chip-diary da empresa certa e mostra as quedas reais da Nous (17/11/2026)
//     com motivo e foto do que o Vexo enviou antes, VISÍVEIS e dentro do bloco e da janela, em 1366 px e em 375 px;
//   - nada estoura a largura da página no celular.
//
// Uso: npx playwright test --config playwright.harness.config.ts chip-diario
import { expect, test, type Page } from "@playwright/test";

const PAGE_URL = "/e2e/harness/chip-diario.html";
const SHOTS = process.env.HARNESS_SHOTS_DIR || "test-results/harness";
const MOTIVO =
  "Aparelho removido do WhatsApp: a conexão do Vexo saiu de \"Aparelhos conectados\". Alguém removeu pelo celular, ou o próprio WhatsApp desconectou. (código 401)";

const DIARIO = {
  available: true,
  items: [
    {
      id: "e2", instance_name: "nous-gestao-chip-2-nous", chip_name: "Chip 2 - NOUS", kind: "queda",
      occurred_at: "2026-11-17T12:38:21.100Z", occurred_at_approx: false, reason_code: 401, reason_kind: "aparelho_removido",
      reason_label: MOTIVO,
      snapshot: { limite_diario: 50, envios_1h: 46, envios_24h: 46, ultimo_envio: "2026-11-17T12:38:14.000Z", segundos_do_ultimo_envio_ate_a_queda: 7, invalidos_24h: 37, cota_usada_no_dia: 50 },
    },
    {
      id: "e3", instance_name: "nous-gestao-pessoal-moacir", chip_name: "Pessoal - Moacir", kind: "queda",
      occurred_at: "2026-11-17T01:18:53.111Z", occurred_at_approx: false, reason_code: 401, reason_kind: "aparelho_removido",
      reason_label: MOTIVO,
      snapshot: { limite_diario: 50, envios_1h: 0, envios_24h: 0, ultimo_envio: null, segundos_do_ultimo_envio_ate_a_queda: null, invalidos_24h: 0, cota_usada_no_dia: null },
    },
    {
      id: "e1", instance_name: "nous-gestao-chip-1-nous", chip_name: "Chip 1 - NOUS", kind: "queda",
      occurred_at: "2026-11-13T17:02:21.536Z", occurred_at_approx: false, reason_code: 401, reason_kind: "aparelho_removido",
      reason_label: MOTIVO,
      snapshot: { limite_diario: 50, envios_1h: 0, envios_24h: 0, ultimo_envio: null, segundos_do_ultimo_envio_ate_a_queda: null, invalidos_24h: 0, cota_usada_no_dia: null },
    },
  ],
};

async function abrir(page: Page) {
  const pedidos: string[] = [];
  await page.route("**/api/reports/evolution-usage**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ days: 14, items: [
      { dia: "2026-11-17", chip_id: "84e785c6", chip_label: "Chip 2 - NOUS", enviados: 50 },
      { dia: "2026-11-13", chip_id: "e5a51d87", chip_label: "Chip 4 - NOUS", enviados: 50 },
    ] }) })
  );
  await page.route("**/api/reports/chip-diary**", (route) => {
    pedidos.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DIARIO) });
  });
  await page.goto(PAGE_URL);
  await expect(page.getByTestId("chip-diary-list")).toBeVisible();
  return { pedidos };
}

function dentro(box: { x: number; y: number; width: number; height: number }, fora: { x: number; y: number; width: number; height: number }) {
  expect(box.width).toBeGreaterThan(40);
  expect(box.height).toBeGreaterThan(10);
  expect(box.x).toBeGreaterThanOrEqual(fora.x - 0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(fora.x + fora.width + 0.5);
  expect(box.y).toBeGreaterThanOrEqual(fora.y - 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(fora.y + fora.height + 0.5);
}

for (const viewport of [{ width: 1366, height: 900 }, { width: 375, height: 900 }]) {
  test(`diário do chip, ${viewport.width}px: quedas da Nous com motivo e foto, dentro do bloco e da janela`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { pedidos } = await abrir(page);
    expect(pedidos).toHaveLength(1);
    expect(new URL(pedidos[0]).searchParams.get("clientId")).toBe("nous-gestao");

    const bloco = page.getByTestId("chip-diary");
    await bloco.scrollIntoViewIfNeeded();
    const caixaBloco = (await bloco.boundingBox())!;
    const largura = viewport.width;
    expect(caixaBloco.x + caixaBloco.width).toBeLessThanOrEqual(largura + 0.5);

    const eventos = page.getByTestId("chip-diary-event");
    await expect(eventos).toHaveCount(3);
    const chip2 = eventos.nth(0);
    await expect(chip2).toContainText("Chip 2 - NOUS caiu");
    await expect(chip2).toContainText("17/11/2026, 09:38:21");
    await expect(chip2.getByTestId("chip-diary-reason")).toHaveText(MOTIVO);
    await expect(chip2.getByTestId("chip-diary-snapshot").nth(0)).toHaveText(
      "Antes da queda: 46 envios de campanha na última hora (46 em 24 h), último envio 7 s antes da queda."
    );
    await expect(eventos.nth(1)).toContainText("O Vexo não enviou mensagens de campanha por este chip nas 24 h antes da queda.");

    for (const alvo of [chip2.getByTestId("chip-diary-reason"), chip2.getByTestId("chip-diary-snapshot").nth(0), eventos.nth(1)]) {
      await alvo.scrollIntoViewIfNeeded();
      await expect(alvo).toBeVisible();
      dentro((await alvo.boundingBox())!, (await bloco.boundingBox())!);
    }

    // A página não ganha rolagem lateral no celular.
    const larguraDoc = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(larguraDoc).toBeLessThanOrEqual(largura);
    await page.screenshot({ path: `${SHOTS}/chip-diario-${viewport.width}.png`, fullPage: true });
  });
}
