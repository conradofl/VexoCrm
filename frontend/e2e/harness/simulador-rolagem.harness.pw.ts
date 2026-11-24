// Simulador de WhatsApp em Chromium de verdade: o corpo do simulador rola sozinho.
//
// O que este arquivo prova, e que jsdom não prova:
//   - no computador o painel inteiro cabe na janela, mesmo com roteiro de 4 portas;
//   - o corpo tem barra própria: dá para chegar na última mensagem rolando só o simulador, sem a página sair do lugar;
//   - descendo a página, o painel continua preso no topo (sticky) e visível;
//   - em 375 px o painel não passa da largura da tela e também rola por dentro.
//
// Uso: npx playwright test --config playwright.harness.config.ts simulador-rolagem
import { expect, test } from "@playwright/test";

const SHOTS = process.env.HARNESS_SHOTS_DIR || "test-results/harness";
const URL = "/e2e/harness/simulador-rolagem.html";

test("computador 1440: painel cabe na janela e rola por dentro até a última mensagem", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(URL);
  const painel = page.getByTestId("simulador-whatsapp");
  const corpo = page.getByTestId("simulador-rolagem");
  await expect(corpo).toBeVisible();

  const caixa = await painel.boundingBox();
  expect(caixa!.y + caixa!.height).toBeLessThanOrEqual(900);

  const medidas = await corpo.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, ov: getComputedStyle(el).overflowY }));
  expect(medidas.ov).toBe("auto");
  expect(medidas.sh).toBeGreaterThan(medidas.ch);

  const ultima = page.getByText("ULTIMA MENSAGEM DO ROTEIRO");
  await expect(ultima).not.toBeInViewport();
  await page.screenshot({ path: `${SHOTS}/simulador-1440-topo.png` });

  await corpo.hover();
  const scrollPaginaAntes = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 4000);
  await expect(ultima).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollPaginaAntes);
  await page.screenshot({ path: `${SHOTS}/simulador-1440-fim.png` });

  // descendo a página pelo formulário, o simulador continua visível e preso no topo
  await page.getByText("Bloco do formulário 1", { exact: true }).hover();
  await page.mouse.wheel(0, 2500);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  const presa = await painel.boundingBox();
  expect(presa!.y).toBeGreaterThanOrEqual(0);
  expect(presa!.y + presa!.height).toBeLessThanOrEqual(900);
  await page.screenshot({ path: `${SHOTS}/simulador-1440-pagina-descida.png` });
});

test("celular 375: painel na largura da tela e rolagem própria", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(URL);
  const painel = page.getByTestId("simulador-whatsapp");
  await painel.scrollIntoViewIfNeeded();
  const caixa = await painel.boundingBox();
  expect(caixa!.x).toBeGreaterThanOrEqual(0);
  expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(375);
  expect(caixa!.height).toBeLessThanOrEqual(812 * 0.8 + 1);
  const corpo = page.getByTestId("simulador-rolagem");
  const m = await corpo.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  expect(m.sh).toBeGreaterThan(m.ch);
  await corpo.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.getByText("ULTIMA MENSAGEM DO ROTEIRO")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: `${SHOTS}/simulador-375.png` });
});
