// Cálculo velho no cache, em Chromium de verdade, na página REAL do Dashboard. O que este arquivo prova, e que jsdom
// não prova:
//   - a página abre com o número velho e o cabeçalho diz "Atualizando..." (visível, dentro da janela);
//   - sem recarregar, a tela pergunta de novo e troca pelo número novo, e o carimbo passa a ser o de hoje;
//   - recálculo que falhou (lastError) não gera nova pergunta: a tela não insiste.
// Em 1440 e 375. Visto em produção em 15/11/2026: "Contado em 13/11" no dia 15, sem aviso.
//
// Uso: npx playwright test --config playwright.harness.config.ts dashboard-cache
import { expect, test, type Page } from "@playwright/test";
import { dashboardPayload } from "./dashboard-payload";

const PAGE_URL = "/e2e/harness/dashboard.html";
const SHOTS = process.env.HARNESS_SHOTS_DIR || "test-results/harness";
const OLD = "2026-11-13T03:27:00.000Z";

async function serve(page: Page, answers: Array<Record<string, unknown>>) {
  const calls: number[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/dashboard") {
      calls.push(Date.now());
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dashboardPayload(answer)) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "NOT_FOUND" }) });
  });
  return calls;
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`${viewport.width}px: número velho mostra "Atualizando..." e troca sozinho pelo novo`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const fresh = new Date().toISOString();
    const calls = await serve(page, [
      { cacheStatus: "stale", lastUpdatedAt: OLD },
      {
        cacheStatus: "fresh",
        lastUpdatedAt: fresh,
        overview: { ...dashboardPayload().overview, waiting: { status: "ready", waiting: 12, waitingOverThreshold: 3, thresholdHours: 3 } },
      },
    ]);
    await page.goto(PAGE_URL);

    // Abre com o número velho, e o cabeçalho diz que está atualizando.
    const waiting = page.getByTestId("card-waiting");
    await expect(waiting).toContainText("36");
    await expect(page.getByText("Contado em 13/11", { exact: false })).toBeVisible();
    const updating = page.getByRole("button", { name: "Atualizando..." });
    await expect(updating).toBeVisible();
    const box = (await updating.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `${SHOTS}/dashboard-cache-velho-${viewport.width}.png` });

    // Sem recarregar: troca pelo número novo e o carimbo passa a ser o de hoje.
    await expect(waiting).toContainText("12", { timeout: 15_000 });
    await expect(page.getByText("Contado em 13/11", { exact: false })).toHaveCount(0);
    await expect(page.getByText(/Contado às \d{2}:\d{2}\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "Atualizar agora" })).toBeVisible();
    expect(calls).toHaveLength(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `${SHOTS}/dashboard-cache-novo-${viewport.width}.png` });

    // Número novo: para de perguntar.
    await page.waitForTimeout(11_000);
    expect(calls).toHaveLength(2);
  });
}

test("recálculo que falhou: mostra o velho e não pergunta de novo", async ({ page }) => {
  const calls = await serve(page, [{ cacheStatus: "stale", lastUpdatedAt: OLD, lastError: "timeout" }]);
  await page.goto(PAGE_URL);
  await expect(page.getByTestId("card-waiting")).toContainText("36");
  await expect(page.getByText("Contado em 13/11", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Atualizar agora" })).toBeVisible();
  await page.waitForTimeout(12_000);
  expect(calls).toHaveLength(1);
  await page.screenshot({ path: `${SHOTS}/dashboard-cache-falhou-1440.png` });
});
