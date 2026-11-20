// Conversa pessoal (19/11/2026) em Chromium de verdade: a página real da aba Conversas contra o
// servidor de mentira. O empresário usa o WhatsApp pessoal no CRM; família e amigos caíam em
// "Esperam você", no Dashboard e no Plano de ação. O botão marca a conversa como pessoal.
//
// O que este arquivo prova, e que jsdom não prova: o botão "É pessoal" está NA JANELA (computador e
// 375 px), o clique grava o estado certo no servidor, a lista "Pessoais" está no rodapé com o
// número, e a conversa pessoal mostra como desfazer.
//
// Uso: npx playwright test --config playwright.harness.config.ts conversa-pessoal
import { expect, test } from "@playwright/test";
import { PAGE_URL, SHOTS, chatsPage, firstCard, inViewport, ok, serve } from "./conversas-servidor";

const JESSICA = "5534990000001";

// Na lista "Pessoais" o servidor devolve conversas com o estado gravado.
const pessoais = () => {
  const page = chatsPage("pessoais");
  return { ...page, items: page.items.slice(0, 3).map((c) => ({ ...c, state: "pessoal", stateSource: "manual" })), total: 3, hasMore: false };
};
const handler = (route: Parameters<typeof ok>[0], url: URL) =>
  ok(route, url.searchParams.get("tab") === "pessoais" ? pessoais() : chatsPage(url.searchParams.get("tab") || "esperam"));

test.describe("conversa pessoal — computador (1440x900)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("'É pessoal' fica no cabeçalho de quem espera, na janela, e grava o estado 'pessoal'", async ({ page }) => {
    const served = await serve(page, handler);
    await page.goto(PAGE_URL);
    await firstCard(page).click();

    await inViewport(page, "chat-mark-personal");
    await expect(page.getByTestId("chat-mark-personal")).toHaveText(/É pessoal/);
    await page.screenshot({ path: `${SHOTS}/pessoal-cabecalho-computador.png` });

    await page.getByTestId("chat-mark-personal").click();
    // O aviso (toast) não aparece aqui: o harness não monta o Toaster. A prova é o que chegou ao servidor.
    await expect.poll(() => served.states).toEqual([{ phones: [JESSICA], state: "pessoal" }]);
  });

  test("rodapé mostra 'Pessoais' com o número; a conversa pessoal tem a marca e o desfazer", async ({ page }) => {
    const served = await serve(page, handler);
    await page.goto(PAGE_URL);
    await expect(firstCard(page)).toBeVisible();

    await inViewport(page, "inbox-footer-pessoais");
    await expect(page.getByTestId("inbox-footer-count-pessoais")).toHaveText("3");
    await page.getByTestId("inbox-footer-pessoais").click();
    await expect.poll(() => served.tabs.includes("pessoais")).toBe(true);
    await expect(page.getByTestId("inbox-footer-pessoais")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`inbox-item-flags-${JESSICA}`).getByTitle(/Conversa pessoal/)).toBeVisible();

    await firstCard(page).click();
    // Conversa pessoal não oferece "É pessoal" de novo nem "Marcar atendido": oferece desfazer.
    await expect(page.getByTestId("chat-mark-personal")).toHaveCount(0);
    await expect(page.getByTestId("chat-mark-attended")).toHaveCount(0);
    await inViewport(page, "chat-personal-undo");
    await page.screenshot({ path: `${SHOTS}/pessoal-lista-computador.png` });

    await page.getByTestId("chat-personal-undo").click();
    await expect.poll(() => served.states).toEqual([{ phones: [JESSICA], state: "ativa" }]);
  });

  test("o menu da conversa também marca como pessoal", async ({ page }) => {
    const served = await serve(page, handler);
    await page.goto(PAGE_URL);
    await firstCard(page).click();

    await page.getByTestId("chat-menu").click();
    await page.getByTestId("chat-menu-personal").click();
    await expect.poll(() => served.states).toEqual([{ phones: [JESSICA], state: "pessoal" }]);
  });

  test("a seleção em massa marca várias como pessoais de uma vez", async ({ page }) => {
    const served = await serve(page, handler);
    await page.goto(PAGE_URL);
    await expect(firstCard(page)).toBeVisible();

    await page.getByTestId("inbox-filters-button").click();
    await expect(page.getByTestId("inbox-filters-panel")).toBeVisible();
    await page.getByTestId("inbox-select-mode").click();
    await page.getByRole("checkbox", { name: /Selecionar Jéssica/ }).click();
    await page.getByRole("checkbox", { name: /Selecionar Gabriel/ }).click();
    await inViewport(page, "inbox-bulk-personal");
    await page.screenshot({ path: `${SHOTS}/pessoal-massa-computador.png` });
    await page.getByTestId("inbox-bulk-personal").click();
    await expect.poll(() => served.states.length).toBe(1);
    expect(served.states[0].state).toBe("pessoal");
    expect(served.states[0].phones.sort()).toEqual([JESSICA, "5534990000003"].sort());
  });
});

test.describe("conversa pessoal — celular (375x812)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("'É pessoal' cabe na tela do celular depois de abrir a conversa", async ({ page }) => {
    const served = await serve(page, handler);
    await page.goto(PAGE_URL);
    await firstCard(page).click();
    await inViewport(page, "chat-mark-personal");
    await page.screenshot({ path: `${SHOTS}/pessoal-cabecalho-celular.png` });
    await page.getByTestId("chat-mark-personal").click();
    await expect.poll(() => served.states).toEqual([{ phones: [JESSICA], state: "pessoal" }]);
  });
});
