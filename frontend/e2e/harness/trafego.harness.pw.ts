// Gestor de Tráfego em Chromium de verdade: a PÁGINA real (src/pages/Trafego.tsx), com os hooks
// reais, contra um servidor de mentira que guarda estado (conta cadastrada aparece na lista,
// perfil salvo volta na releitura).
//
// O que este arquivo prova, e que jsdom não prova:
//   - as três abas cabem na janela, no computador e em 375 px, sem rolagem lateral;
//   - no Desempenho, a decisão e o motivo de cada anúncio estão NA TELA, dentro da janela;
//   - conta com erro de coleta mostra "sem atualização desde ..." visível, não zero;
//   - Meta sem token aparece como "Não conectada" e a conta não mostra número;
//   - cadastrar conta manda o POST e a linha aparece; pausar manda o PATCH;
//   - em Metas, só "Relatório" está habilitado; salvar manda autonomyLevel "relatorio";
//   - empresa fora do piloto vê o motivo e nenhuma aba.
//
// Uso: npx playwright test --config playwright.harness.config.ts trafego
import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.HARNESS_SHOTS_DIR || "test-results/harness";
const URL_BASE = "/e2e/harness/trafego.html";

const CATALOG = [
  { key: "cpl", label: "Custo por lead", better: "lower", unit: "currency" },
  { key: "custo_por_conversa", label: "Custo por conversa iniciada", better: "lower", unit: "currency" },
  { key: "cpc", label: "Custo por clique", better: "lower", unit: "currency" },
  { key: "custo_por_compra", label: "Custo por compra", better: "lower", unit: "currency" },
  { key: "ctr", label: "Taxa de cliques", better: "higher", unit: "percent" },
  { key: "roas", label: "Retorno sobre o gasto", better: "higher", unit: "ratio" },
];

const M = (spend: number, leads: number, messages = 0) => ({
  spend,
  impressions: Math.round(spend * 120),
  clicks: Math.round(spend * 1.4),
  leads,
  messages_started: messages,
  purchases: 0,
  purchase_value: 0,
});
const K = (spend: number, leads: number) => ({
  cpl: leads > 0 ? Math.round((spend / leads) * 10000) / 10000 : null,
  custo_por_conversa: null,
  cpc: 0.71,
  custo_por_compra: null,
  ctr: 1.17,
  roas: 0,
});
const ad = (id: string, name: string, spend: number, leads: number, decisao: string, motivo: string, status = "ACTIVE") => ({
  id,
  name,
  effectiveStatus: status,
  metrics: M(spend, leads),
  kpis: K(spend, leads),
  decision: { decisao, motivo, numeros: {} },
});

function performance(days: number, accounts: unknown[]) {
  return {
    success: true,
    window: { days, since: days === 30 ? "2026-10-17" : "2026-11-09", until: "2026-11-15", timezone: "America/Sao_Paulo" },
    windows: [4, 7, 14, 30],
    hasProfile: true,
    primaryKpi: "cpl",
    totals: { metrics: M(920, 19, 31), kpis: K(920, 19) },
    targets: [{ key: "cpl", label: "Custo por lead", unit: "currency", better: "lower", target: 50, value: 48.4211, variacao: 0.0316 }],
    accounts: [
      {
        platform: "meta",
        id: "1234567890",
        name: "Geração Digital · Conta principal de anúncios",
        currency: "BRL",
        metrics: M(920, 19, 31),
        kpis: K(920, 19),
        campaigns: [
          {
            id: "c1",
            name: "[LEADS] Diagnóstico comercial gratuito · Uberlândia e região · novembro",
            objective: "OUTCOME_LEADS",
            metrics: M(620, 13),
            kpis: K(620, 13),
            decision: "MATAR",
            adsets: [
              {
                id: "s1",
                name: "Donos de empresa 30 a 55 · interesse em vendas e gestão comercial",
                metrics: M(620, 13),
                kpis: K(620, 13),
                decision: "MATAR",
                ads: [
                  ad("a1", "Vídeo depoimento cliente Container Led (30s)", 300, 10, "ESCALAR", "cpl em 30, 40% melhor que a meta de 50 (escala a partir de 20%)."),
                  ad("a2", "Carrossel 5 erros no WhatsApp comercial que fazem sua empresa perder venda todo dia", 300, 3, "MATAR", "cpl em 100, 100% pior que a meta de 50 (corta a partir de 50%)."),
                  ad("a3", "Imagem estática oferta diagnóstico", 20, 0, "AMOSTRA_INSUFICIENTE", "Gasto de 20 ainda abaixo do mínimo de 60 para decidir.", "PAUSED"),
                ],
              },
            ],
          },
          {
            id: "c2",
            name: "[WHATSAPP] Remarketing visitantes do site",
            objective: "OUTCOME_ENGAGEMENT",
            metrics: M(300, 6, 31),
            kpis: K(300, 6),
            decision: "MANTER",
            adsets: [
              {
                id: "s2",
                name: "Visitantes 30 dias",
                metrics: M(300, 6, 31),
                kpis: K(300, 6),
                decision: "MANTER",
                ads: [ad("a4", "Vídeo curto chamada para o WhatsApp", 300, 6, "MANTER", "cpl em 50, 0% melhor que a meta de 50. Dentro da faixa.")],
              },
            ],
          },
        ],
      },
    ],
    adsCount: 4,
    vexo: { available: false, reason: "SEM_ORIGEM_DO_ANUNCIO" },
    catalog: CATALOG,
    accountsStatus: accounts,
  };
}

