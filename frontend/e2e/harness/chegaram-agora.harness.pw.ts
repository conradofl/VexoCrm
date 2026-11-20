// Faixa "Chegaram agora" em Chromium de verdade, na página REAL de Conversas, contra o servidor de mentira.
// Caso de 19/11/2026: 42 conversas em "Esperam você" (mais parado primeiro), a tela carrega 40, e a mensagem que acabou
// de chegar (Teste 4, 20:36) era a 42ª, fora da tela. O que este arquivo prova, e que jsdom não prova:
//   - a nova aparece no topo da coluna, VISÍVEL sem rolar, com a marca "Nova", em 1440 e em 375 px;
//   - ela não se repete na lista de baixo, e o número da aba continua 42;
//   - com mais de 10, a faixa mostra 10 e "ver todas (12)" abre o resto;
//   - com busca digitada, a faixa some; sem novas, nada aparece e a fila fica no lugar de sempre.
//
// Uso: npx playwright test --config playwright.harness.config.ts chegaram-agora
import { expect, test, type Page } from "@playwright/test";
import { NOW_S, PAGE_URL, SHOTS, chat, chatsPage, firstCard, ok, serve } from "./conversas-servidor";

const NOVO = "5534999997660";
const COUNTS42 = { ...chatsPage().counts, work: { esperam: 42, com_lead: 31, robo: 1, esfriaram: 667 } };

function nova(i: number, minutos: number) {
  const base = chat(100 + i, "esperam");
  const ts = NOW_S() - minutos * 60;
  return {
    ...base,
    id: i === 0 ? NOVO : `55349999970${String(i).padStart(2, "0")}`,
    name: i === 0 ? "Conrado (Teste 4)" : `Novo contato ${i}`,
    timestamp: ts,
    waitingSince: new Date(ts * 1000).toISOString(),
    agentMutedAt: null,
    agentMutedReason: null,
    leadOrigin: null,
    sourceCampaignId: null,
    lastMessage: { ...base.lastMessage, body: i === 0 ? "Teste 4" : `Oi, mensagem nova ${i}`, timestamp: ts, fromMe: false, senderType: "lead" },
  };
}

async function abrir(page: Page, { quantas = 1, busca = false } = {}) {
  const novas = Array.from({ length: quantas }, (_, i) => nova(i, 1 + i * 2));
  const pedidos: string[] = [];
  await serve(page, (route, url) => {
    pedidos.push(url.search);
    const tab = url.searchParams.get("tab") || "esperam";
    const page1 = { ...chatsPage(tab), total: tab === "esperam" ? 42 : 31, counts: COUNTS42 };
    const temBusca = Boolean(url.searchParams.get("search"));
    const offset = Number(url.searchParams.get("offset") || 0);
    if (offset > 0 || temBusca || quantas === 0) return ok(route, page1);
    return ok(route, { ...page1, arrivedNow: { items: novas, total: quantas, minutes: 60 } });
  });
  await page.goto(PAGE_URL);
  await expect(firstCard(page)).toBeVisible();
  return { pedidos, novas };
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`${viewport.width}px: 42 em "Esperam você" e a nova aparece no topo, sem rolar`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await abrir(page);
    const cabecalho = page.getByTestId("arrived-now-header");
    await expect(cabecalho).toBeVisible();
    await expect(cabecalho).toContainText("Chegaram agora");
    const nova = page.getByTestId(`inbox-item-${NOVO}`);
    await expect(nova).toBeVisible();
    await expect(nova).toContainText("Teste 4");
    await expect(nova.getByTestId("arrived-now-badge")).toContainText("Nova");

    // Visível na janela sem rolar, dentro da coluna.
    const caixa = (await nova.boundingBox())!;
    const coluna = (await page.getByTestId("inbox-column").boundingBox())!;
    expect(caixa.y).toBeGreaterThanOrEqual(0);
    expect(caixa.y + caixa.height).toBeLessThanOrEqual(viewport.height);
    expect(caixa.x).toBeGreaterThanOrEqual(coluna.x - 0.5);
    expect(caixa.x + caixa.width).toBeLessThanOrEqual(coluna.x + coluna.width + 0.5);
    expect(await page.getByTestId("inbox-list").evaluate((el) => el.scrollTop)).toBe(0);

    // Uma vez só na tela, e o número da aba continua 42.
    await expect(page.getByTestId(`inbox-item-${NOVO}`)).toHaveCount(1);
    await expect(page.getByTestId("inbox-tab-count-esperam")).toHaveText("42");
    await expect(page.getByTestId("arrived-now-divider")).toContainText("Esperam você");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `${SHOTS}/chegaram-agora-${viewport.width}.png` });
  });

  test(`${viewport.width}px: mais de 10 novas mostra 10 e "ver todas (12)" abre o resto`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await abrir(page, { quantas: 12 });
    await expect(page.getByTestId("arrived-now-badge")).toHaveCount(10);
    const botao = page.getByTestId("arrived-now-toggle");
    await expect(botao).toHaveText("ver todas (12)");
    await botao.click();
    await expect(page.getByTestId("arrived-now-badge")).toHaveCount(12);
    await expect(botao).toHaveText("mostrar 10");
  });
}

test("com busca digitada a faixa some", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await abrir(page);
  await expect(page.getByTestId("arrived-now-header")).toBeVisible();
  await page.getByPlaceholder(/Buscar/).fill("Moacir");
  await expect(page.getByTestId("arrived-now-header")).toHaveCount(0, { timeout: 10_000 });
});

test("sem novas, nada aparece e a fila começa no lugar de sempre", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await abrir(page, { quantas: 0 });
  await expect(page.getByTestId("arrived-now-header")).toHaveCount(0);
  await expect(page.getByTestId("arrived-now-divider")).toHaveCount(0);
  const card = (await firstCard(page).boundingBox())!;
  expect(card.y).toBeLessThan(260);
});
