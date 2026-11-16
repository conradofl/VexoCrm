// Aba "Plano e aprovações" do Gestor de Tráfego (Fase 2) em Chromium de verdade: a PÁGINA real
// (src/pages/Trafego.tsx, ?tab=plano), com os hooks reais, contra um servidor de mentira que guarda
// estado e aplica as mesmas regras de papel do servidor (aprovar só pelo próprio lado).
//
// O que este arquivo prova, e que jsdom não prova:
//   - cada item do plano mostra ação, valores e motivo DENTRO da janela, no computador e em 375 px;
//   - quem é só GD vê "Aprovar como GD" e não vê "Aprovar como cliente";
//   - aprovar manda o POST com o papel e o estado na tela muda;
//   - recusar exige motivo (botão travado até 5 letras) e o motivo aparece no item;
//   - aprovado pelos dois aparece em "Aplicar à mão"; marcar feito manda o POST e mostra quem fez;
//   - perfil em Relatório: nenhum plano, aviso e atalho para Metas;
//   - gerar sem dado novo mostra o motivo do servidor;
//   - Metas: "Sugere" habilitado, salvar manda o nível e o email do aprovador.
//
// Uso: npx playwright test --config playwright.harness.config.ts trafego-plano
import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.HARNESS_SHOTS_DIR || "test-results/harness";
const URL_BASE = "/e2e/harness/trafego.html";

const CATALOG = [
  { key: "cpl", label: "Custo por lead", better: "lower", unit: "currency" },
  { key: "ctr", label: "Taxa de cliques", better: "higher", unit: "percent" },
];

type Role = "gestor_gd" | "cliente";

function item(id: string, patch: Record<string, unknown>) {
  return {
    id,
    planId: "plano-1",
    platform: "meta",
    accountId: "1234567890",
    level: "campaign",
    entityId: `c-${id}`,
    entityName: null,
    campaignId: `c-${id}`,
    campaignName: null,
    action: "manter",
    currentValue: null,
    proposedValue: null,
    kpi: { key: "cpl", value: 30, target: 50 },
    decision: "MANTER",
    reason: "",
    window: { since: "2026-11-10", until: "2026-11-16" },
    status: "proposto",
    expiresAt: "2026-11-17T12:00:00.000Z",
    approvals: { gestor_gd: null, cliente: null },
    rejection: null,
    applied: null,
    ...patch,
  };
}

const ITEMS = () => [
  item("i1", {
    level: "ad",
    entityId: "ad-77",
    entityName: "Vídeo depoimento · Dra. Fernanda · versão longa com legenda",
    campaignId: "c1",
    campaignName: "[LEADS] Diagnóstico comercial gratuito · Uberlândia e região · novembro",
    action: "pausar",
    decision: "MATAR",
    kpi: { key: "cpl", value: 150, target: 50 },
    reason:
      "Custo por lead em 150, 200% pior que a meta de 50 (corta a partir de 50%). Proposta: pausar este anúncio. Outro anúncio da campanha também está para cortar e fica para o próximo plano (uma mudança por dia).",
  }),
  item("i2", {
    entityId: "c2",
    entityName: "[CONVERSAS] WhatsApp · remarketing de quem visitou o site nos últimos 30 dias",
    campaignId: "c2",
    campaignName: "[CONVERSAS] WhatsApp · remarketing de quem visitou o site nos últimos 30 dias",
    action: "aumentar_verba",
    decision: "ESCALAR",
    currentValue: 100,
    proposedValue: 130,
    reason:
      "Campanha para escalar. Custo por lead da campanha em 30 (meta 50), gasto de R$ 300,00 em 7 dias. Anúncios: 2 para escalar, 0 na faixa, 0 para cortar, 1 sem amostra. Proposta: verba diária de R$ 100,00 para R$ 130,00 (+30%; limitado pelo teto diário de R$ 230,00).",
  }),
];

type Options = { roles?: Role[]; autonomy?: "relatorio" | "sugere"; withPlan?: boolean; approvedQueue?: boolean };

