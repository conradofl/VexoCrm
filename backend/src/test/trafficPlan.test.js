// Plano do dia e aprovação dupla do Gestor de Tráfego (Fase 2).
//
// Banco real: pglite com as DUAS migrations de produção (Fase 1 e Fase 2). O
// gerador, a decisão, as travas e a aprovação rodam de verdade. Dublado só o
// que sai do processo: o fetch das plataformas (na leitura de verba) e o
// token do Firebase (nas rotas).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrafficDb, createMetaFetch, insertAccount, insightRow, metaHandlerFor, poolFor } from "./helpers/trafficHarness.js";
import { dateKeyInTimeZone } from "../traffic/collector.js";
import { startHttp } from "./helpers/audioLibraryHarness.js";
import { collectMetaAccount } from "../traffic/collector.js";
import { createMetaAdsClient, mapMetaBudgets } from "../traffic/metaAdsClient.js";
import { mapGoogleBudgets } from "../traffic/googleAdsClient.js";
import { normalizeProfileInput, saveProfile } from "../traffic/service.js";
import {
  approveItem,
  generatePlan,
  getPlan,
  getTodayPlan,
  listApplyQueue,
  markItemApplied,
  rejectItem,
} from "../traffic/plan.js";
import { createTrafficCollectorScheduler } from "../traffic/collectorScheduler.js";

let db = null;
let pool = null;
vi.mock("../services/database.js", () => ({
  get pgDatabasePool() {
    return pool;
  },
}));
vi.mock("../access/middlewares.js", async (importOriginal) => {
  const actual = await importOriginal();
  // Dublê do Firebase: identidade e escopo vêm de cabeçalhos do teste.
  function fakeAuth(req, res, next) {
    const raw = req.headers["x-test-access"];
    if (!raw) return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED" } });
    req.authAccess = JSON.parse(String(raw));
    req.authUser = JSON.parse(String(req.headers["x-test-user"] || "{}"));
    return next();
  }
  return { ...actual, requireFirebaseAuth: fakeAuth };
});

const { registerTrafficRoutes } = await import("../traffic/routes.js");

const A = "teste-plano-a";
const B = "teste-plano-b";
// 09:00 em São Paulo de 16/11/2026. Janela de 7 dias: 10/11 a 16/11.
const NOW = new Date("2026-11-16T12:00:00.000Z");
const SYNC = new Date("2026-11-16T10:00:00.000Z");
const GD = { uid: "uid-caio", email: "caio@gd.test" };
const CLIENTE = { uid: "uid-dona", email: "dona@cliente.test" };
const OUTRO = { uid: "uid-estranho", email: "estranho@x.test" };

function horas(n, base = NOW) {
  return new Date(base.getTime() + n * 3600 * 1000);
}

async function perfil(clientId, extra = {}) {
  return saveProfile(pool, clientId, {
    kpis: [{ key: "cpl", target: 50 }],
    primaryKpi: "cpl",
    autonomyLevel: "sugere",
    maxIncreasePct: 50,
    approvers: [
      { name: "Caio", role: "gestor_gd", email: GD.email },
      { name: "Dona", role: "cliente", email: CLIENTE.email },
    ],
    ...extra,
  });
}

async function conta(clientId, externalAccountId = "111", lastSync = SYNC) {
  const account = await insertAccount(db, { clientId, externalAccountId });
  await db.query("UPDATE traffic_accounts SET last_sync_at = $2, currency = 'BRL' WHERE id = $1", [account.id, lastSync]);
  return account;
}

// spend/leads dão o CPL. Meta 50: ESCALAR com CPL <= 40, MATAR com CPL >= 75,
// amostra insuficiente com gasto < 60.
async function anuncio(clientId, { ad, campaign, adset = `${campaign}-s`, spend, leads, date = "2026-11-15", collectedAt = SYNC, account = "111" }) {
  await db.query(
    `INSERT INTO traffic_metrics_daily
       (client_id, platform, external_account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
        effective_status, date, spend, leads, collected_at)
     VALUES ($1, 'meta', $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', $9, $10, $11, $12)`,
    [clientId, account, campaign, `Campanha ${campaign}`, adset, `Conjunto ${adset}`, ad, `Anúncio ${ad}`, date, spend, leads, collectedAt]
  );
}

