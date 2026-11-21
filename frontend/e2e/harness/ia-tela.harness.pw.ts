// Tela de IA (PR #179 trazido para o main, 21/11/2026) em Chromium de verdade, contra o servidor de mentira.
//
// O que este arquivo prova, e que jsdom não prova: na lista de motores aberta na janela (1440 e 375) só
// aparecem os provedores que a rota devolveu (a rota só devolve provedor com chave); e o simulador mostra,
// na janela, qual provedor está com a chave quebrada: quando a escada inteira falha e quando a resposta
// veio de outro provedor.
//
// Uso: npx playwright test --config playwright.harness.config.ts e2e/harness/ia-tela.harness.pw.ts
import { expect, test, type Page, type Route } from "@playwright/test";

const SHOTS = process.env.HARNESS_SHOTS_DIR || "test-results/harness";
const URL_GERAL = "/e2e/harness/ia-tela.html?view=geral";
const URL_TESTE = "/e2e/harness/ia-tela.html?view=teste";

// O que a rota real devolve com GEMINI_API_KEY e GROQ_API_KEY no servidor e sem as chaves da OpenAI e da Anthropic.
const MODELOS = {
  models: [
    { id: "gemini-flash-latest", name: "Gemini Flash", provider: "gemini", providerName: "Gemini / Google" },
    { id: "gemini-flash-lite-latest", name: "Gemini Flash Lite", provider: "gemini", providerName: "Gemini / Google" },
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B (Groq)", provider: "groq", providerName: "Groq" },
  ],
  defaultModel: "gemini-flash-latest",
  providerStatus: { gemini: true, groq: true, openai: false, anthropic: false },
};

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function servidor(page: Page, simulador: () => { status: number; body: unknown }) {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/chatbot-llm-models") return json(route, 200, MODELOS);
    if (path.startsWith("/api/chatbot-templates")) return json(route, 200, { templates: [] });
    if (path === "/api/chatbot-test") {
      const r = simulador();
      return json(route, r.status, r.body);
    }
    if (path.startsWith("/api/followup/companies")) return json(route, 200, { companies: [] });
    return json(route, 200, {});
  });
}

async function listaDeMotores(page: Page) {
  await page.goto(URL_GERAL);
  const gatilho = page.getByRole("combobox").filter({ hasText: /Gemini Flash/ });
  await expect(gatilho).toBeVisible();
  await gatilho.click();
  const lista = page.getByRole("listbox");
  await expect(lista).toBeVisible();
  await expect(lista.getByText(/Gemini \(Google\)/)).toBeVisible();
  await expect(lista.getByText(/Groq \(Ultra-rápido\)/)).toBeVisible();
  await expect(lista.getByText(/ChatGPT \(OpenAI\)/)).toHaveCount(0);
  await expect(lista.getByText(/Claude \(Anthropic\)/)).toHaveCount(0);
  await expect(lista.getByRole("option")).toHaveCount(3);
  const caixa = await lista.boundingBox();
  const janela = page.viewportSize()!;
  expect(caixa && caixa.x >= 0 && caixa.x + caixa.width <= janela.width).toBe(true);
}

async function simuladorComChaveQuebrada(page: Page) {
  let turno = 0;
  await servidor(page, () => {
    turno += 1;
    return turno === 1
      ? {
          status: 422,
          body: {
            success: false,
            error: "Não foi possível gerar a resposta.",
            reason: "Credencial inválida ou ausente no(s) provedor(es): gemini. Verifique as chaves no EasyPanel.",
            code: "LLM_CREDENTIAL_INVALID",
            provedores: ["gemini"],
          },
        }
      : {
          status: 200,
          body: {
            success: true,
            response: "Oi! Como posso ajudar?",
            avisos: ["Credencial inválida no provedor gemini: esta resposta veio de outro provedor da escada. Troque a chave no EasyPanel."],
          },
        };
  });
  await page.goto(URL_TESTE);
  const caixa = page.getByPlaceholder("Digite uma mensagem...");
  await caixa.fill("oi");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText(/^🔑 Credencial de IA inválida/)).toBeInViewport();
  await expect(page.getByText(/provedor\(es\): gemini/)).toBeVisible();
  await expect(page.getByText(/Prompt não configurado/i)).toHaveCount(0);

  await caixa.fill("tudo bem?");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText("Oi! Como posso ajudar?")).toBeVisible();
  await expect(page.getByText(/Credencial inválida no provedor gemini: esta resposta veio de outro provedor/)).toBeInViewport();
}

for (const [nome, viewport] of [
  ["computador", { width: 1440, height: 900 }],
  ["celular", { width: 375, height: 812 }],
] as const) {
  test.describe(`tela de IA — ${nome} (${viewport.width})`, () => {
    test.use({ viewport });

    test("lista de motores só mostra provedor com chave", async ({ page }) => {
      await servidor(page, () => ({ status: 200, body: {} }));
      await listaDeMotores(page);
      await page.screenshot({ path: `${SHOTS}/ia-motores-${nome}.png` });
    });

    test("simulador mostra qual provedor está com a chave quebrada", async ({ page }) => {
      await simuladorComChaveQuebrada(page);
      await page.screenshot({ path: `${SHOTS}/ia-simulador-${nome}.png` });
    });
  });
}
