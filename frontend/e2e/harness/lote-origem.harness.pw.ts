// "De onde tirar o lote" em Chromium de verdade (24/11/2026). Caso do Conrado: dos 685 clientes da tag da Tinge,
// separar 100 para uma campanha sem exportar para o Excel. O que este arquivo prova, em 1366 e em 375 px:
//   - escolher "Uma tag" e a tag pede a prévia SÓ daquele grupo e mostra "Leads no grupo";
//   - separar manda a origem junto com tamanho e quantidade;
//   - aberto pelo botão "Separar lote deste filtro", a janela já vem com o filtro da tela como origem;
//   - a lista de tags (nome comprido) e a janela cabem na tela do celular.
//
// Uso: npx playwright test --config playwright.harness.config.ts lote-origem
import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.HARNESS_SHOTS_DIR || "test-results/harness";
const TAG = 'LEADS - "clientes" - TINGE BRASIL';
const EMPRESA = { total: 2284, celular: 2230, fixo: 35, invalido: 19, whatsapp_confirmado: 900, sem_whatsapp: 5, nao_conferido: 1300, opt_out: 0, ja_recebeu: 120, ja_separado: 250, disponivel_confirmado: 600, disponivel_sem_conferir: 1800 };
const GRUPO = { ...EMPRESA, total: 685, whatsapp_confirmado: 400, nao_conferido: 280, ja_recebeu: 2, ja_separado: 0, disponivel_confirmado: 380, disponivel_sem_conferir: 660 };

async function abrir(page: Page, url = "/e2e/harness/lote-origem.html") {
  const previas: (Record<string, unknown> | null)[] = [];
  const separacoes: Record<string, unknown>[] = [];
  await page.route("**/api/leads/lotes/previa**", (route) => {
    const raw = new URL(route.request().url()).searchParams.get("origem");
    const origem = raw ? JSON.parse(raw) : null;
    previas.push(origem);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ previa: origem ? GRUPO : EMPRESA, conferencia: { rodando: false } }),
    });
  });
  await page.route("**/api/leads/lotes", (route) => {
    separacoes.push(route.request().postDataJSON());
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ planilhas: [{ id: "p9", nome: "Clientes · Lote 05 · 100 leads", numero: 5, leads: 100 }], separados: 100, disponiveisRestantes: 280 }),
    });
  });
  await page.route("**/api/leads/mass-delete/preview", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, preview: { willDelete: 0, kept: 0 } }) })
  );
  await page.goto(url);
  await expect(page.getByRole("dialog")).toBeVisible();
  return { previas, separacoes };
}

async function semEstouro(page: Page, width: number) {
  const janela = page.getByRole("dialog");
  const box = await janela.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
  expect(await janela.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 375, height: 740 }]) {
  test(`${viewport.width}px: lote só da tag de clientes, com a origem indo ao servidor`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { previas, separacoes } = await abrir(page);
    await expect(page.getByTestId("previa-total")).toContainText("2.284");
    expect(previas[0]).toBeNull();

    await page.getByTestId("lote-origem-tipo").click();
    await page.getByRole("option", { name: "Uma tag" }).click();
    await page.getByTestId("lote-origem-tag").click();
    const opcao = page.getByRole("option", { name: /clientes.*685/ });
    await expect(opcao).toBeVisible();
    const lista = await page.getByRole("listbox").boundingBox();
    expect(lista!.x + lista!.width).toBeLessThanOrEqual(viewport.width + 0.5);
    await opcao.click();

    await expect(page.getByTestId("previa-total")).toContainText("Leads no grupo");
    await expect(page.getByTestId("previa-total")).toContainText("685");
    await expect(page.getByTestId("previa-disponivel")).toContainText("380");
    expect(previas.at(-1)).toEqual({ tipo: "tag", tag: TAG });
    await semEstouro(page, viewport.width);
    await page.screenshot({ path: `${SHOTS}/lote-origem-${viewport.width}-tag.png`, fullPage: true });

    await page.getByLabel("Leads por lote").fill("100");
    await page.getByTestId("btn-separar").click();
    await expect.poll(() => separacoes.length).toBe(1);
    expect(separacoes[0]).toMatchObject({ clientId: "tinge-brasil", tamanho: 100, quantidade: 1, origem: { tipo: "tag", tag: TAG } });
    // O nome do lote vem da tag quando ninguém escreveu outro.
    expect(String(separacoes[0].nomeBase)).toContain("clientes");
  });
}

test("aberto por 'Separar lote deste filtro', já vem com o filtro da tela como origem", async ({ page }) => {
  const { previas } = await abrir(page, "/e2e/harness/lote-origem.html?modo=filtro");
  await expect(page.getByTestId("lote-origem-tipo")).toContainText("filtro da tela");
  await expect(page.getByTestId("previa-total")).toContainText("Leads no grupo");
  await expect.poll(() => previas.some((o) => (o as { tipo?: string } | null)?.tipo === "filtro")).toBe(true);
  const ultima = previas.filter(Boolean).at(-1) as { filtro: Record<string, unknown> };
  expect(ultima.filtro).toMatchObject({ tag: TAG, search: "Cliente" });
});