async function verba(clientId, { campaign, daily, level = "campaign", entity = campaign, collectedAt = SYNC, shared = false, lifetime = null, status = "ACTIVE", account = "111" }) {
  await db.query(
    `INSERT INTO traffic_budgets
       (client_id, platform, external_account_id, level, entity_id, campaign_id, name, daily_budget, lifetime_budget, shared, status, collected_at)
     VALUES ($1, 'meta', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [clientId, account, level, entity, campaign, `Campanha ${campaign}`, daily, lifetime, shared, status, collectedAt]
  );
}

function porCampanha(items, campaignId) {
  return items.filter((item) => item.campaignId === campaignId);
}

async function gera(clientId = A, now = NOW) {
  return generatePlan(pool, clientId, { now, generatedBy: "teste" });
}

beforeEach(async () => {
  db = await createTrafficDb();
  pool = poolFor(db);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await db.close();
  db = null;
  pool = null;
});

describe("gerador do plano do dia: travas", () => {
  it("aumenta a verba no máximo o max_increase_pct do perfil", async () => {
    await perfil(A, { maxIncreasePct: 20 });
    await conta(A);
    await anuncio(A, { ad: "a1", campaign: "c1", spend: 300, leads: 10 });
    await verba(A, { campaign: "c1", daily: 100 });

    const { items } = await gera();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ action: "aumentar_verba", level: "campaign", entityId: "c1", currentValue: 100, proposedValue: 120, status: "proposto" });
    expect(items[0].reason).toContain("R$ 100,00 para R$ 120,00");
    expect(items[0].reason).toContain("aumento máximo do perfil: 20%");
  });

  it("perfil com aumento máximo de 0% não propõe aumento: mantém e diz por quê", async () => {
    await perfil(A, { maxIncreasePct: 0 });
    await conta(A);
    await anuncio(A, { ad: "a1", campaign: "c1", spend: 300, leads: 10 });
    await verba(A, { campaign: "c1", daily: 100 });

    const { items } = await gera();
    expect(items[0]).toMatchObject({ action: "manter", currentValue: 100, proposedValue: 100 });
    expect(items[0].reason).toContain("aumento máximo de 0%");
  });

  it("verba proposta abaixo de R$ 10/dia não vira proposta", async () => {
    await perfil(A);
    await conta(A);
    await anuncio(A, { ad: "a1", campaign: "c1", spend: 300, leads: 10 });
    await verba(A, { campaign: "c1", daily: 6 });

    const { items } = await gera();
    expect(items[0]).toMatchObject({ action: "manter", currentValue: 6, proposedValue: 6 });
    expect(items[0].reason).toContain("abaixo do mínimo de R$ 10,00 por dia");
  });

  it("redução por teto nunca leva a verba abaixo de R$ 10/dia", async () => {
    await perfil(A, { dailyBudgetCap: 20 });
    await conta(A);
    await anuncio(A, { ad: "a1", campaign: "c1", spend: 300, leads: 6 });
    await verba(A, { campaign: "c1", daily: 15 });
    await anuncio(A, { ad: "a2", campaign: "c2", spend: 300, leads: 6 });
    await verba(A, { campaign: "c2", daily: 15 });

    const { items, plan } = await gera();
    const reducoes = items.filter((i) => i.action === "reduzir_verba");
    for (const item of reducoes) expect(item.proposedValue).toBeGreaterThanOrEqual(10);
    // 30 de verba, teto 20: corta 5 de uma (15 -> 10) e 5 da outra (15 -> 10).
    expect(reducoes.map((i) => i.proposedValue).sort()).toEqual([10, 10]);
    expect(plan.summary.caps).toMatchObject({ daily: 20, currentTotal: 30, effective: 20, shortfall: null });
  });

  it("uma mudança por dia por campanha: campanha com vários anúncios para cortar pausa só o pior", async () => {
    await perfil(A);
    await conta(A);
    await anuncio(A, { ad: "ruim", campaign: "c1", spend: 300, leads: 3 }); // CPL 100
    await anuncio(A, { ad: "pior", campaign: "c1", spend: 300, leads: 2 }); // CPL 150
    await anuncio(A, { ad: "bom", campaign: "c1", spend: 300, leads: 10 }); // CPL 30
    await verba(A, { campaign: "c1", daily: 100 });

    const { items } = await gera();
    const daCampanha = porCampanha(items, "c1");
    expect(daCampanha).toHaveLength(1);
    expect(daCampanha[0]).toMatchObject({ action: "pausar", level: "ad", entityId: "pior" });
    expect(daCampanha[0].reason).toContain("Outro anúncio da campanha também está para cortar e fica para o próximo plano");
  });

  it("uma mudança por dia por campanha: mudança aplicada hoje, aprovada sem aplicar ou proposta pendente bloqueiam a campanha", async () => {
    await perfil(A);
    await conta(A, "111", horas(-30));
    for (const c of ["hoje", "aprovada", "pendente", "livre"]) {
      await anuncio(A, { ad: `ad-${c}`, campaign: c, spend: 300, leads: 10, collectedAt: horas(-30) });
      await verba(A, { campaign: c, daily: 100, collectedAt: horas(-30) });
    }
    // Plano de ontem com três itens em estados diferentes.
    const ontem = await gera(A, horas(-24));
    const item = (c) => ontem.items.find((i) => i.campaignId === c);
    await approveItem(pool, { clientId: A, itemId: item("hoje").id, role: "gestor_gd", identity: GD, now: horas(-23) });
    await approveItem(pool, { clientId: A, itemId: item("hoje").id, role: "cliente", identity: CLIENTE, now: horas(-22) });
    await markItemApplied(pool, { clientId: A, itemId: item("hoje").id, identity: GD, now: horas(-2) }); // 07:00 de hoje em SP
    await approveItem(pool, { clientId: A, itemId: item("aprovada").id, role: "gestor_gd", identity: GD, now: horas(-23) });
    await approveItem(pool, { clientId: A, itemId: item("aprovada").id, role: "cliente", identity: CLIENTE, now: horas(-22) });
    await rejectItem(pool, { clientId: A, itemId: item("livre").id, role: "cliente", identity: CLIENTE, reason: "não quero agora", now: horas(-22) });
    // "pendente" segue pendente, mas o plano de ontem vence às 09:00 de hoje:
    // para manter a pendência viva, o item ganha prazo maior.
    await db.query("UPDATE traffic_plan_items SET expires_at = $2 WHERE id = $1", [item("pendente").id, horas(5)]);

    // Coleta nova hoje.
    await db.query("UPDATE traffic_accounts SET last_sync_at = $1", [SYNC]);
    await db.query("UPDATE traffic_metrics_daily SET collected_at = $1", [SYNC]);
    await db.query("UPDATE traffic_budgets SET collected_at = $1", [SYNC]);

    const { items, plan } = await gera();
    expect(items.map((i) => i.campaignId)).toEqual(["livre"]);
    const motivos = Object.fromEntries(plan.summary.skipped.map((s) => [s.campaignId, s.reason]));
    expect(motivos.hoje).toContain("já mudou hoje");
    expect(motivos.aprovada).toContain("ainda não foi aplicada");
    expect(motivos.pendente).toContain("esperando aprovação");
  });

  it("teto diário: aumento cortado na folga, e quem sobra sem folga fica em manter", async () => {
    await perfil(A, { dailyBudgetCap: 230 });
    await conta(A);
    await anuncio(A, { ad: "a1", campaign: "melhor", spend: 300, leads: 15 }); // CPL 20
    await verba(A, { campaign: "melhor", daily: 100 });
    await anuncio(A, { ad: "a2", campaign: "boa", spend: 300, leads: 10 }); // CPL 30
    await verba(A, { campaign: "boa", daily: 100 });

    const { items } = await gera();
    expect(porCampanha(items, "melhor")[0]).toMatchObject({ action: "aumentar_verba", currentValue: 100, proposedValue: 130 });
    expect(porCampanha(items, "melhor")[0].reason).toContain("limitado pelo teto diário de R$ 230,00");
    expect(porCampanha(items, "boa")[0]).toMatchObject({ action: "manter", currentValue: 100, proposedValue: 100 });
    expect(porCampanha(items, "boa")[0].reason).toContain("Sem folga no teto diário");
  });

  it("teto diário estourado: reduz a pior campanha até caber e não aumenta ninguém", async () => {
    await perfil(A, { dailyBudgetCap: 150 });
    await conta(A);
    await anuncio(A, { ad: "a1", campaign: "boa", spend: 300, leads: 10 }); // ESCALAR
    await verba(A, { campaign: "boa", daily: 100 });
    await anuncio(A, { ad: "a2", campaign: "media", spend: 300, leads: 5 }); // CPL 60, MANTER
    await verba(A, { campaign: "media", daily: 100 });

    const { items } = await gera();
    expect(porCampanha(items, "media")[0]).toMatchObject({ action: "reduzir_verba", currentValue: 100, proposedValue: 50 });
    expect(porCampanha(items, "media")[0].reason).toContain("acima do teto diário de R$ 150,00");
    expect(porCampanha(items, "boa")[0]).toMatchObject({ action: "manter" });
  });

  it("teto mensal: o que já foi gasto no mês limita a verba diária do resto do mês", async () => {
    // Novembro tem 30 dias; dia 16 deixa 15 dias (16 a 30). Gasto de 01 a 15: 2.700.
    // Teto 4.500: cabem (4.500 - 2.700) / 15 = 120 por dia.
    await perfil(A, { monthlyBudgetCap: 4500 });
    await conta(A);
    await anuncio(A, { ad: "a1", campaign: "c1", spend: 300, leads: 10, date: "2026-11-15" });
    await anuncio(A, { ad: "a1", campaign: "c1", spend: 2400, leads: 80, date: "2026-11-02" });
    await verba(A, { campaign: "c1", daily: 100 });

    const { items, plan } = await gera();
    expect(plan.summary.caps).toMatchObject({ monthly: 4500, monthToDate: 2700, monthlyAllowedDaily: 120, effective: 120 });
    expect(items[0]).toMatchObject({ action: "aumentar_verba", currentValue: 100, proposedValue: 120 });
    expect(items[0].reason).toContain("teto mensal de R$ 4.500,00");
  });

  it("amostra insuficiente nunca vira ação, nem pausa de campanha", async () => {
    await perfil(A);
    await conta(A);
    await anuncio(A, { ad: "novo", campaign: "so-amostra", spend: 30, leads: 0 });
    await verba(A, { campaign: "so-amostra", daily: 100 });
    // Um anúncio para cortar e um sem amostra: pausa o anúncio, não a campanha.
    await anuncio(A, { ad: "ruim", campaign: "mista", spend: 300, leads: 2 });
    await anuncio(A, { ad: "estreante", campaign: "mista", spend: 20, leads: 0 });

    const { items, plan } = await gera();
    expect(porCampanha(items, "so-amostra")).toEqual([]);
    expect(plan.summary.skipped.find((s) => s.campaignId === "so-amostra").reason).toContain("Amostra insuficiente");
    expect(porCampanha(items, "mista")).toHaveLength(1);
    expect(porCampanha(items, "mista")[0]).toMatchObject({ action: "pausar", level: "ad", entityId: "ruim" });
  });

  it("todos os anúncios para cortar: pausa a campanha", async () => {
    await perfil(A);
    await conta(A);
    await anuncio(A, { ad: "r1", campaign: "c1", spend: 300, leads: 2 });
    await anuncio(A, { ad: "r2", campaign: "c1", spend: 300, leads: 3 });

    const { items } = await gera();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ action: "pausar", level: "campaign", entityId: "c1", decision: "MATAR" });
  });

  it("verba não lida na última coleta, verba no conjunto e verba compartilhada ficam de fora com o motivo", async () => {
    await perfil(A);
    await conta(A);
    await anuncio(A, { ad: "a1", campaign: "velha", spend: 300, leads: 10 });
    await verba(A, { campaign: "velha", daily: 100, collectedAt: horas(-30, SYNC) });
    await anuncio(A, { ad: "a2", campaign: "abo", spend: 300, leads: 10 });
    await verba(A, { campaign: "abo", level: "adset", entity: "abo-s", daily: 50 });
    await anuncio(A, { ad: "a3", campaign: "shared", spend: 300, leads: 10 });
    await verba(A, { campaign: "shared", daily: 100, shared: true });
    await anuncio(A, { ad: "a4", campaign: "sem-verba", spend: 300, leads: 10 });

    const { items, plan } = await gera();
    expect(items).toEqual([]);
    const motivos = Object.fromEntries(plan.summary.skipped.map((s) => [s.campaignId, s.reason]));
    expect(motivos.velha).toContain("antes da última coleta");
    expect(motivos.abo).toContain("fica nos conjuntos (1)");
    expect(motivos.shared).toContain("compartilhada");
    expect(motivos["sem-verba"]).toContain("não foi lida");
  });

  it("sem coleta nova desde o último plano: não gera e diz por quê; com coleta nova, gera", async () => {
    await perfil(A);
    await conta(A);
    await anuncio(A, { ad: "a1", campaign: "c1", spend: 300, leads: 6 });
    await gera(A, horas(-24));

    const semDado = gera(A, NOW);
    await expect(semDado).rejects.toMatchObject({ code: "NO_NEW_DATA", status: 422 });
    await expect(gera(A, NOW)).rejects.toThrow(/Nenhuma coleta nova desde o plano de 15\/11\/2026/);

    await db.query("UPDATE traffic_metrics_daily SET collected_at = $1", [horas(-1)]);
    const { plan } = await gera(A, NOW);
    expect(plan.date).toBe("2026-11-16");
  });

  it("não gera dois planos no mesmo dia", async () => {
    await perfil(A);
    await conta(A);
    await anuncio(A, { ad: "a1", campaign: "c1", spend: 300, leads: 6 });
    await gera();
    await expect(gera()).rejects.toMatchObject({ code: "PLAN_ALREADY_EXISTS" });
  });

  it("perfil em Relatório, sem KPI principal ou sem métrica: não gera e diz por quê", async () => {
    await perfil(A, { autonomyLevel: "relatorio" });
    await expect(gera()).rejects.toMatchObject({ code: "AUTONOMY_REPORT_ONLY" });
    await perfil(A, { primaryKpi: null });
    await expect(gera()).rejects.toMatchObject({ code: "NO_PRIMARY_KPI" });
    await perfil(A);
    await expect(gera()).rejects.toMatchObject({ code: "NO_DATA" });
  });

  it("perfil: 'sugere' liberado, 'aplica_com_limites' segue recusado, e a mesma pessoa não aprova pelos dois lados", () => {
    expect(normalizeProfileInput({ autonomyLevel: "sugere" }).autonomyLevel).toBe("sugere");
    expect(() => normalizeProfileInput({ autonomyLevel: "aplica_com_limites" })).toThrow(/não aplica nada/);
    expect(() =>
      normalizeProfileInput({
        approvers: [
          { name: "Caio", role: "gestor_gd", email: "caio@gd.test" },
          { name: "Caio de novo", role: "cliente", email: "CAIO@gd.test" },
        ],
      })
    ).toThrow(/dois lados/);
  });
});

describe("aprovação dupla", () => {
  async function planoComUmItem() {
    await perfil(A);
    await conta(A);
    await anuncio(A, { ad: "a1", campaign: "c1", spend: 300, leads: 10 });
    await verba(A, { campaign: "c1", daily: 100 });
    const { items } = await gera();
    return items[0];
  }

  it("só a GD aprovando não libera; só o cliente também não; os dois liberam e vão para a lista de aplicar", async () => {
    const item = await planoComUmItem();
    const gd = await approveItem(pool, { clientId: A, itemId: item.id, role: "gestor_gd", identity: GD, now: horas(1) });
    expect(gd.status).toBe("aprovado_gd");
    expect(await listApplyQueue(pool, A, { now: horas(1) })).toEqual([]);

    const ambos = await approveItem(pool, { clientId: A, itemId: item.id, role: "cliente", identity: CLIENTE, now: horas(2) });
    expect(ambos.status).toBe("aprovado");
    expect(ambos.approvals).toEqual({
      gestor_gd: { email: GD.email, at: horas(1).toISOString() },
      cliente: { email: CLIENTE.email, at: horas(2).toISOString() },
    });
    expect((await listApplyQueue(pool, A, { now: horas(2) })).map((i) => i.id)).toEqual([item.id]);
  });

  it("só o cliente aprovando não libera", async () => {
    const item = await planoComUmItem();
    const so = await approveItem(pool, { clientId: A, itemId: item.id, role: "cliente", identity: CLIENTE, now: horas(1) });
    expect(so.status).toBe("aprovado_cliente");
    expect(await listApplyQueue(pool, A, { now: horas(1) })).toEqual([]);
    await expect(markItemApplied(pool, { clientId: A, itemId: item.id, identity: GD, now: horas(1) })).rejects.toMatchObject({ code: "NOT_APPROVED" });
  });

  it("a mesma pessoa não vale pelas duas aprovações (servidor e banco)", async () => {
    const item = await planoComUmItem();
    await approveItem(pool, { clientId: A, itemId: item.id, role: "gestor_gd", identity: GD, now: horas(1) });
    // Mesmo uid tentando pelo lado do cliente, ainda que com outro email na lista.
    await perfil(A, {
      approvers: [
        { name: "Caio", role: "gestor_gd", email: GD.email },
        { name: "Caio outro email", role: "cliente", email: "caio.pessoal@x.test" },
      ],
    });
    await expect(
      approveItem(pool, { clientId: A, itemId: item.id, role: "cliente", identity: { uid: GD.uid, email: "caio.pessoal@x.test" }, now: horas(2) })
    ).rejects.toMatchObject({ code: "SAME_PERSON" });

    // O banco recusa mesmo se alguém escrever direto.
    await expect(
      db.query("UPDATE traffic_plan_items SET client_approved_by_uid = gd_approved_by_uid, client_approved_at = now() WHERE id = $1", [item.id])
    ).rejects.toThrow(/traffic_plan_items_two_people/);
    await expect(db.query("UPDATE traffic_plan_items SET status = 'aprovado' WHERE id = $1", [item.id])).rejects.toThrow(
      /traffic_plan_items_approved_needs_both/
    );
  });

  it("quem não está na lista de aprovadores não aprova, nem com o papel certo", async () => {
    const item = await planoComUmItem();
    await expect(approveItem(pool, { clientId: A, itemId: item.id, role: "gestor_gd", identity: OUTRO, now: horas(1) })).rejects.toMatchObject({
      code: "NOT_AN_APPROVER",
      status: 403,
    });
    await expect(approveItem(pool, { clientId: A, itemId: item.id, role: "cliente", identity: GD, now: horas(1) })).rejects.toMatchObject({
      code: "NOT_AN_APPROVER",
    });
  });

  it("recusa exige motivo, grava quem e quando, e é final", async () => {
    const item = await planoComUmItem();
    await expect(rejectItem(pool, { clientId: A, itemId: item.id, role: "cliente", identity: CLIENTE, reason: "  ", now: horas(1) })).rejects.toMatchObject({
      code: "REASON_REQUIRED",
    });
    const recusado = await rejectItem(pool, { clientId: A, itemId: item.id, role: "cliente", identity: CLIENTE, reason: "verba do mês já está no limite", now: horas(1) });
    expect(recusado.status).toBe("recusado");
    expect(recusado.rejection).toEqual({ role: "cliente", email: CLIENTE.email, at: horas(1).toISOString(), reason: "verba do mês já está no limite" });
    await expect(approveItem(pool, { clientId: A, itemId: item.id, role: "gestor_gd", identity: GD, now: horas(2) })).rejects.toMatchObject({
      code: "ITEM_REJECTED",
    });
  });

  it("24 horas sem as duas aprovações: expira e não aceita mais aprovação", async () => {
    const item = await planoComUmItem();
    await approveItem(pool, { clientId: A, itemId: item.id, role: "gestor_gd", identity: GD, now: horas(23) });
    await expect(approveItem(pool, { clientId: A, itemId: item.id, role: "cliente", identity: CLIENTE, now: horas(24) })).rejects.toMatchObject({
      code: "ITEM_EXPIRED",
    });
    const { items } = await getPlan(pool, A, item.planId);
    expect(items[0].status).toBe("expirado");
    // A aprovação da GD continua registrada no histórico.
    expect(items[0].approvals.gestor_gd).toEqual({ email: GD.email, at: horas(23).toISOString() });
  });

  it("leitura do dia expira o que passou de 24 h sem precisar de ação de ninguém", async () => {
    const item = await planoComUmItem();
    await approveItem(pool, { clientId: A, itemId: item.id, role: "cliente", identity: CLIENTE, now: horas(1) });
    // Prazo encurtado para vencer ainda no mesmo dia em São Paulo (24 h depois já é outro dia).
    await db.query("UPDATE traffic_plan_items SET expires_at = $2 WHERE id = $1", [item.id, horas(5)]);
    const { items } = await getTodayPlan(pool, A, { now: horas(6) });
    expect(items[0]).toMatchObject({ status: "expirado", approvals: { gestor_gd: null, cliente: { email: CLIENTE.email, at: horas(1).toISOString() } } });
  });

  it("marcar aplicado: grava quem e quando; não marca duas vezes; manter não tem o que aplicar", async () => {
    const item = await planoComUmItem();
    await approveItem(pool, { clientId: A, itemId: item.id, role: "gestor_gd", identity: GD, now: horas(1) });
    await approveItem(pool, { clientId: A, itemId: item.id, role: "cliente", identity: CLIENTE, now: horas(2) });
    const feito = await markItemApplied(pool, { clientId: A, itemId: item.id, identity: GD, now: horas(3) });
    expect(feito.applied).toEqual({ email: GD.email, at: horas(3).toISOString() });
    await expect(markItemApplied(pool, { clientId: A, itemId: item.id, identity: GD, now: horas(4) })).rejects.toMatchObject({ code: "ALREADY_APPLIED" });

    await db.query("UPDATE traffic_plan_items SET action = 'manter', applied_at = NULL, applied_by_uid = NULL, applied_by_email = NULL WHERE id = $1", [item.id]);
    await expect(markItemApplied(pool, { clientId: A, itemId: item.id, identity: GD, now: horas(4) })).rejects.toMatchObject({ code: "NOTHING_TO_APPLY" });
    await expect(db.query("UPDATE traffic_plan_items SET applied_at = now() WHERE id = $1", [item.id])).rejects.toThrow(
      /traffic_plan_items_applied_only_approved/
    );
  });
});

describe("rotas do plano: isolamento entre empresas", () => {
  let http;
  const USER_A = { role: "internal", isAdmin: false, scopeMode: "assigned_clients", clientIds: [A], internalPages: ["trafego"] };
  const USER_B = { role: "internal", isAdmin: false, scopeMode: "assigned_clients", clientIds: [B], internalPages: ["trafego"] };
  const call = (method, path, access, user, body) =>
    http.call(method, path, { access, body, headers: { "x-test-user": JSON.stringify(user) } });

  beforeAll(async () => {
    http = await startHttp((app) => registerTrafficRoutes(app));
  });
  afterAll(async () => {
    await http.close();
  });
  beforeEach(() => {
    vi.stubEnv("TRAFFIC_PILOT_TENANTS", `${A},${B}`);
  });

  // A rota usa o relógio real: a métrica cai em "ontem" de verdade.
  const ontemReal = (() => {
    const [y, m, d] = dateKeyInTimeZone(new Date(), "America/Sao_Paulo").split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  })();

  async function planoDeA() {
    await perfil(A);
    await conta(A);
    await anuncio(A, { ad: "a1", campaign: "c1", spend: 300, leads: 10, date: ontemReal });
    await verba(A, { campaign: "c1", daily: 100 });
    await perfil(B, {
      approvers: [
        { name: "Gestor B", role: "gestor_gd", email: "gestor@b.test" },
        { name: "Cliente B", role: "cliente", email: "cliente@b.test" },
      ],
    });
    const res = await call("POST", "/api/traffic/plans/generate", USER_A, GD, { clientId: A });
    expect(res.status).toBe(201);
    return res.body;
  }

  it("a empresa B não lê, não aprova, não recusa e não marca item da A", async () => {
    const { plan, items } = await planoDeA();
    const intruso = { uid: "uid-gestor-b", email: "gestor@b.test" };

    expect((await call("GET", `/api/traffic/plans/today?clientId=${A}`, USER_B, intruso)).status).toBe(403);
    expect((await call("GET", `/api/traffic/plans/${plan.id}`, USER_B, intruso)).status).toBe(403);
    expect((await call("POST", `/api/traffic/plan-items/${items[0].id}/approve`, USER_B, intruso, { role: "gestor_gd" })).status).toBe(403);
    expect((await call("POST", `/api/traffic/plan-items/${items[0].id}/reject`, USER_B, intruso, { role: "gestor_gd", reason: "não é meu" })).status).toBe(403);
    expect((await call("POST", `/api/traffic/plan-items/${items[0].id}/applied`, USER_B, intruso)).status).toBe(403);

    const daB = await call("GET", `/api/traffic/plans/today?clientId=${B}`, USER_B, intruso);
    expect(daB.status).toBe(200);
    expect(daB.body.plan).toBeNull();
    expect(daB.body.applyQueue).toEqual([]);

    const { rows } = await db.query("SELECT status, gd_approved_at, rejected_at, applied_at FROM traffic_plan_items WHERE id = $1", [items[0].id]);
    expect(rows[0]).toEqual({ status: "proposto", gd_approved_at: null, rejected_at: null, applied_at: null });
  });

  it("pela rota: papéis de quem está logado, aprovação dos dois lados e lista de aplicar", async () => {
    const { items } = await planoDeA();
    const hoje = await call("GET", `/api/traffic/plans/today?clientId=${A}`, USER_A, CLIENTE);
    expect(hoje.body.myRoles).toEqual(["cliente"]);
    expect(hoje.body.items.map((i) => i.id)).toEqual([items[0].id]);

    const gd = await call("POST", `/api/traffic/plan-items/${items[0].id}/approve`, USER_A, GD, { role: "gestor_gd" });
    expect(gd.body.item.status).toBe("aprovado_gd");
    const outroLadoMesmaPessoa = await call("POST", `/api/traffic/plan-items/${items[0].id}/approve`, USER_A, GD, { role: "cliente" });
    expect(outroLadoMesmaPessoa.status).toBe(403);
    expect(outroLadoMesmaPessoa.body.error.code).toBe("NOT_AN_APPROVER");
    const cliente = await call("POST", `/api/traffic/plan-items/${items[0].id}/approve`, USER_A, CLIENTE, { role: "cliente" });
    expect(cliente.body.item.status).toBe("aprovado");

    const fila = await call("GET", `/api/traffic/plans/today?clientId=${A}`, USER_A, GD);
    expect(fila.body.applyQueue.map((i) => i.id)).toEqual([items[0].id]);
    const historico = await call("GET", `/api/traffic/plans?clientId=${A}`, USER_A, GD);
    expect(historico.body.plans[0].counts).toEqual({ aprovado: 1 });
  });

  it("gerar pela rota sem dado novo devolve 422 com o motivo", async () => {
    await planoDeA();
    await db.query("UPDATE traffic_plans SET plan_date = plan_date - 1");
    const res = await call("POST", "/api/traffic/plans/generate", USER_A, GD, { clientId: A });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("NO_NEW_DATA");
    expect(res.body.error.message).toContain("Nenhuma coleta nova");
  });
});

describe("leitura de verba na coleta (só leitura, plataforma dublada)", () => {
  it("Meta: centavos viram reais; campanha com verba própria e conjuntos com verba quando a campanha não tem", () => {
    const rows = mapMetaBudgets(
      {
        campaigns: [
          { id: "cbo", name: "CBO", daily_budget: "15050", effective_status: "ACTIVE" },
          { id: "abo", name: "ABO", effective_status: "ACTIVE" },
        ],
        adsets: [
          { id: "s1", campaign_id: "abo", daily_budget: "2000", effective_status: "ACTIVE" },
          { id: "s2", campaign_id: "cbo", daily_budget: "9999" },
        ],
      },
      "BRL"
    );
    expect(rows).toEqual([
      { level: "campaign", entity_id: "cbo", campaign_id: "cbo", name: "CBO", daily_budget: 150.5, lifetime_budget: null, shared: false, status: "ACTIVE" },
      { level: "adset", entity_id: "s1", campaign_id: "abo", name: null, daily_budget: 20, lifetime_budget: null, shared: false, status: "ACTIVE" },
    ]);
  });

  it("Google: milionésimos viram reais e verba compartilhada fica marcada", () => {
    const rows = mapGoogleBudgets([
      { campaign: { id: "9", name: "Busca", status: "ENABLED" }, campaignBudget: { amountMicros: "75500000", explicitlyShared: false } },
      { campaign: { id: "8", name: "Compartilhada", status: "PAUSED" }, campaignBudget: { amountMicros: "10000000", explicitlyShared: true } },
    ]);
    expect(rows).toEqual([
      { level: "campaign", entity_id: "9", campaign_id: "9", name: "Busca", daily_budget: 75.5, lifetime_budget: null, shared: false, status: "ACTIVE" },
      { level: "campaign", entity_id: "8", campaign_id: "8", name: "Compartilhada", daily_budget: 10, lifetime_budget: null, shared: true, status: "PAUSED" },
    ]);
  });

  it("falha na leitura de verba não derruba a coleta, não vira zero e não apaga a verba anterior", async () => {
    const account = await insertAccount(db, { clientId: A, externalAccountId: "111" });
    const insights = [insightRow({ adId: "ad1", date: "2026-11-15", spend: "100.00" })];
    const ok = createMetaFetch(metaHandlerFor({ 111: { insights, campaigns: [{ id: "c1", name: "C1", daily_budget: "10000", effective_status: "ACTIVE" }] } }));
    const primeira = await collectMetaAccount({ pool, account, client: createMetaAdsClient({ token: "t", fetchImpl: ok.fetchImpl, sleep: async () => {} }), now: SYNC });
    expect(primeira.budgets).toEqual({ ok: true, count: 1 });

    const quebrada = metaHandlerFor({ 111: { insights } });
    const falha = createMetaFetch((call) =>
      call.path.endsWith("/campaigns") ? { status: 400, body: { error: { message: "sem permissão", code: 200 } } } : quebrada(call)
    );
    const { rows: [conta2] } = await db.query("SELECT * FROM traffic_accounts WHERE id = $1", [account.id]);
    const segunda = await collectMetaAccount({
      pool,
      account: conta2,
      client: createMetaAdsClient({ token: "t", fetchImpl: falha.fetchImpl, sleep: async () => {} }),
      now: horas(2, SYNC),
    });
    expect(segunda.ok).toBe(true);
    expect(segunda.budgets.ok).toBe(false);

    const { rows: budgets } = await db.query("SELECT daily_budget::float8 AS daily, collected_at FROM traffic_budgets WHERE client_id = $1", [A]);
    expect(budgets).toEqual([{ daily: 100, collected_at: SYNC }]);
    const { rows: [depois] } = await db.query("SELECT last_sync_at, last_sync_error FROM traffic_accounts WHERE id = $1", [account.id]);
    expect(depois).toEqual({ last_sync_at: horas(2, SYNC), last_sync_error: null });
  });
});

describe("agendador gera o plano do dia depois da coleta", () => {
  it("chama o gerador com as empresas do piloto e segue mesmo se ele falhar", async () => {
    vi.stubEnv("TRAFFIC_PILOT_TENANTS", `${A},${B}`);
    const runner = vi.fn(async () => ({ meta: { connected: false }, google: { connected: false } }));
    const planner = vi.fn(async () => {
      throw new Error("planejador quebrou");
    });
    const scheduler = createTrafficCollectorScheduler({ pool, runner, planner, enabled: true });
    const result = await scheduler.tick({ now: new Date("2026-11-16T10:00:00.000Z") });
    expect(result.ran).toBe(true);
    expect(result.summary).toEqual({ meta: { connected: false }, google: { connected: false } });
    expect(planner).toHaveBeenCalledWith(expect.objectContaining({ tenants: [A, B] }));
  });

  it("com o gerador de verdade: empresa em Sugere ganha plano; em Relatório, não", async () => {
    vi.stubEnv("TRAFFIC_PILOT_TENANTS", `${A},${B}`);
    await perfil(A);
    await perfil(B, { autonomyLevel: "relatorio", approvers: [] });
    await conta(A);
    await anuncio(A, { ad: "a1", campaign: "c1", spend: 300, leads: 6 });
    const runner = vi.fn(async () => ({}));
    const scheduler = createTrafficCollectorScheduler({ pool, runner, enabled: true });
    const result = await scheduler.tick({ now: new Date("2026-11-16T10:00:00.000Z") });
    expect(result.summary.plans).toEqual([{ clientId: A, ok: true, planId: expect.any(String), items: 1 }]);
  });
});