async function serve(page: Page, options: Options = {}) {
  const { roles = ["gestor_gd"], autonomy = "sugere", withPlan = true, approvedQueue = false } = options;
  const me = roles.includes("gestor_gd") ? "caio@gd.test" : "dona@cliente.test";
  const state = {
    items: withPlan ? ITEMS() : [],
    queue: approvedQueue
      ? [
          item("q1", {
            entityId: "c9",
            entityName: "[LEADS] Formulário instantâneo · público aberto",
            action: "reduzir_verba",
            currentValue: 80,
            proposedValue: 50,
            status: "aprovado",
            approvals: { gestor_gd: { email: "caio@gd.test", at: "2026-11-16T12:10:00.000Z" }, cliente: { email: "dona@cliente.test", at: "2026-11-16T13:00:00.000Z" } },
            reason: "Teto diário.",
          }),
        ]
      : [],
    approves: [] as { id: string; body: Record<string, unknown> }[],
    rejects: [] as { id: string; body: Record<string, unknown> }[],
    applied: [] as string[],
    generates: 0,
    puts: [] as Record<string, unknown>[],
  };
  const plan = {
    id: "plano-1",
    date: "2026-11-16",
    windowDays: 7,
    window: { since: "2026-11-10", until: "2026-11-16" },
    primaryKpi: "cpl",
    dataCollectedAt: "2026-11-16T10:00:21.000Z",
    generatedBy: "agendador",
    generatedAt: "2026-11-16T10:01:02.000Z",
    expiresAt: "2026-11-17T10:01:02.000Z",
    summary: {
      primaryKpiLabel: "Custo por lead",
      primaryKpiUnit: "currency",
      target: 50,
      maxIncreasePct: 50,
      minDailyBudget: 10,
      caps: { daily: 230, monthly: null, monthToDate: null, monthlyAllowedDaily: null, effective: 230, currentTotal: 200, shortfall: null },
      skipped: [
        {
          platform: "meta",
          campaignId: "c3",
          campaignName: "[LEADS] Campanha nova de teste A/B com público semelhante",
          reason: "Amostra insuficiente em todos os anúncios. Sem amostra não há ação.",
        },
      ],
    },
  };

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname === "/api/traffic/access") return json(200, { success: true, allowed: true, reason: null, message: null });
    if (url.pathname === "/api/traffic/plans/today") {
      return json(200, {
        success: true,
        plan: withPlan ? plan : null,
        items: state.items,
        applyQueue: state.queue,
        autonomyLevel: autonomy,
        myRoles: roles,
      });
    }
    if (url.pathname === "/api/traffic/plans" && method === "GET") {
      return json(200, {
        success: true,
        plans: withPlan ? [{ ...plan, counts: { proposto: 1, aprovado_gd: 1 } }, { ...plan, id: "plano-0", date: "2026-11-15", counts: { aprovado: 1, recusado: 1 } }] : [],
      });
    }
    if (url.pathname === "/api/traffic/plans/generate" && method === "POST") {
      state.generates++;
      return json(422, {
        success: false,
        error: {
          code: "NO_NEW_DATA",
          message: "Nenhuma coleta nova desde o plano de 15/11/2026 (coleta de 15/11, 19:00). Sem dado novo, o plano seria o mesmo.",
        },
      });
    }
    const approve = url.pathname.match(/^\/api\/traffic\/plan-items\/([^/]+)\/approve$/);
    if (approve && method === "POST") {
      const body = req.postDataJSON();
      state.approves.push({ id: approve[1], body });
      if (!roles.includes(body.role)) return json(403, { success: false, error: { code: "NOT_AN_APPROVER", message: "Seu email não está na lista." } });
      const found = state.items.find((i) => i.id === approve[1])!;
      found.approvals = { ...found.approvals, [body.role]: { email: me, at: "2026-11-16T14:05:00.000Z" } };
      found.status = found.approvals.gestor_gd && found.approvals.cliente ? "aprovado" : body.role === "gestor_gd" ? "aprovado_gd" : "aprovado_cliente";
      return json(200, { success: true, item: found });
    }
    const reject = url.pathname.match(/^\/api\/traffic\/plan-items\/([^/]+)\/reject$/);
    if (reject && method === "POST") {
      const body = req.postDataJSON();
      state.rejects.push({ id: reject[1], body });
      const found = state.items.find((i) => i.id === reject[1])!;
      found.status = "recusado";
      found.rejection = { role: body.role, email: me, at: "2026-11-16T14:06:00.000Z", reason: body.reason };
      return json(200, { success: true, item: found });
    }
    const applied = url.pathname.match(/^\/api\/traffic\/plan-items\/([^/]+)\/applied$/);
    if (applied && method === "POST") {
      state.applied.push(applied[1]);
      const found = state.queue.find((i) => i.id === applied[1])!;
      found.applied = { email: me, at: "2026-11-16T15:30:00.000Z" };
      return json(200, { success: true, item: found });
    }
    if (url.pathname === "/api/traffic/profile" && method === "GET") {
      return json(200, {
        success: true,
        profile: {
          exists: true,
          objectives: [],
          kpis: [{ key: "cpl", target: 50, better: "lower", scale_at: 0.2, kill_at: 0.5, min_spend: null }],
          primaryKpi: "cpl",
          windows: [4, 7, 14, 30],
          minSpendFactor: 1.2,
          dailyBudgetCap: 230,
          monthlyBudgetCap: null,
          maxIncreasePct: 50,
          autonomyLevel: "relatorio",
          approvers: [{ name: "Caio", role: "gestor_gd", email: "caio@gd.test" }],
          updatedAt: "2026-11-15T15:00:00.000Z",
        },
        catalog: CATALOG,
        allowedWindows: [4, 7, 14, 30],
        autonomy: { levels: ["relatorio", "sugere", "aplica_com_limites"], available: ["relatorio", "sugere"] },
      });
    }
    if (url.pathname === "/api/traffic/profile" && method === "PUT") {
      const body = req.postDataJSON();
      state.puts.push(body);
      return json(200, { success: true, profile: { ...body, exists: true, updatedAt: "2026-11-16T15:00:00.000Z" } });
    }
    return json(200, {});
  });
  return state;
}

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

