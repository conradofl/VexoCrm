// "Separar lotes" do Banco de Dados em Chromium de verdade. O que este arquivo prova, e que jsdom não prova:
//   - o botão "Separar lotes" aparece na barra do Banco, e a janela abre POR CIMA da página (fora do <main>), inteira
//     dentro da tela, em 1366 px e em 375 px, mesmo com a página rolada;
//   - a prévia mostra os números da base da empresa certa; a conferência de WhatsApp está desligada (antibloqueio,
//     27/11/2026): só um aviso, sem botão e sem chamada; separar manda tamanho, quantidade e "só confirmados" desligado
//     por padrão, e lista as planilhas criadas;
//   - nada estoura a largura da janela no celular.
//
// Uso: npx playwright test --config playwright.harness.config.ts separar-lotes
import { expect, test, type Page } from "@playwright/test";

const PAGE_URL = "/e2e/harness/separar-lotes.html";
const SHOTS = process.env.HARNESS_SHOTS_DIR || "test-results/harness";

const PREVIA = {
  total: 2274, celular: 2224, fixo: 35, invalido: 15, whatsapp_confirmado: 719, sem_whatsapp: 5, nao_conferido: 1548,
  opt_out: 0, ja_recebeu: 0, ja_separado: 50, disponivel_confirmado: 644, disponivel_sem_conferir: 2216,
  inutil_sem_whatsapp: 11, inutil_fixo_nao_conferido: 0, inutil_invalido: 0,
};

async function abrir(page: Page) {
  const pedidos: { metodo: string; url: string; corpo: unknown }[] = [];
  let conferindo = false;
  let parada = false;
  await page.route("**/api/leads/lotes/previa**", (route) => {
    pedidos.push({ metodo: route.request().method(), url: route.request().url(), corpo: null });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        previa: PREVIA,
        conferencia: conferindo
          ? { rodando: true, chipNome: "Comercial- Tinge Brasil", totalNaFila: 1548, conferidos: 300, comWhatsapp: 290, semWhatsapp: 10 }
          : parada
            ? { rodando: false, motivoFim: "parada_pelo_usuario" }
            : { rodando: false },
      }),
    });
  });
  await page.route("**/api/leads/conferencia-whatsapp**", (route) => {
    const corpo = route.request().postDataJSON?.() ?? null;
    pedidos.push({ metodo: route.request().method(), url: route.request().url(), corpo });
    conferindo = route.request().method() === "POST";
    parada = route.request().method() === "DELETE";
    return route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        conferencia: conferindo
          ? { rodando: true, chipNome: "Comercial- Tinge Brasil", totalNaFila: 1548, conferidos: 0, comWhatsapp: 0, semWhatsapp: 0 }
          : { rodando: false, motivoFim: "parada_pelo_usuario" },
      }),
    });
  });
  await page.route("**/api/leads/lotes", (route) => {
    const corpo = route.request().postDataJSON();
    pedidos.push({ metodo: route.request().method(), url: route.request().url(), corpo });
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        planilhas: [
          { id: "p2", nome: "Natal · Lote 02 · 50 leads", numero: 2, leads: 50 },
          { id: "p3", nome: "Natal · Lote 03 · 50 leads", numero: 3, leads: 50 },
        ],
        separados: 100,
        disponiveisRestantes: 544,
      }),
    });
  });
  let apagou = false;
  await page.route("**/api/leads/mass-delete/preview", (route) => {
    pedidos.push({ metodo: "POST", url: route.request().url(), corpo: route.request().postDataJSON() });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, preview: apagou ? { willDelete: 0, kept: 1 } : { willDelete: 11, kept: 1, keptReasons: { withMessages: 1 }, confirmation: { typedRequired: false, threshold: 500 } } }),
    });
  });
  await page.route("**/api/leads/mass-delete/execute", (route) => {
    pedidos.push({ metodo: "POST", url: route.request().url(), corpo: route.request().postDataJSON() });
    apagou = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, report: { deleted: 11 } }) });
  });
  await page.goto(PAGE_URL);
  await page.mouse.wheel(0, 600);
  await page.getByTestId("btn-separate-batches").scrollIntoViewIfNeeded();
  await page.getByTestId("btn-separate-batches").click();
  const janela = page.getByRole("dialog");
  await expect(janela).toBeVisible();
  await expect(page.getByTestId("previa-disponivel")).toContainText("2.216");
  return { pedidos, janela };
}

