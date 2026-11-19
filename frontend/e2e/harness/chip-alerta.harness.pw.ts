// Aviso de chip conectado que recebe com atraso ou ficou mudo (19/11/2026), em Chromium de verdade. O que este arquivo
// prova, e que jsdom não prova:
//   - Conversas (página REAL) pede /api/whatsapp/chip-alerts da empresa certa e mostra o aviso no topo da fila,
//     VISÍVEL, dentro da coluna e da janela, sem empurrar a fila para fora da tela, em 1440 e em 375 px;
//   - sem alerta, a fila fica onde estava (o aviso não ocupa espaço);
//   - Diário do chip (aba Saúde & Volume) mostra o mesmo aviso no topo do cartão, em 1440 e em 375 px;
//   - nada estoura a largura da página no celular.
// Números de 19/11: container-led 9499 com até 9 h 42 min de atraso, Tinge sem receber há 47 min.
//
// Uso: npx playwright test --config playwright.harness.config.ts chip-alerta
import { expect, test, type Page } from "@playwright/test";
import { PAGE_URL, SHOTS, firstCard, serve, tenant } from "./conversas-servidor";

const ALERTAS = {
  limiteMin: 30,
  verificadoEm: "2026-11-19T18:00:00.000Z",
  alertas: [
    { instancia: "container-led-chip-de-disparo-atendimento", tipo: "atrasado", mensagensAtrasadas: 12, maiorAtrasoMin: 582, ultimaChegada: "2026-11-19T17:55:00.000Z" },
    { instancia: "tinge-brasil", tipo: "mudo", minutosSemReceber: 47, diasComEntradaNestaHora: 6, ultimaChegada: "2026-11-19T17:13:00.000Z" },
  ],
};
const SEM_ALERTA = { limiteMin: 30, verificadoEm: "2026-11-19T18:00:00.000Z", alertas: [] };

async function alertas(page: Page, corpo: unknown) {
  const pedidos: string[] = [];
  // Registrado DEPOIS do serve(): no Playwright a rota mais nova responde primeiro.
  await page.route("**/api/whatsapp/chip-alerts**", (route) => {
    pedidos.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(corpo) });
  });
  return pedidos;
}

type Box = { x: number; y: number; width: number; height: number };
function dentro(box: Box, fora: Box) {
  expect(box.width).toBeGreaterThan(40);
  expect(box.height).toBeGreaterThan(10);
  expect(box.x).toBeGreaterThanOrEqual(fora.x - 0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(fora.x + fora.width + 0.5);
  expect(box.y).toBeGreaterThanOrEqual(fora.y - 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(fora.y + fora.height + 0.5);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`Conversas, ${viewport.width}px: aviso no topo da fila, visível e dentro da coluna`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await serve(page);
    const pedidos = await alertas(page, ALERTAS);
    await page.goto(PAGE_URL);
    await expect(firstCard(page)).toBeVisible();

    const banner = page.getByTestId("chip-alert-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("role", "alert");
    await expect(banner.getByTestId("chip-alert")).toHaveCount(2);
    await expect(banner).toContainText("12 mensagens chegaram com até 9 h 42 min de atraso");
    await expect(banner).toContainText("nenhuma mensagem recebida há 47 min");

    const coluna = (await page.getByTestId("inbox-column").boundingBox())!;
    const caixa = (await banner.boundingBox())!;
    dentro(caixa, coluna);
    dentro(caixa, { x: 0, y: 0, width: viewport.width, height: viewport.height });
    // A fila continua na tela, logo abaixo.
    const card = (await firstCard(page).boundingBox())!;
    expect(card.y).toBeGreaterThan(caixa.y + caixa.height - 1);
    expect(card.y).toBeLessThan(viewport.height);

    expect(pedidos.length).toBeGreaterThanOrEqual(1);
    expect(new URL(pedidos[0]).searchParams.get("clientId")).toBe(tenant.id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `${SHOTS}/chip-alerta-conversas-${viewport.width}.png` });
  });

  test(`Conversas, ${viewport.width}px: sem alerta, nada aparece e a fila fica no mesmo lugar de antes`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await serve(page);
    // Antes: servidor sem a rota de alerta (404), como era até hoje.
    await page.goto(PAGE_URL);
    await expect(firstCard(page)).toBeVisible();
    const antes = (await firstCard(page).boundingBox())!;

    // Agora: servidor responde lista vazia.
    const pedidos = await alertas(page, SEM_ALERTA);
    await page.reload();
    await expect(firstCard(page)).toBeVisible();
    await expect.poll(() => pedidos.length).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("chip-alert-banner")).toHaveCount(0);
    const depois = (await firstCard(page).boundingBox())!;
    expect(Math.abs(depois.y - antes.y)).toBeLessThan(1);
  });

  test(`Diário do chip, ${viewport.width}px: aviso no topo do cartão, visível e dentro dele`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/reports/evolution-usage**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ days: 14, items: [] }) })
    );
    await page.route("**/api/reports/chip-diary**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: true, items: [] }) })
    );
    const pedidos = await alertas(page, ALERTAS);
    await page.goto("/e2e/harness/chip-diario.html");
    const diario = page.getByTestId("chip-diary");
    await expect(diario.getByTestId("chip-diary-empty")).toBeVisible();
    const banner = diario.getByTestId("chip-alert-banner");
    await expect(banner).toBeVisible();
    await expect(banner.getByTestId("chip-alert")).toHaveCount(2);
    dentro((await banner.boundingBox())!, (await diario.boundingBox())!);
    expect(new URL(pedidos[0]).searchParams.get("clientId")).toBe("nous-gestao");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `${SHOTS}/chip-alerta-diario-${viewport.width}.png`, fullPage: true });
  });
}