interface Options {
  allowed?: boolean;
  metaConnected?: boolean;
  googleConnected?: boolean;
  collectorEnabled?: boolean;
  syncError?: boolean;
  empty?: boolean;
}

async function serve(page: Page, options: Options = {}) {
  const { allowed = true, metaConnected = true, googleConnected = false, collectorEnabled = true, syncError = false, empty = false } = options;
  const state = {
    accounts: empty
      ? []
      : [
          {
            id: "11111111-1111-4111-8111-111111111111",
            platform: "meta",
            externalAccountId: "1234567890",
            displayName: "Geração Digital · Conta principal de anúncios",
            currency: "BRL",
            timezone: "America/Sao_Paulo",
            status: "active",
            lastSyncAt: metaConnected ? "2026-11-15T10:00:21.000Z" : null,
            lastSyncAttemptAt: metaConnected ? (syncError ? "2026-11-15T16:00:09.000Z" : "2026-11-15T10:00:21.000Z") : null,
            lastSyncError: syncError
              ? "Meta recusou a leitura: Error validating access token: Session has expired on Saturday, 14-Nov-26 (código 190)"
              : null,
          },
        ],
    profile: {
      exists: false,
      objectives: [] as string[],
      kpis: [] as Record<string, unknown>[],
      primaryKpi: null as string | null,
      windows: [4, 7, 14, 30],
      minSpendFactor: 1.2,
      dailyBudgetCap: null as number | null,
      monthlyBudgetCap: null as number | null,
      maxIncreasePct: 50,
      autonomyLevel: "relatorio",
      approvers: [] as Record<string, unknown>[],
      updatedAt: null as string | null,
    },
    posts: [] as Record<string, unknown>[],
    patches: [] as { id: string; body: Record<string, unknown> }[],
    puts: [] as Record<string, unknown>[],
    performanceWindows: [] as string[],
  };

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname === "/api/traffic/access") {
      return json(200, allowed
        ? { success: true, allowed: true, reason: null, message: null }
        : { success: true, allowed: false, reason: "TRAFFIC_TENANT_NOT_IN_PILOT", message: "O Gestor de Tráfego ainda não está disponível para esta empresa." });
    }
    if (url.pathname === "/api/traffic/accounts" && method === "GET") {
      return json(200, {
        success: true,
        platforms: { meta: { available: true, connected: metaConnected }, google: { available: true, connected: googleConnected } },
        collector: { enabled: collectorEnabled, hours: ["07:00", "13:00", "19:00"] },
        accounts: state.accounts,
      });
    }
    if (url.pathname === "/api/traffic/accounts" && method === "POST") {
      const body = req.postDataJSON();
      state.posts.push(body);
      const account = {
        id: "22222222-2222-4222-8222-222222222222",
        platform: body.platform,
        externalAccountId: String(body.externalAccountId).replace(/^act_/, "").replace(/-/g, ""),
        displayName: body.displayName || null,
        currency: null,
        timezone: null,
        status: "active",
        lastSyncAt: null,
        lastSyncAttemptAt: null,
        lastSyncError: null,
      };
      state.accounts = [...state.accounts, account];
      return json(201, { success: true, account });
    }
    const byId = url.pathname.match(/^\/api\/traffic\/accounts\/([^/]+)$/);
    if (byId && method === "PATCH") {
      const body = req.postDataJSON();
      state.patches.push({ id: byId[1], body });
      const account = state.accounts.find((item) => item.id === byId[1]);
      if (account) account.status = body.status;
      return json(200, { success: true, account });
    }
    if (url.pathname === "/api/traffic/profile" && method === "GET") {
      return json(200, {
        success: true,
        profile: state.profile,
        catalog: CATALOG,
        allowedWindows: [4, 7, 14, 30],
        autonomy: { levels: ["relatorio", "sugere", "aplica_com_limites"], available: ["relatorio"] },
      });
    }
    if (url.pathname === "/api/traffic/profile" && method === "PUT") {
      const body = req.postDataJSON();
      state.puts.push(body);
      state.profile = {
        ...state.profile,
        ...body,
        exists: true,
        kpis: body.kpis.map((kpi: Record<string, unknown>) => ({ ...kpi, better: CATALOG.find((c) => c.key === kpi.key)?.better })),
        updatedAt: "2026-11-15T15:00:00.000Z",
      };
      return json(200, { success: true, profile: state.profile });
    }
    if (url.pathname === "/api/traffic/performance") {
      const days = Number(url.searchParams.get("window") || 7);
      state.performanceWindows.push(String(days));
      if (empty || !metaConnected) {
        return json(200, { ...performance(days, state.accounts), accounts: [], adsCount: 0, targets: [], hasProfile: false, primaryKpi: null });
      }
      return json(200, performance(days, state.accounts));
    }
    return json(200, {});
  });
  return state;
}

