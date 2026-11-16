// Formulário do site em Chromium de verdade: a origem do anúncio sai da URL de chegada
// e vai no corpo do POST /api/public/leads/capture.
//
// O que este arquivo prova, e que jsdom não prova:
//   - chegada com parâmetros de anúncio: o POST leva utm, ids e fbclid, e o caminho da página;
//   - a URL perde os parâmetros antes do envio: a origem guardada na sessão ainda vai;
//   - chegada sem parâmetro nenhum: attribution vai null (nada inventado);
//   - o formulário inteiro cabe na janela, no computador e em 375 px.
//
// Uso: npx playwright test --config playwright.harness.config.ts formulario-origem
import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.HARNESS_SHOTS_DIR || "test-results/harness";
const URL_BASE = "/e2e/harness/formulario-origem.html";
const AD_QUERY =
  "?utm_source=fb&utm_medium=paid_social&utm_campaign=Diagnostico%20Novembro" +
  "&campaign_id=120210000000000001&adset_id=120210000000000002&ad_id=120210000000000003&fbclid=IwAR0abc";

type Captured = { body: Record<string, unknown> | null };

async function serve(page: Page): Promise<Captured> {
  const captured: Captured = { body: null };
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    if (req.method() === "POST" && req.url().includes("/api/public/leads/capture")) {
      captured.body = req.postDataJSON();
      return route.fulfill({ status: 200, json: { success: true, phoneMasked: "(34) *****-2222" } });
    }
    return route.fulfill({ status: 200, json: {} });
  });
  return captured;
}

async function preencherEEnviar(page: Page, shot?: string) {
  await page.getByRole("button", { name: /Conhecer Vexo OS/ }).first().click();
  await page.getByPlaceholder("Como podemos te chamar?").fill("Joao Teste");
  await page.getByPlaceholder("(00) 00000-0000").fill("34991112222");
  await page.getByPlaceholder("seu@empresa.com").fill("joao@teste.com");
  const proximo = page.getByRole("button", { name: /Próximo Passo/ });
  await proximo.click();
  await page.getByPlaceholder("Ex: Minha Empresa").fill("Empresa Teste");
  await proximo.click();
  await proximo.click();
  await expectFormInsideWindow(page);
  const enviar = page.getByRole("button", { name: /Receber Diagnóstico no WhatsApp/ });
  await expect(enviar).toBeInViewport();
  if (shot) {
    await page.waitForTimeout(800); // animação de entrada do passo
    await page.screenshot({ path: shot });
  }
  await enviar.click();
}

async function expectFormInsideWindow(page: Page) {
  const offenders = await page.evaluate(() => {
    const vw = window.innerWidth;
    // O formulário do MODAL (tem o campo isca website_url). A landing tem outro <form>,
    // o do simulador de chat, que entra deslizando de fora da tela de propósito.
    const form = document.querySelector('input[name="website_url"]')?.closest("form");
    if (!form) return ["formulário do modal não encontrado"];
    return [form, ...Array.from(form.querySelectorAll("*"))]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return style.display !== "none" && box.width > 0 && box.height > 0 && box.right > vw + 0.5;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()} termina em ${Math.round(el.getBoundingClientRect().right)} px`);
  });
  expect(offenders, "há elemento do formulário passando da borda direita").toEqual([]);
}

for (const viewport of [
  { nome: "computador", width: 1366, height: 768 },
  { nome: "375", width: 375, height: 812 },
]) {
  test.describe(`Formulário do site — ${viewport.nome}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("chegada por anúncio: o POST leva a origem lida da URL", async ({ page }) => {
      const captured = await serve(page);
      await page.goto(URL_BASE + AD_QUERY);
      await preencherEEnviar(page, `${SHOTS}/formulario-origem-${viewport.nome}-passo4.png`);
      await expect.poll(() => captured.body).not.toBeNull();
      expect(captured.body?.attribution).toEqual({
        utm_source: "fb",
        utm_medium: "paid_social",
        utm_campaign: "Diagnostico Novembro",
        campaign_id: "120210000000000001",
        adset_id: "120210000000000002",
        ad_id: "120210000000000003",
        fbclid: "IwAR0abc",
        landing_path: URL_BASE,
      });
      await expect(page.getByText(/34\) \*\*\*\*\*-2222/).first()).toBeVisible();
      await page.waitForTimeout(800); // animação de entrada da confirmação
      await page.screenshot({ path: `${SHOTS}/formulario-origem-${viewport.nome}-enviado.png` });
    });

    test("URL perde os parâmetros antes do envio: a origem guardada na sessão ainda vai", async ({ page }) => {
      const captured = await serve(page);
      await page.goto(URL_BASE + AD_QUERY);
      await page.evaluate((path) => window.history.replaceState(null, "", path), URL_BASE);
      expect(new URL(page.url()).search).toBe("");
      await preencherEEnviar(page);
      await expect.poll(() => captured.body).not.toBeNull();
      expect(captured.body?.attribution).toMatchObject({ ad_id: "120210000000000003", utm_source: "fb" });
    });

    test("chegada sem parâmetro: attribution vai null, nada inventado", async ({ page }) => {
      const captured = await serve(page);
      await page.goto(URL_BASE);
      await preencherEEnviar(page);
      await expect.poll(() => captured.body).not.toBeNull();
      expect(captured.body?.attribution).toBeNull();
    });
  });
}
