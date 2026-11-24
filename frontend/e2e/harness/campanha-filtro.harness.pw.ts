// Filtro "Campanha" da coluna de Conversas, em Chromium de verdade, na página REAL contra o servidor de mentira.
// Pedido do Conrado em 24/11/2026: no meio de tantas conversas do WhatsApp não dava para achar as de cada campanha.
// O que este arquivo prova, em 1440 e em 375 px:
//   - o painel de filtros tem "Campanha" com as campanhas que já mandaram mensagem;
//   - escolher uma manda campaignId ao servidor, a lista e o número da aba passam a ser só os dela;
//   - uma faixa visível diz qual campanha está filtrando, e o X tira o filtro (lista inteira volta).
//
// Uso: npx playwright test --config playwright.harness.config.ts campanha-filtro
import { expect, test, type Page } from "@playwright/test";
import { PAGE_URL, SHOTS, chatsPage, firstCard, ok, serve } from "./conversas-servidor";

const CAMP_AVALIACAO = "bab84af4-3a4c-49dc-a2b1-4453a6805352";
const CAMP_SITE = "0ddbdbfd-f87d-4bca-8b9c-0a59186531a1";
const CAMPANHAS = [
  { id: CAMP_AVALIACAO, name: "Tinge · Avaliação no Google · Clientes atendidos", sent: 56, lastSentAt: "2026-11-24T13:00:00Z" },
  { id: CAMP_SITE, name: "Tinge · Conheça o site (simulador de cor) · Lote 01", sent: 100, lastSentAt: "2026-11-23T13:00:00Z" },
];

async function abrir(page: Page) {
  const pedidos: URLSearchParams[] = [];
  await serve(page, (route, url) => {
    pedidos.push(url.searchParams);
    const tab = url.searchParams.get("tab") || "esperam";
    const full = chatsPage(tab);
    if (url.searchParams.get("campaignId") === CAMP_AVALIACAO) {
      // Só 3 conversas de quem recebeu a campanha; contadores também da campanha.
      return ok(route, {
        ...full,
        items: full.items.slice(0, 3),
        total: 3,
        hasMore: false,
        nextOffset: null,
        counts: { ...full.counts, work: { esperam: 3, com_lead: 50, robo: 0, esfriaram: 3 } },
      });
    }
    return ok(route, full);
  });
  // Registrada depois de serve(): o Playwright usa a rota mais nova primeiro.
  await page.route("**/api/whatsapp/chats/campaigns**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: CAMPANHAS }) })
  );
  await page.goto(PAGE_URL);
  await expect(firstCard(page)).toBeVisible();
  return pedidos;
}

// Só o cartão (inbox-item-<telefone>): hora e marcas usam o mesmo prefixo.
const itens = (page: Page) => page.locator('[data-testid^="inbox-item-"]:not([data-testid^="inbox-item-time-"]):not([data-testid^="inbox-item-flags-"])');

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`${viewport.width}px: filtrar por campanha mostra só as conversas dela e o X volta tudo`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const pedidos = await abrir(page);
    await expect(page.getByTestId("inbox-campaign-filter-bar")).toHaveCount(0);
    expect(await itens(page).count()).toBeGreaterThanOrEqual(40);

    await page.getByTestId("inbox-filters-button").click();
    const painel = page.getByTestId("inbox-campaign-scope");
    await expect(painel).toBeVisible();
    await expect(painel).toContainText("Campanha");
    await page.getByTestId("inbox-campaign-trigger").click();
    const opcao = page.getByRole("option", { name: /Conheça o site/ });
    await expect(opcao).toBeVisible();
    // A lista de campanhas cabe na tela (nome comprido quebra linha em vez de passar da borda).
    await expect.poll(async () => {
      const b = await page.getByRole("listbox").boundingBox();
      return b ? b.x >= 0 && b.x + b.width <= viewport.width + 0.5 : false;
    }).toBe(true);
    await page.waitForTimeout(300); // fim da animação, para a foto
    await page.screenshot({ path: `${SHOTS}/campanha-filtro-${viewport.width}-lista.png` });
    await page.getByRole("option", { name: /Avaliação no Google.*56 receberam/ }).click();
    await page.keyboard.press("Escape");

    const faixa = page.getByTestId("inbox-campaign-filter-bar");
    await expect(faixa).toBeVisible();
    await expect(faixa).toContainText("Campanha: Tinge · Avaliação no Google");
    await expect(faixa).toContainText("56 receberam");
    await expect.poll(() => pedidos.some((p) => p.get("campaignId") === CAMP_AVALIACAO)).toBe(true);
    await expect(itens(page)).toHaveCount(3);
    await expect(page.getByTestId("inbox-tab-count-esperam")).toHaveText("3");

    // Faixa inteira dentro da tela, sem rolagem lateral.
    const box = await faixa.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 0.5);
    const larguraPagina = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(larguraPagina).toBeLessThanOrEqual(viewport.width + 1);
    await expect(page.getByTestId("inbox-filters-panel")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/campanha-filtro-${viewport.width}-filtrado.png` });

    // Tirar o filtro volta à lista inteira (a tela reaproveita a que já tinha carregado).
    await page.getByTestId("inbox-campaign-filter-clear").click();
    await expect(faixa).toHaveCount(0);
    await expect.poll(() => itens(page).count()).toBeGreaterThanOrEqual(40);
    await expect(page.getByTestId("inbox-tab-count-esperam")).not.toHaveText("3");
  });
}