async function dentroDaTela(page: Page, locator: ReturnType<Page["getByRole"]>) {
  const box = await locator.boundingBox();
  const vp = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 0.5);
}

for (const [nome, viewport] of [
  ["computador", { width: 1366, height: 768 }],
  ["celular", { width: 375, height: 740 }],
] as const) {
  test(`janela de separar lotes visível e dentro da tela no ${nome}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { pedidos, janela } = await abrir(page);

    // Por cima da página, não no fluxo dela.
    expect(await janela.evaluate((el) => Boolean(el.closest("main")))).toBe(false);
    await dentroDaTela(page, janela);
    expect(pedidos[0].url).toContain("clientId=tinge-brasil");

    // Nada estoura a largura da janela.
    const estouro = await janela.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(estouro).toBeLessThanOrEqual(1);

    for (const id of ["previa-total", "previa-confirmado", "previa-nao-conferido", "previa-fixo", "previa-disponivel"]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await page.screenshot({ path: `${SHOTS}/separar-lotes-${nome}.png` });
  });
}

test("conferência de WhatsApp desligada: só o aviso, sem botão e sem chamada", async ({ page }) => {
  const { pedidos } = await abrir(page);
  await expect(page.getByTestId("conferencia-desligada")).toContainText("Conferência de WhatsApp desligada");
  await expect(page.getByTestId("btn-conferir")).toHaveCount(0);
  expect(pedidos.some((p) => p.url.includes("conferencia-whatsapp"))).toBe(false);
  // Ligar "só confirmados" ainda funciona para quem foi conferido antes.
  await page.getByTestId("exigir-whatsapp").click();
  await expect(page.getByTestId("previa-disponivel")).toContainText("644");
});

test("separar manda tamanho, quantidade e só confirmados, e lista as planilhas criadas", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  const { pedidos } = await abrir(page);
  await page.getByLabel("Leads por lote").fill("50");
  await page.getByLabel("Quantos lotes").fill("2");
  await page.getByLabel("Nome (opcional)").fill("Natal");
  await expect(page.getByTestId("resumo-separacao")).toContainText("2 planilha(s) com 100 leads");
  await page.getByTestId("btn-separar").scrollIntoViewIfNeeded();
  await page.getByTestId("btn-separar").click();
  const criadas = page.getByTestId("planilhas-criadas");
  await expect(criadas).toBeVisible();
  await criadas.scrollIntoViewIfNeeded();
  await expect(criadas).toContainText("Natal · Lote 02 · 50 leads");
  const post = pedidos.find((p) => p.metodo === "POST" && p.url.endsWith("/api/leads/lotes"));
  expect(post?.corpo).toEqual({ clientId: "tinge-brasil", tamanho: 50, quantidade: 2, nomeBase: "Natal", exigirWhatsapp: false });
  const box = await criadas.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(740 + 0.5);
  await page.screenshot({ path: `${SHOTS}/separar-lotes-criadas-celular.png` });
});

test("limpar números que não servem: mostra quantos, pede confirmação e apaga só o que a prévia mostrou", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  const { pedidos } = await abrir(page);
  const secao = page.getByTestId("limpeza-secao");
  await secao.scrollIntoViewIfNeeded();
  await expect(page.getByTestId("limpeza-resumo")).toContainText("Vai apagar 11 lead(s) de vez");
  await expect(page.getByTestId("limpeza-resumo")).toContainText("1 fica porque já conversou");
  await page.getByTestId("btn-limpar").click();
  const confirmar = page.getByTestId("limpeza-confirmar");
  await expect(confirmar).toBeVisible();
  await expect(confirmar).toContainText("Não dá para desfazer");
  await page.getByTestId("btn-limpar-confirmar").scrollIntoViewIfNeeded();
  const box = await page.getByTestId("btn-limpar-confirmar").boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(740 + 0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375 + 0.5);
  await page.screenshot({ path: `${SHOTS}/limpeza-confirmar-celular.png` });
  await page.getByTestId("btn-limpar-confirmar").click();
  await expect(page.getByTestId("limpeza-feita")).toContainText("11 lead(s) apagado(s)");
  const exec = pedidos.find((p) => p.url.endsWith("/api/leads/mass-delete/execute"));
  expect(exec?.corpo).toEqual({ clientId: "tinge-brasil", criterion: { type: "inutilizaveis" }, options: {}, expectedCount: 11 });
});
