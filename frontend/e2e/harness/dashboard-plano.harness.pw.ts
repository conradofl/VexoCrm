// Plano de ação gravado no servidor, em Chromium de verdade, na página REAL do Dashboard. O que este arquivo prova, e
// que jsdom não prova:
//   - a cobrança da semana anterior ("você combinou X; o número foi de A para B") aparece na tela, dentro da janela,
//     em 1440 e 375, sem rolagem lateral;
//   - quem é da equipe Vexo digita o dono e a tela grava UMA vez no servidor, na empresa certa, e diz "Salvo às";
//   - cliente vê o plano travado, com o motivo, e sem botão de planilha;
//   - quem acessa Conversas baixa a planilha de verdade (arquivo .csv com o nome que o servidor deu).
//
// Uso: npx playwright test --config playwright.harness.config.ts dashboard-plano
import { expect, test, type Page } from "@playwright/test";
import { dashboardPayload } from "./dashboard-payload";

const PAGE_URL = "/e2e/harness/dashboard.html";
const SHOTS = process.env.HARNESS_SHOTS_DIR || "test-results/harness";

const PREVIOUS = {
  weekStart: "2026-11-09",
  items: [
    {
      key: "waiting", subject: null, checked: true, owner: "Caio", due: "sexta", action: "Responder as 36 conversas que esperam e manter a fila zerada",
      why: "36 esperando.", metric: "pessoas esperando resposta = 0",
      baseline: { value: 36, unit: "pessoas esperando resposta" }, current: { value: 4, unit: "pessoas esperando resposta" },
    },
    {
      key: "neverApproached", subject: null, checked: true, owner: "", due: "", action: "Campanha de primeiro contato para quem nunca recebeu mensagem",
      why: "80.033 contatos.", metric: "nunca abordados abaixo de 80.033",
      baseline: { value: 80033, unit: "contatos nunca abordados" }, current: { value: 79512, unit: "contatos nunca abordados" },
    },
  ],
};

interface Scenario {
  canEdit: boolean;
  canExport: boolean;
}

async function serve(page: Page, scenario: Scenario) {
  const puts: Array<{ clientId: string; items: Array<{ key: string; owner: string }> }> = [];
  let current: unknown = null;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/dashboard" && method === "GET") return json(200, dashboardPayload());
    if (url.pathname === "/api/dashboard/plan" && method === "GET") {
      return json(200, { success: true, weekStart: "2026-11-16", canEdit: scenario.canEdit, canExport: scenario.canExport, current, previous: PREVIOUS });
    }
    if (url.pathname === "/api/dashboard/plan" && method === "PUT") {
      const body = JSON.parse(route.request().postData() || "{}");
      puts.push(body);
      current = { weekStart: "2026-11-16", items: body.items, updatedAt: new Date().toISOString() };
      return json(200, { success: true, plan: current });
    }
    if (url.pathname === "/api/dashboard/plan/export") {
      return route.fulfill({
        status: 200,
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="plano-nunca-abordados-2026-11-16.csv"' },
        body: "﻿Nome;Telefone\r\nAna;5534991110001\r\n",
      });
    }
    return json(404, { error: "NOT_FOUND" });
  });
  return { puts };
}

async function openPlan(page: Page) {
  await page.goto(PAGE_URL);
  await page.getByRole("button", { name: "Plano de ação" }).click();
  await expect(page.getByTestId("tab-plan")).toBeVisible();
}

async function noSideScroll(page: Page, width: number) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(width);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`equipe Vexo, ${viewport.width}px: cobrança na tela e o dono digitado é gravado uma vez no servidor`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { puts } = await serve(page, { canEdit: true, canExport: true });
    await openPlan(page);

    const followUp = page.getByTestId("plan-followup");
    await expect(followUp).toBeVisible();
    await expect(followUp).toContainText("Semana de 09/11: o que foi combinado");
    await expect(followUp).toContainText("O número foi de 36 pessoas esperando resposta para 4 pessoas esperando resposta.");
    await expect(followUp).toContainText("O número foi de 80.033 contatos nunca abordados para 79.512 contatos nunca abordados.");
    const box = (await followUp.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    await noSideScroll(page, viewport.width);
    await page.screenshot({ path: `${SHOTS}/dashboard-plano-cobranca-${viewport.width}.png`, fullPage: true });

    const owner = page.getByTestId("plan-actions").getByLabel("Dono").first();
    await owner.scrollIntoViewIfNeeded();
    await expect(owner).toBeEnabled();
    await owner.pressSequentially("Gabriel", { delay: 40 });
    await expect(page.getByTestId("plan-storage-note")).toContainText(/Salvo às \d{2}:\d{2}/);
    expect(puts).toHaveLength(1);
    expect(puts[0].clientId).toBe("geracao-digital");
    expect(puts[0].items.find((i) => i.key === "waiting")?.owner).toBe("Gabriel");
    expect((await owner.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await noSideScroll(page, viewport.width);
    await page.getByTestId("plan-storage-note").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/dashboard-plano-salvo-${viewport.width}.png` });
  });

  test(`cliente, ${viewport.width}px: vê o plano travado, com o motivo, e sem planilha`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { puts } = await serve(page, { canEdit: false, canExport: false });
    await openPlan(page);
    await expect(page.getByTestId("plan-followup")).toBeVisible();
    for (const box of await page.getByTestId("tab-plan").getByRole("checkbox").all()) await expect(box).toBeDisabled();
    for (const input of await page.getByTestId("tab-plan").getByRole("textbox").all()) await expect(input).toBeDisabled();
    await expect(page.getByText("Baixar planilha (nome e telefone)")).toHaveCount(0);
    const note = page.getByTestId("plan-storage-note");
    await note.scrollIntoViewIfNeeded();
    await expect(note).toBeVisible();
    await expect(note).toHaveText("Só a equipe Vexo edita este plano. Aqui você vê o que foi combinado.");
    expect(puts).toHaveLength(0);
    await noSideScroll(page, viewport.width);
    await page.screenshot({ path: `${SHOTS}/dashboard-plano-cliente-${viewport.width}.png`, fullPage: true });
  });
}

test("quem acessa Conversas baixa a planilha de verdade", async ({ page }) => {
  await serve(page, { canEdit: true, canExport: true });
  await openPlan(page);
  const button = page.getByTestId("plan-sheet-neverApproached");
  await expect(button).toBeVisible();
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toBe("plano-nunca-abordados-2026-11-16.csv");
});
