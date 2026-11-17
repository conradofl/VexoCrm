// "Esperam você" com o motivo de o robô não ter respondido (revisão do #269, 17/11/2026), em Chromium de verdade: a
// PÁGINA real de Conversas, com os hooks reais, contra o servidor de mentira de conversas-servidor.ts.
//
// O que este arquivo prova, e que jsdom não prova:
//   - a conversa cuja última mensagem do lead chegou atrasada (meta.agente_barrado = "mensagem_atrasada") mostra o selo
//     "Chegou atrasada" e a borda de atenção, VISÍVEIS e dentro do cartão, no computador e em 375 px;
//   - "envio sem confirmação" mostra o selo próprio;
//   - as outras conversas não ganham selo nenhum, e nada estoura a largura no celular.
//
// Uso: npx playwright test --config playwright.harness.config.ts conversa-atrasada
import { expect, test } from "@playwright/test";
import { PAGE_URL, SHOTS, chatsPage, firstCard, ok, serve } from "./conversas-servidor";

const ATRASADA = "5534990000001";
const SEM_CONFIRMACAO = "5534990000004";

function paginaComBarradas(tab: string) {
  const base = chatsPage(tab);
  if (tab !== "esperam") return base;
  for (const item of base.items) {
    if (item.id === ATRASADA) item.lastMessage.meta = { agente_barrado: "mensagem_atrasada" } as never;
    if (item.id === SEM_CONFIRMACAO) item.lastMessage.meta = { agente_barrado: "envio_sem_confirmacao" } as never;
  }
  return base;
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test.describe(`Esperam você com o motivo, ${viewport.width}px`, () => {
    test.use({ viewport });

    test("selo 'Chegou atrasada' e borda de atenção no cartão certo, dentro do cartão e da janela", async ({ page }) => {
      await serve(page, (route, url) => ok(route, paginaComBarradas(url.searchParams.get("tab") || "esperam")));
      await page.goto(PAGE_URL);
      await expect(firstCard(page)).toBeVisible();

      const cartao = page.getByTestId(`inbox-item-${ATRASADA}`);
      const selo = cartao.getByText("Chegou atrasada", { exact: true });
      await expect(selo).toBeVisible();
      await expect(selo).toHaveAttribute("title", /O robô não respondeu: mensagem chegou atrasada/);
      const caixaCartao = (await cartao.boundingBox())!;
      const caixaSelo = (await selo.boundingBox())!;
      expect(caixaSelo.x).toBeGreaterThanOrEqual(caixaCartao.x - 0.5);
      expect(caixaSelo.x + caixaSelo.width).toBeLessThanOrEqual(caixaCartao.x + caixaCartao.width + 0.5);
      expect(caixaSelo.x + caixaSelo.width).toBeLessThanOrEqual(viewport.width);
      // Borda de atenção (o ícone de atenção humana carrega o motivo).
      await expect(cartao.locator('[title^="Atenção humana: Robô não respondeu: mensagem chegou atrasada"]')).toHaveCount(1);

      await expect(page.getByTestId(`inbox-item-${SEM_CONFIRMACAO}`).getByText("Envio sem confirmação", { exact: true })).toBeVisible();
      // Conversa comum: sem selo.
      await expect(page.getByTestId("inbox-item-5534990000005").getByText("Chegou atrasada")).toHaveCount(0);

      const larguraDoc = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(larguraDoc).toBeLessThanOrEqual(viewport.width);
      await page.screenshot({ path: `${SHOTS}/conversa-atrasada-${viewport.width}.png` });
    });
  });
}