/** A caixa do elemento está inteira dentro da janela (na horizontal), e tem tamanho. */
async function expectInsideViewport(page: Page, locator: ReturnType<Page["locator"]>) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box, "elemento sem caixa (não está na tela)").not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 0.5);
}

// Só medir document.scrollWidth não basta: o PageShell tem área de rolagem própria, então
// conteúdo largo demais não alarga o documento, ele é cortado ou rola dentro da casca.
// (Medido: uma grade com largura mínima de 900 px em janela de 375 passava no teste antigo.)
// Por isso a prova é elemento a elemento: nada visível pode passar da borda direita.
async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "a página tem rolagem lateral").toBeLessThanOrEqual(0);

  const offenders = await page.evaluate(() => {
    const vw = window.innerWidth;
    return Array.from(document.querySelectorAll("#root *"))
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.right > vw + 0.5;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || "").trim().slice(0, 40)}" termina em ${Math.round(el.getBoundingClientRect().right)} px`);
  });
  expect(offenders, "há elemento passando da borda direita da janela").toEqual([]);
}

for (const viewport of [
  { nome: "computador", width: 1366, height: 768 },
  { nome: "375", width: 375, height: 812 },
]) {
  test.describe(`Tráfego — ${viewport.nome}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("Desempenho: metas, campanhas e a decisão com motivo de cada anúncio estão na tela", async ({ page }) => {
      const state = await serve(page);
      await page.goto(URL_BASE);

      await expect(page.getByRole("tab", { name: "Desempenho" })).toHaveAttribute("data-state", "active");
      await expect(page.getByTestId("periodo")).toHaveText(/09\/11\/2026 a 15\/11\/2026/);

      const meta = page.getByTestId("meta-cpl");
      await expect(meta).toContainText("R$ 48,42");
      await expect(meta).toContainText("Meta: R$ 50,00");
      await expect(meta).toContainText("3,2% melhor");
      await expectInsideViewport(page, meta);

      // Primeira campanha abre sozinha; a segunda abre no clique.
      const campanhas = page.getByTestId("campanha");
      await expect(campanhas).toHaveCount(2);
      await expect(campanhas.nth(0).getByText("Cortar", { exact: true }).first()).toBeVisible();

      const anuncios = campanhas.nth(0).getByTestId("anuncio");
      await expect(anuncios).toHaveCount(3);
      const ruim = anuncios.nth(1);
      await expect(ruim.getByText("Cortar", { exact: true })).toBeVisible();
      await expectInsideViewport(page, ruim.getByText("Cortar", { exact: true }));
      const motivo = ruim.getByText("cpl em 100, 100% pior que a meta de 50 (corta a partir de 50%).");
      await expect(motivo).toBeVisible();
      await expectInsideViewport(page, motivo);
      await expect(anuncios.nth(0).getByText("Escalar", { exact: true })).toBeVisible();
      await expect(anuncios.nth(2).getByText("Amostra insuficiente", { exact: true })).toBeVisible();
      await expect(anuncios.nth(2)).toContainText("Pausado");
      // Colunas do Vexo sem origem: "sem registro", nunca zero.
      await expect(ruim).toContainText("sem registro");

      await expectNoSideScroll(page);
      await page.screenshot({ path: `${SHOTS}/trafego-${viewport.nome}-desempenho.png`, fullPage: true });

      await campanhas.nth(1).getByRole("button").click();
      await expect(campanhas.nth(1).getByTestId("anuncio")).toHaveCount(1);
      await expectNoSideScroll(page);

      // Trocar a janela pede a janela nova ao servidor.
      await page.getByRole("button", { name: "30 dias" }).click();
      await expect(page.getByTestId("periodo")).toHaveText(/17\/10\/2026 a 15\/11\/2026/);
      expect(state.performanceWindows).toContain("30");
    });

    test("Desempenho: conta com erro de coleta avisa 'sem atualização desde', visível", async ({ page }) => {
      await serve(page, { syncError: true });
      await page.goto(URL_BASE);

      const aviso = page.getByRole("alert").filter({ hasText: "sem atualização desde" });
      await expect(aviso).toBeVisible();
      await expect(aviso).toContainText("Session has expired");
      await expectInsideViewport(page, aviso);
      await expectNoSideScroll(page);
      await page.screenshot({ path: `${SHOTS}/trafego-${viewport.nome}-desempenho-erro-coleta.png` });
    });

    test("Conexão: Meta sem acesso aparece como não conectada e a conta não mostra número", async ({ page }) => {
      await serve(page, { metaConnected: false, collectorEnabled: false });
      await page.goto(`${URL_BASE}?tab=conexao`);

      await expect(page.getByTestId("plataforma-meta")).toContainText("Não conectada");
      await expect(page.getByTestId("plataforma-google")).toContainText("Não conectada");
      await expect(page.getByTestId("estado-coleta")).toContainText("Coleta automática desligada");

      const conta = page.getByTestId("conta");
      await expect(conta).toHaveCount(1);
      await expect(conta).toContainText("Não conectada. Sem coleta e sem número");
      await expect(conta).not.toContainText("R$");
      await expect(conta).not.toContainText("Última coleta");
      await expectInsideViewport(page, conta.getByRole("button", { name: "Pausar coleta" }));
      await expectNoSideScroll(page);
      await page.screenshot({ path: `${SHOTS}/trafego-${viewport.nome}-conexao-nao-conectada.png`, fullPage: true });

      // No Desempenho, sem dado: estado vazio, não zeros.
      await page.getByRole("tab", { name: "Desempenho" }).click();
      await expect(page.getByTestId("sem-dados")).toBeVisible();
      await expect(page.getByText("R$ 0,00")).toHaveCount(0);
    });

    test("Conexão: erro visível, cadastrar conta e pausar coleta", async ({ page }) => {
      const state = await serve(page, { syncError: true });
      await page.goto(`${URL_BASE}?tab=conexao`);

      await expect(page.getByTestId("plataforma-meta")).toContainText("Conectada");
      await expect(page.getByTestId("estado-coleta")).toContainText("07:00, 13:00, 19:00");

      const conta = page.getByTestId("conta").first();
      await expect(conta.getByRole("alert")).toContainText("Sem atualização desde");
      await expect(conta.getByRole("alert")).toContainText("Session has expired");
      await expectInsideViewport(page, conta.getByRole("alert"));

      await page.getByLabel("Número da conta").fill("act_9988776655");
      await page.getByLabel("Nome para identificar (opcional)").fill("Conta de teste");
      const cadastrar = page.getByRole("button", { name: "Cadastrar" });
      await expectInsideViewport(page, cadastrar);
      await cadastrar.click();

      await expect(page.getByTestId("conta")).toHaveCount(2);
      await expect(page.getByTestId("conta").nth(1)).toContainText("Conta de teste");
      await expect(page.getByTestId("conta").nth(1)).toContainText("Aguardando a primeira coleta");
      expect(state.posts).toEqual([
        { clientId: "geracao-digital", platform: "meta", externalAccountId: "act_9988776655", displayName: "Conta de teste" },
      ]);

      await conta.getByRole("button", { name: "Pausar coleta" }).click();
      await expect(conta.getByRole("button", { name: "Retomar coleta" })).toBeVisible();
      expect(state.patches).toEqual([{ id: "11111111-1111-4111-8111-111111111111", body: { status: "paused" } }]);

      await expectNoSideScroll(page);
      await page.screenshot({ path: `${SHOTS}/trafego-${viewport.nome}-conexao.png`, fullPage: true });
    });

    test("Metas e regras: só Relatório habilitado; salvar manda as metas e o nível relatório", async ({ page }) => {
      const state = await serve(page);
      await page.goto(`${URL_BASE}?tab=metas`);

      await expect(page.getByText("Esta empresa ainda não tem metas.")).toBeVisible();

      const relatorio = page.getByRole("radio", { name: /^Relatório/ });
      await expect(relatorio).toBeChecked();
      await expect(relatorio).toBeEnabled();
      await expect(page.getByRole("radio", { name: /Sugere e pede aprovação/ })).toBeDisabled();
      await expect(page.getByRole("radio", { name: /Aplica dentro dos limites/ })).toBeDisabled();
      await expect(page.getByText("disponível na próxima fase")).toHaveCount(2);

      const cpl = page.getByTestId("kpi-cpl");
      await cpl.getByRole("checkbox").click();
      await cpl.getByLabel("Meta (R$)").fill("50");
      await cpl.getByLabel("KPI principal").check();
      await expectInsideViewport(page, cpl.getByLabel("Meta (R$)"));
      await expectInsideViewport(page, cpl.getByLabel("Corta quando pior que a meta em (%)"));

      await page.getByLabel("Objetivos").fill("Gerar conversas no WhatsApp");
      await page.getByRole("button", { name: "Adicionar aprovador" }).click();
      await page.getByLabel("Nome do aprovador 1").fill("Caio");
      await expectInsideViewport(page, page.getByLabel("Papel do aprovador 1"));

      await expectNoSideScroll(page);
      await page.screenshot({ path: `${SHOTS}/trafego-${viewport.nome}-metas.png`, fullPage: true });

      const salvar = page.getByRole("button", { name: "Salvar metas e regras" });
      await expectInsideViewport(page, salvar);
      await salvar.click();
      await expect(page.getByText("Metas e regras salvas.")).toBeVisible();

      expect(state.puts).toHaveLength(1);
      expect(state.puts[0]).toMatchObject({
        clientId: "geracao-digital",
        objectives: ["Gerar conversas no WhatsApp"],
        kpis: [{ key: "cpl", target: 50, scale_at: 0.2, kill_at: 0.5, min_spend: null }],
        primaryKpi: "cpl",
        windows: [4, 7, 14, 30],
        minSpendFactor: 1.2,
        maxIncreasePct: 50,
        autonomyLevel: "relatorio",
        approvers: [{ name: "Caio", role: "gestor_gd" }],
      });
      // Depois de salvar, o aviso de "sem metas" some (a tela releu o perfil).
      await expect(page.getByText("Esta empresa ainda não tem metas.")).toHaveCount(0);
    });

    test("Conexão: Google conectado, cadastrar conta do Google manda a plataforma certa e a linha aparece", async ({ page }) => {
      const state = await serve(page, { googleConnected: true });
      await page.goto(`${URL_BASE}?tab=conexao`);

      await expect(page.getByTestId("plataforma-google")).toContainText("Conectada");
      await expect(page.getByTestId("plataforma-google")).not.toContainText("Não conectada");
      await expect(page.getByTestId("ajuda-conta")).toContainText("compartilhada com a Geração Digital como parceira");

      const plataforma = page.getByLabel("Plataforma");
      await expectInsideViewport(page, plataforma);
      await plataforma.selectOption("google");
      await expect(page.getByTestId("ajuda-conta")).toContainText("conta gerenciadora da Geração Digital");
      await expect(page.getByLabel("Número da conta")).toHaveAttribute("placeholder", "Ex.: 123-456-7890");

      await page.getByLabel("Número da conta").fill("123-456-7890");
      const cadastrar = page.getByRole("button", { name: "Cadastrar" });
      await expectInsideViewport(page, cadastrar);
      await cadastrar.click();

      const nova = page.getByTestId("conta").nth(1);
      await expect(nova).toContainText("Google Ads · 1234567890");
      await expect(nova).toContainText("Aguardando a primeira coleta");
      expect(state.posts).toEqual([{ clientId: "geracao-digital", platform: "google", externalAccountId: "123-456-7890" }]);

      await expectNoSideScroll(page);
      await page.screenshot({ path: `${SHOTS}/trafego-${viewport.nome}-conexao-google.png`, fullPage: true });
    });

    test("empresa fora do piloto vê o motivo e nenhuma aba", async ({ page }) => {
      await serve(page, { allowed: false });
      await page.goto(URL_BASE);

      const aviso = page.getByRole("alert");
      await expect(aviso).toContainText("O Gestor de Tráfego ainda não está disponível para esta empresa.");
      await expectInsideViewport(page, aviso);
      await expect(page.getByRole("tab")).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/trafego-${viewport.nome}-sem-acesso.png` });
    });
  });
}
