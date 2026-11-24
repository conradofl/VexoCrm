// "Enviar em lotes" com máximo por dia em Chromium de verdade. Prova, em 1366 e 375 px: o campo "Máximo por dia"
// e o resumo dos horários aparecem dentro da tela, e o resumo de 100 leads, 5 por hora, até 50 por dia dá 20 lotes
// em 2 dias. Baixar o máximo para 25 espalha os mesmos lotes em 4 dias. Nada estoura a largura no celular.
//
// Uso: npx playwright test --config playwright.harness.config.ts ritmo-lotes
import { expect, test } from "@playwright/test";

const PAGE_URL = "/e2e/harness/ritmo-lotes.html";
const SHOTS = process.env.HARNESS_SHOTS_DIR || "test-results/harness";

for (const [nome, viewport] of [
  ["computador", { width: 1366, height: 768 }],
  ["celular", { width: 375, height: 740 }],
] as const) {
  test(`máximo por dia e resumo dos lotes visíveis no ${nome}`, async ({ page }) => {
    await page.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await page.setViewportSize(viewport);
    await page.goto(PAGE_URL);
    const campo = page.getByTestId("batch-max-per-day");
    const resumo = page.getByTestId("batch-plan-summary");
    await campo.scrollIntoViewIfNeeded();
    await expect(campo).toBeVisible();
    await expect(campo).toHaveValue("50");
    await expect(resumo).toContainText("20 lote(s)");
    await expect(resumo).toContainText("em 2 dia(s)");
    await resumo.scrollIntoViewIfNeeded();
    for (const el of [campo, resumo]) {
      await el.scrollIntoViewIfNeeded();
      const box = await el.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 0.5);
    }
    const estouro = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(estouro).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${SHOTS}/ritmo-lotes-${nome}.png` });

    // 25 por dia = 5 lotes de 5 por dia: os mesmos 20 lotes ocupam 4 dias úteis.
    await campo.fill("25");
    await expect(resumo).toContainText("em 4 dia(s)");
  });
}
