// Botão "Selecionar" à vista na aba Conversas, em Chromium de verdade, na página REAL contra o servidor de mentira.
// Pedido de 21/11/2026: "Selecionar várias conversas" morava dentro do menu de filtros e ninguém achava.
// O que este arquivo prova, e que jsdom não prova:
//   - o botão aparece SEM abrir menu, dentro da janela e da coluna, em 1440 e em 375 px;
//   - aparece em todas as listas (as três abas e as que ficam no menu, como Pessoais e Pausadas);
//   - fica na mesma linha de "Todos os chips" e não é mais alto que ele: a linha não cresce e a lista não desce;
//   - um clique entra na seleção (caixas de marcar e barra de ações), outro clique sai;
//   - o menu de filtros não repete a opção; com a faixa "Chegaram agora" o botão continua no lugar.
//
// Uso: npx playwright test --config playwright.harness.config.ts selecao-visivel
import { expect, test, type Page } from "@playwright/test";
import { NOW_S, PAGE_URL, SHOTS, chat, chatsPage, firstCard, inViewport, ok, serve } from "./conversas-servidor";

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
];

/** O botão está na mesma linha do link de chip, cabe na coluna e não é mais alto que o link. */
async function botaoNaLinhaDaOrdem(page: Page) {
  const botao = await inViewport(page, "inbox-select-mode");
  const link = (await page.getByTestId("inbox-chip-link").boundingBox())!;
  const coluna = (await page.getByTestId("inbox-column").boundingBox())!;
  const rotulo = (await page.getByTestId("inbox-order-label").boundingBox())!;
  expect(Math.abs(botao.y + botao.height / 2 - (link.y + link.height / 2))).toBeLessThan(2);
  expect(botao.height).toBeLessThanOrEqual(link.height + 0.5);
  expect(botao.x).toBeGreaterThanOrEqual(coluna.x - 0.5);
  expect(link.x + link.width).toBeLessThanOrEqual(coluna.x + coluna.width + 0.5);
  expect(rotulo.x + rotulo.width).toBeLessThanOrEqual(botao.x); // o rótulo corta antes, não passa por baixo
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  return botao;
}

for (const viewport of VIEWPORTS) {
  test.describe(`botão Selecionar à vista (${viewport.width}px)`, () => {
    test.use({ viewport });

    test("aparece sem abrir o menu, em todas as listas, e o menu não repete a opção", async ({ page }) => {
      const served = await serve(page);
      await page.goto(PAGE_URL);
      await expect(firstCard(page)).toBeVisible();

      await expect(page.getByTestId("inbox-filters-panel")).toBeHidden();
      await expect(page.getByTestId("inbox-select-mode")).toHaveText("Selecionar");
      await expect(page.getByTestId("inbox-select-mode")).toHaveAttribute("aria-pressed", "false");
      const botao = await botaoNaLinhaDaOrdem(page);
      if (viewport.width < 768) {
        expect(botao.width).toBeGreaterThanOrEqual(44);
        expect(botao.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: `${SHOTS}/selecao-visivel-${viewport.width}.png` });

      for (const aba of ["com_lead", "robo"]) {
        await page.getByTestId(`inbox-tab-${aba}`).click();
        await expect.poll(() => served.tabs.includes(aba)).toBe(true);
        await botaoNaLinhaDaOrdem(page);
      }

      // Listas do rodapé da coluna.
      for (const lista of ["pessoais", "grupos"]) {
        await page.getByTestId(`inbox-footer-${lista}`).click();
        await expect.poll(() => served.tabs.includes(lista)).toBe(true);
        await botaoNaLinhaDaOrdem(page);
      }

      // Listas do menu de filtros; o menu não repete a opção.
      const panel = page.getByTestId("inbox-filters-panel");
      for (const lista of ["pausadas", "esfriaram"]) {
        await page.getByTestId("inbox-filters-button").click();
        await expect(panel).toBeVisible();
        await expect(panel.getByTestId("inbox-select-mode")).toHaveCount(0);
        await expect(panel).not.toContainText("Selecionar várias conversas");
        await panel.getByTestId(`inbox-footer-${lista}`).click();
        await expect.poll(() => served.tabs.includes(lista)).toBe(true);
        await expect(panel).toBeHidden();
        await botaoNaLinhaDaOrdem(page);
      }
    });

    test("um clique entra na seleção e já marca; outro clique sai", async ({ page }) => {
      await serve(page);
      await page.goto(PAGE_URL);
      await expect(firstCard(page)).toBeVisible();
      const antes = (await firstCard(page).boundingBox())!;

      const botao = page.getByTestId("inbox-select-mode");
      await botao.click();
      await expect(botao).toHaveAttribute("aria-pressed", "true");
      await expect(botao).toHaveText("Sair da seleção");
      await expect(page.getByTestId("inbox-bulk-bar")).toBeVisible();
      await page.getByRole("checkbox", { name: /Selecionar Jéssica/ }).click();
      await page.getByRole("checkbox", { name: /Selecionar Gabriel/ }).click();
      await expect(page.getByTestId("inbox-bulk-bar")).toContainText("2 selecionadas");
      for (const acao of ["Cadastrar leads", "Pessoal", "Arquivar", "Sair"]) {
        await expect(page.getByTestId("inbox-bulk-bar").getByRole("button", { name: acao, exact: true })).toBeVisible();
      }
      await botaoNaLinhaDaOrdem(page);
      await page.screenshot({ path: `${SHOTS}/selecao-visivel-marcando-${viewport.width}.png` });

      await botao.click();
      await expect(botao).toHaveAttribute("aria-pressed", "false");
      await expect(page.getByTestId("inbox-bulk-bar")).toBeHidden();
      await expect(page.getByRole("checkbox", { name: /Selecionar Jéssica/ })).toHaveCount(0);
      const depois = (await firstCard(page).boundingBox())!;
      expect(Math.abs(depois.y - antes.y)).toBeLessThan(1); // sair da seleção devolve a lista ao mesmo lugar
    });

    test("com a faixa 'Chegaram agora' o botão continua na linha e a faixa continua à vista", async ({ page }) => {
      const ts = NOW_S() - 60;
      const base = chat(100, "esperam");
      const nova = {
        ...base,
        id: "5534999997660",
        name: "Contato novo",
        timestamp: ts,
        waitingSince: new Date(ts * 1000).toISOString(),
        lastMessage: { ...base.lastMessage, body: "Oi", timestamp: ts, fromMe: false, senderType: "lead" },
      };
      await serve(page, (route, url) => {
        const tab = url.searchParams.get("tab") || "esperam";
        const page1 = chatsPage(tab);
        if (Number(url.searchParams.get("offset") || 0) > 0) return ok(route, page1);
        return ok(route, { ...page1, arrivedNow: { items: [nova], total: 1, minutes: 60 } });
      });
      await page.goto(PAGE_URL);
      await expect(page.getByTestId("arrived-now-header")).toBeVisible();
      const botao = await botaoNaLinhaDaOrdem(page);
      const faixa = await inViewport(page, "arrived-now-header");
      expect(faixa.y).toBeGreaterThan(botao.y);
      await inViewport(page, "inbox-item-5534999997660");
      await page.screenshot({ path: `${SHOTS}/selecao-visivel-chegaram-${viewport.width}.png` });
    });
  });
}