// Elemento a elemento: o PageShell rola por dentro, então scrollWidth do documento não basta.
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
  test.describe(`Tráfego, plano e aprovações — ${viewport.nome}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("itens com ação, valores e motivo na tela; GD aprova pelo próprio lado e o estado muda", async ({ page }) => {
      const state = await serve(page, { roles: ["gestor_gd"] });
      await page.goto(`${URL_BASE}?tab=plano`);

      await expect(page.getByRole("tab", { name: "Plano e aprovações" })).toHaveAttribute("data-state", "active");
      await expect(page.getByText("Plano de 16/11/2026")).toBeVisible();
      const itens = page.getByTestId("item-plano");
      await expect(itens).toHaveCount(2);

      const pausa = itens.nth(0);
      await expect(pausa).toContainText("Pausar");
      await expect(pausa.getByTestId("motivo")).toContainText("200% pior que a meta");
      await expectInsideViewport(page, pausa.getByTestId("motivo"));

      const aumento = itens.nth(1);
      await expect(aumento.getByTestId("valores")).toHaveText(/R\$\s100,00 → R\$\s130,00/);
      await expectInsideViewport(page, aumento.getByTestId("valores"));
      await expectInsideViewport(page, aumento.getByTestId("motivo"));

      await expect(pausa.getByRole("button", { name: "Aprovar como cliente" })).toHaveCount(0);
      await expectNoSideScroll(page);
      await page.screenshot({ path: `${SHOTS}/trafego-plano-${viewport.nome}-itens.png`, fullPage: true });

      await pausa.getByRole("button", { name: "Aprovar como GD" }).click();
      await expect(pausa).toHaveAttribute("data-status", "aprovado_gd");
      await expect(pausa).toContainText("Aprovado pela GD, falta o cliente");
      await expect(pausa).toContainText("caio@gd.test");
      expect(state.approves).toEqual([{ id: "i1", body: { role: "gestor_gd" } }]);
      await expect(pausa.getByRole("button", { name: "Aprovar como GD" })).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/trafego-plano-${viewport.nome}-aprovado-gd.png`, fullPage: true });
    });

    test("recusar exige motivo, manda o motivo e mostra no item", async ({ page }) => {
      const state = await serve(page, { roles: ["cliente"] });
      await page.goto(`${URL_BASE}?tab=plano`);
      const aumento = page.getByTestId("item-plano").nth(1);
      await expect(aumento.getByRole("button", { name: "Aprovar como cliente" })).toBeVisible();
      await expect(aumento.getByRole("button", { name: "Aprovar como GD" })).toHaveCount(0);

      await aumento.getByRole("button", { name: "Recusar" }).click();
      const confirmar = aumento.getByRole("button", { name: "Confirmar recusa" });
      await expect(confirmar).toBeDisabled();
      await aumento.getByLabel("Motivo da recusa").fill("abc");
      await expect(confirmar).toBeDisabled();
      await aumento.getByLabel("Motivo da recusa").fill("Verba do mês já está no limite combinado");
      await expect(confirmar).toBeEnabled();
      await expectInsideViewport(page, confirmar);
      await confirmar.click();

      await expect(aumento).toHaveAttribute("data-status", "recusado");
      await expect(aumento).toContainText("Verba do mês já está no limite combinado");
      expect(state.rejects).toEqual([{ id: "i2", body: { role: "cliente", reason: "Verba do mês já está no limite combinado" } }]);
      await expectNoSideScroll(page);
      await page.screenshot({ path: `${SHOTS}/trafego-plano-${viewport.nome}-recusado.png`, fullPage: true });
    });

    test("aprovado pelos dois aparece em Aplicar à mão; marcar feito mostra quem fez", async ({ page }) => {
      const state = await serve(page, { roles: ["gestor_gd"], approvedQueue: true });
      await page.goto(`${URL_BASE}?tab=plano`);
      const linha = page.getByTestId("aplicar-item");
      await expect(linha).toHaveCount(1);
      await expect(linha).toContainText("Reduzir verba: [LEADS] Formulário instantâneo");
      await expect(linha).toContainText(/R\$\s80,00 → R\$\s50,00/);
      await expectInsideViewport(page, linha.getByRole("button", { name: "Marcar feito" }));
      await linha.getByRole("button", { name: "Marcar feito" }).click();
      await expect(linha).toContainText("Feito por caio@gd.test");
      expect(state.applied).toEqual(["q1"]);

      const historico = page.getByTestId("historico-plano");
      await expect(historico).toHaveCount(2);
      await expect(historico.nth(0)).toContainText("1 esperando aprovação · 1 só a GD aprovou");
      await expect(historico.nth(1)).toContainText("15/11/2026");
      await expect(historico.nth(1)).toContainText("1 aprovado pelos dois · 1 recusado");
      await expectNoSideScroll(page);
      await page.screenshot({ path: `${SHOTS}/trafego-plano-${viewport.nome}-aplicar.png`, fullPage: true });
    });

    test("fora do plano mostra o motivo de cada campanha", async ({ page }) => {
      await serve(page);
      await page.goto(`${URL_BASE}?tab=plano`);
      const fora = page.getByTestId("fora-do-plano");
      await fora.locator("summary").click();
      await expect(fora).toContainText("Amostra insuficiente em todos os anúncios");
      await expectInsideViewport(page, fora);
      await expectNoSideScroll(page);
    });

    test("perfil em Relatório: sem plano, com aviso e atalho para Metas", async ({ page }) => {
      await serve(page, { autonomy: "relatorio", withPlan: false });
      await page.goto(`${URL_BASE}?tab=plano`);
      await expect(page.getByText('O perfil desta empresa está em "Relatório".')).toBeVisible();
      await expect(page.getByTestId("item-plano")).toHaveCount(0);
      await expectNoSideScroll(page);
      await page.screenshot({ path: `${SHOTS}/trafego-plano-${viewport.nome}-relatorio.png`, fullPage: true });
      await page.getByRole("button", { name: "Abrir Metas e regras" }).click();
      await expect(page.getByRole("tab", { name: "Metas e regras" })).toHaveAttribute("data-state", "active");
    });

    test("sem plano hoje: gerar sem dado novo mostra o motivo do servidor", async ({ page }) => {
      const state = await serve(page, { withPlan: false });
      await page.goto(`${URL_BASE}?tab=plano`);
      await page.getByRole("button", { name: "Gerar plano agora" }).click();
      await expect(page.getByText(/Nenhuma coleta nova desde o plano de 15\/11\/2026/)).toBeVisible();
      expect(state.generates).toBe(1);
      await expectNoSideScroll(page);
      await page.screenshot({ path: `${SHOTS}/trafego-plano-${viewport.nome}-sem-dado-novo.png` });
    });

    test("Metas: Sugere habilitado; salvar manda o nível e o email do aprovador", async ({ page }) => {
      const state = await serve(page);
      await page.goto(`${URL_BASE}?tab=metas`);
      const sugere = page.getByRole("radio", { name: /^Sugere e pede aprovação/ });
      await expect(sugere).toBeEnabled();
      await expect(page.getByRole("radio", { name: /^Aplica dentro dos limites/ })).toBeDisabled();
      await sugere.click();

      await page.getByRole("button", { name: "Adicionar aprovador" }).click();
      await page.getByLabel("Nome do aprovador 2").fill("Dona da loja");
      await page.getByLabel("Email do aprovador 2").fill("dona@cliente.test");
      await page.getByLabel("Papel do aprovador 2").selectOption("cliente");
      await expectInsideViewport(page, page.getByLabel("Email do aprovador 2"));
      await expectNoSideScroll(page);
      await page.screenshot({ path: `${SHOTS}/trafego-plano-${viewport.nome}-metas-sugere.png`, fullPage: true });

      await page.getByRole("button", { name: "Salvar metas e regras" }).click();
      await expect(page.getByText("Metas e regras salvas.")).toBeVisible();
      expect(state.puts).toHaveLength(1);
      expect(state.puts[0]).toMatchObject({
        autonomyLevel: "sugere",
        approvers: [
          { name: "Caio", role: "gestor_gd", email: "caio@gd.test" },
          { name: "Dona da loja", role: "cliente", email: "dona@cliente.test" },
        ],
      });
    });
  });
}
