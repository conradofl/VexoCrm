// backend/src/test/dashboardPlan.test.js
//
// Plano de ação do Dashboard gravado no servidor (decisões do dono, 18/11/2026):
//   - só equipe Vexo edita; cliente vê e não edita;
//   - planilha com nome e telefone só para quem acessa a tela Conversas;
//   - cobrança na própria aba: "você combinou X; o número foi de A para B", com A gravado no dia do plano.
//
// Banco: Postgres real em memória (pglite) com a MIGRATION DE PRODUÇÃO (o arquivo .sql do deploy, não uma cópia).
// HTTP: Express de verdade, chamado com fetch. Dublados: o login (token Firebase não dá para verificar em teste), o
// payload do Dashboard (getOrComputeDashboardMetrics, que tem testes próprios; aqui ele só fornece o número) e a fila
// da tela Conversas (measureQueue, idem). A conta de nunca abordados roda de verdade no pglite.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { poolFor, startHttp } from "./helpers/audioLibraryHarness.js";

const MIGRATION = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/20261118230000_create_dashboard_action_plans.sql"),
  "utf8"
);

let pool = null;
let metrics = null;
const metricsCalls = [];
const queueCalls = [];
let queueResult = null;

vi.mock("../services/database.js", () => ({
  get pgDatabasePool() {
    return pool;
  },
}));
vi.mock("../access/middlewares.js", async (importOriginal) => {
  const actual = await importOriginal();
  const { fakeFirebaseAuth } = await import("./helpers/audioLibraryHarness.js");
  return { ...actual, requireFirebaseAuth: fakeFirebaseAuth };
});
vi.mock("../services/dashboardCalculations.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getOrComputeDashboardMetrics: async (...args) => {
    metricsCalls.push(args);
    if (metrics instanceof Error) throw metrics;
    return metrics;
  },
}));
vi.mock("../services/dashboardOverview.js", async (importOriginal) => ({
  ...(await importOriginal()),
  measureQueue: async (...args) => {
    queueCalls.push(args);
    return queueResult;
  },
}));

const { registerDashboardPlanRoutes } = await import("../domains/insights/dashboardPlanRoutes.js");
const { measureBaseSlices } = await import("../services/dashboardOverview.js");
const plan = await import("../services/dashboardPlan.js");

const A = "plano-teste-a";
const B = "plano-teste-b";
const WHO = {
  vexoComConversas: { role: "internal", isAdmin: false, scopeMode: "assigned_clients", clientIds: [A], internalPages: ["dashboard", "whatsapp"] },
  vexoSemConversas: { role: "internal", isAdmin: false, scopeMode: "assigned_clients", clientIds: [A], internalPages: ["dashboard"] },
  admin: { role: "internal", isAdmin: true, scopeMode: "all_clients", clientIds: [], internalPages: [] },
  clienteComConversas: { role: "client", isAdmin: false, scopeMode: "assigned_clients", clientId: A, clientIds: [A], allowedViews: ["dashboard", "whatsapp"] },
  clienteSemConversas: { role: "client", isAdmin: false, scopeMode: "assigned_clients", clientId: A, clientIds: [A], allowedViews: ["dashboard"] },
  semDashboard: { role: "internal", isAdmin: false, scopeMode: "assigned_clients", clientIds: [A], internalPages: ["whatsapp"] },
};

function payload({ waiting = 36, never = 80033, chipPct = 82, campaignRate = 4.2, chipsToday = true } = {}) {
  return {
    overview: {
      waiting: { status: "ready", waiting, waitingOverThreshold: waiting, thresholdHours: 3 },
      base: { neverApproached: { reachable: never } },
      chipsQuotaIsToday: chipsToday,
      chips: [{ name: "Comercial", quotaLimit: 100, sentToday: chipPct, quotaPercentage: chipPct }],
      campaigns: [
        { campaign_name: "Black Friday", reply_rate: 20 },
        { campaign_name: "Reativação", reply_rate: campaignRate },
      ],
    },
    rankings: { messages: null },
  };
}

const ITEMS = [
  { key: "waiting", checked: true, owner: "Caio", due: "sexta", action: "Responder as 36 conversas que esperam", why: "36 esperando.", metric: "pessoas esperando resposta = 0" },
  { key: "neverApproached", checked: true, owner: "", due: "", action: "Campanha de primeiro contato", why: "80.033 contatos.", metric: "nunca abordados abaixo de 80.033" },
  { key: "weakCampaign", subject: "Reativação", checked: false, owner: "", due: "", action: "Reescrever Reativação", why: "4,2 contra 20.", metric: "acima de 4,2" },
];

const SCHEMA_BASE = `
  CREATE TABLE leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL,
    telefone text NOT NULL,
    phone text,
    nome text,
    stage text DEFAULT 'cold',
    dados jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata jsonb,
    opt_out boolean,
    assigned_to text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE lead_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL,
    phone text NOT NULL,
    direction text NOT NULL,
    engagement_signal text,
    is_group boolean,
    message_timestamp timestamptz,
    delivered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE campaign_dispatch_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL,
    phone text NOT NULL,
    status text NOT NULL DEFAULT 'sent',
    sent_at timestamptz
  );
  CREATE TABLE lead_optouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text, phone text);
`;

describe("Plano de ação — regras puras", () => {
  it("a semana é a segunda-feira no fuso de São Paulo (domingo 23:30 ainda é a semana anterior)", () => {
    expect(plan.weekStartFor(new Date("2026-11-16T02:30:00Z"))).toBe("2026-11-09"); // domingo 15/11 23:30 em SP
    expect(plan.weekStartFor(new Date("2026-11-16T03:30:00Z"))).toBe("2026-11-16"); // segunda 16/11 00:30 em SP
    expect(plan.weekStartFor(new Date("2026-11-18T15:00:00Z"))).toBe("2026-11-16");
  });

  it("o número de cada achado sai do payload do Dashboard; sem número, null (nunca zero inventado)", () => {
    const m = payload();
    expect(plan.findingValue(m, "waiting")).toEqual({ value: 36, unit: "pessoas esperando resposta" });
    expect(plan.findingValue(m, "neverApproached")).toEqual({ value: 80033, unit: "contatos nunca abordados" });
    expect(plan.findingValue(m, "chipQuota", "Comercial")).toEqual({ value: 82, unit: "% da cota de hoje" });
    expect(plan.findingValue(m, "weakCampaign", "Reativação")).toEqual({ value: 4.2, unit: "respostas a cada 100" });
    // zero medido é número
    expect(plan.findingValue(payload({ waiting: 0 }), "waiting")).toEqual({ value: 0, unit: "pessoas esperando resposta" });
    // sem fonte: null
    expect(plan.findingValue({ overview: { waiting: { status: "pending_source" } } }, "waiting")).toBeNull();
    expect(plan.findingValue(payload({ chipsToday: false }), "chipQuota", "Comercial")).toBeNull();
    expect(plan.findingValue(m, "weakCampaign", "Campanha que saiu do período")).toBeNull();
    expect(plan.findingValue(null, "waiting")).toBeNull();
  });

  it("valida o que vem da tela", () => {
    expect(() => plan.normalizePlanItems("x")).toThrow(/lista/);
    expect(() => plan.normalizePlanItems([{ key: "inventado", action: "x" }])).toThrow(/desconhecido/);
    expect(() => plan.normalizePlanItems([{ key: "chipQuota", action: "x" }])).toThrow(/subject/);
    expect(() => plan.normalizePlanItems([{ key: "waiting", action: "x", owner: "a".repeat(61) }])).toThrow(/60/);
    expect(() => plan.normalizePlanItems([{ key: "waiting", action: "x" }, { key: "waiting", action: "y" }])).toThrow(/repetido/);
    expect(() => plan.normalizePlanItems(Array.from({ length: 13 }, (_, i) => ({ key: "weakCampaign", subject: `c${i}`, action: "x" })))).toThrow(/12/);
    const [item] = plan.normalizePlanItems([{ key: "waiting", action: " Responder ", owner: " Caio ", baseline: { value: 1 }, checked: "sim" }]);
    expect(item).toEqual({ key: "waiting", subject: null, checked: false, owner: "Caio", due: "", action: "Responder", why: "", metric: "" });
  });

  it("planilha: abre no Excel em português e nome de contato não vira fórmula", () => {
    const csv = plan.buildCsv(["Nome", "Telefone"], [["=HYPERLINK(\"x\")", "5534991110001"], ["Ana; \"Bia\"", "5534991110002"]]);
    expect(csv.startsWith("﻿Nome;Telefone\r\n")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")";5534991110001`);
    expect(csv).toContain(`"Ana; ""Bia""";5534991110002`);
  });
});

describe("Plano de ação — rotas, banco real", () => {
  let db;
  let http;
  const call = (method, path, access, body) => http.call(method, path, { access, body });
  const get = (access, query = `clientId=${A}`) => call("GET", `/api/dashboard/plan?${query}`, access);
  const put = (access, items = ITEMS, clientId = A) => call("PUT", "/api/dashboard/plan", access, { clientId, period: "30d", items });
  const exportList = (access, list) => call("GET", `/api/dashboard/plan/export?clientId=${A}&list=${list}`, access);

  beforeAll(async () => {
    db = await createPgliteDb(SCHEMA_BASE);
    await db.exec(MIGRATION);
    pool = poolFor(db);
    http = await startHttp((app) => registerDashboardPlanRoutes(app));
  });
  afterAll(async () => {
    await http?.close();
    await db?.close();
  });
  beforeEach(async () => {
    pool = poolFor(db);
    metrics = payload();
    metricsCalls.length = 0;
    queueCalls.length = 0;
    await db.exec("DELETE FROM dashboard_action_plans; DELETE FROM leads; DELETE FROM lead_messages; DELETE FROM campaign_dispatch_runs; DELETE FROM lead_optouts;");
  });

  it("[TESTE OBRIGATÓRIO] equipe Vexo grava; o número do dia é medido pelo servidor e nunca é reescrito", async () => {
    // A tela tenta mandar um número: é ignorado.
    const first = await put(WHO.vexoComConversas, ITEMS.map((i) => ({ ...i, baseline: { value: 9999, unit: "x" } })));
    expect(first.status).toBe(200);
    const byKey = Object.fromEntries(first.body.plan.items.map((i) => [i.key, i]));
    expect(byKey.waiting.baseline).toEqual({ value: 36, unit: "pessoas esperando resposta" });
    expect(byKey.neverApproached.baseline.value).toBe(80033);
    expect(byKey.weakCampaign.baseline.value).toBe(4.2);
    expect(metricsCalls.at(-1)[1]).toBe(A);

    // Dois dias depois a fila caiu para 10 e o dono mudou: a baseline continua 36.
    metrics = payload({ waiting: 10 });
    const second = await put(WHO.vexoComConversas, [{ ...ITEMS[0], owner: "Priscila" }]);
    expect(second.status).toBe(200);
    const again = Object.fromEntries(second.body.plan.items.map((i) => [i.key, i]));
    expect(again.waiting.owner).toBe("Priscila");
    expect(again.waiting.baseline.value).toBe(36);
    expect(again.waiting.baselineAt).toBe(byKey.waiting.baselineAt);
    // Itens que a tela não mandou (o achado sumiu) continuam no plano.
    expect(Object.keys(again).sort()).toEqual(["neverApproached", "waiting", "weakCampaign"]);

    const read = await get(WHO.clienteSemConversas);
    expect(read.status).toBe(200);
    expect(read.body.current.items).toHaveLength(3);
    expect(read.body.weekStart).toBe(plan.weekStartFor(new Date()));
  });

  it("[TESTE OBRIGATÓRIO] cliente vê o plano e não edita: PUT recusado, nada gravado", async () => {
    await put(WHO.vexoComConversas);
    const before = await db.query("SELECT items::text AS items, updated_at FROM dashboard_action_plans");

    for (const who of [WHO.clienteComConversas, WHO.clienteSemConversas]) {
      const res = await put(who, [{ ...ITEMS[0], owner: "Cliente mudou" }]);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("PLAN_READ_ONLY");
      const read = await get(who);
      expect(read.status).toBe(200);
      expect(read.body.canEdit).toBe(false);
      expect(read.body.current.items.find((i) => i.key === "waiting").owner).toBe("Caio");
    }
    const after = await db.query("SELECT items::text AS items, updated_at FROM dashboard_action_plans");
    expect(after.rows).toEqual(before.rows);
    expect((await get(WHO.vexoSemConversas)).body.canEdit).toBe(true);
  });

  it("sem acesso ao Dashboard ou a outra empresa: recusado", async () => {
    expect((await get(WHO.semDashboard)).status).toBe(403);
    expect((await put(WHO.semDashboard)).status).toBe(403);
    expect((await get(WHO.vexoComConversas, `clientId=${B}`)).status).toBe(403);
    expect((await put(WHO.vexoComConversas, ITEMS, B)).status).toBe(403);
    expect((await db.query("SELECT count(*)::int AS n FROM dashboard_action_plans")).rows[0].n).toBe(0);
  });

  it("[TESTE OBRIGATÓRIO] cobrança: o plano da semana anterior volta com o número do dia e o de hoje, só o que foi marcado", async () => {
    const thisWeek = plan.weekStartFor(new Date());
    const lastWeek = new Date(Date.parse(`${thisWeek}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
    const twoWeeks = new Date(Date.parse(`${thisWeek}T00:00:00Z`) - 14 * 86400000).toISOString().slice(0, 10);
    const stored = [
      { ...ITEMS[0], subject: null, baseline: { value: 36, unit: "pessoas esperando resposta" }, baselineAt: "2026-11-10T12:00:00.000Z" },
      { ...ITEMS[2], baseline: { value: 4.2, unit: "respostas a cada 100" }, baselineAt: "2026-11-10T12:00:00.000Z" },
    ];
    await db.query(
      "INSERT INTO dashboard_action_plans (client_id, week_start, items, created_by, updated_by) VALUES ($1, $2, $3, 'u', 'u'), ($1, $4, '[]', 'u', 'u'), ($5, $2, $3, 'u', 'u')",
      [A, lastWeek, JSON.stringify(stored), twoWeeks, B]
    );
    metrics = payload({ waiting: 4 });

    const res = await get(WHO.clienteSemConversas, `clientId=${A}&period=7d`);
    expect(res.status).toBe(200);
    expect(res.body.current).toBeNull();
    expect(res.body.previous.weekStart).toBe(lastWeek); // o mais recente antes desta semana
    expect(res.body.previous.items).toHaveLength(1); // só o marcado
    expect(res.body.previous.items[0]).toMatchObject({
      key: "waiting",
      action: "Responder as 36 conversas que esperam",
      owner: "Caio",
      baseline: { value: 36 },
      current: { value: 4, unit: "pessoas esperando resposta" },
    });
    // o número de hoje sai do mesmo período que a tela olha
    expect(metricsCalls.at(-1).slice(1, 3)).toEqual([A, "7d"]);
  });

  it("cobrança com o número de hoje indisponível: o plano aparece, o número de hoje sai null", async () => {
    const thisWeek = plan.weekStartFor(new Date());
    const lastWeek = new Date(Date.parse(`${thisWeek}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
    await db.query("INSERT INTO dashboard_action_plans (client_id, week_start, items, created_by, updated_by) VALUES ($1, $2, $3, 'u', 'u')", [
      A,
      lastWeek,
      JSON.stringify([{ ...ITEMS[0], subject: null, baseline: { value: 36, unit: "x" }, baselineAt: null }]),
    ]);
    metrics = new Error("timeout");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await get(WHO.vexoComConversas);
      expect(res.status).toBe(200);
      expect(res.body.previous.items[0].current).toBeNull();
      expect(res.body.previous.items[0].baseline.value).toBe(36);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("[TESTE OBRIGATÓRIO] planilha só para quem acessa a tela Conversas", async () => {
    queueResult = { oldest: [{ name: "Jéssica", phone: "5534991110001", chip: "Comercial", waitingSince: "2026-11-18T11:00:00.000Z" }] };
    for (const who of [WHO.vexoSemConversas, WHO.clienteSemConversas]) {
      for (const list of ["waiting", "neverApproached"]) {
        const res = await exportList(who, list);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("PLAN_EXPORT_FORBIDDEN");
        expect(res.text).not.toContain("5534991110001");
      }
    }
    expect(queueCalls).toHaveLength(0);
    expect((await get(WHO.vexoSemConversas)).body.canExport).toBe(false);
    expect((await get(WHO.clienteComConversas)).body.canExport).toBe(true);

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const res = await http.call("GET", `/api/dashboard/plan/export?clientId=${A}&list=waiting`, { access: WHO.clienteComConversas, raw: true });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^text\/csv/);
      expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="plano-esperando-resposta-\d{4}-\d{2}-\d{2}\.csv"$/);
      // BOM em bytes (o Excel precisa dele para ler acento); fetch.text() o removeria ao decodificar.
      expect([...res.buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(res.buffer.subarray(3).toString("utf8")).toBe("Nome;Telefone;Chip;Esperando desde\r\nJéssica;5534991110001;Comercial;18/11/2026, 08:00\r\n");
      // a fila inteira, não as cinco da tela
      expect(queueCalls[0][1]).toMatchObject({ clientId: A, oldestLimit: plan.PLAN_EXPORT_WAITING_LIMIT });
      // o registro diz quem e quantas linhas, sem nome nem telefone
      expect(infoSpy.mock.calls.flat().join(" ")).not.toMatch(/Jéssica|5534991110001/);
    } finally {
      infoSpy.mockRestore();
    }
    expect((await exportList(WHO.vexoComConversas, "chipQuota")).status).toBe(400);
  });

  it("[TESTE OBRIGATÓRIO] planilha de nunca abordados: as linhas são exatamente o número do cartão", async () => {
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, created_at) VALUES
        ('${A}', '5534991110001', 'Ana',        'cold',       now() - interval '5 days'), -- entra
        ('${A}', '5534991110002', 'Bruno',      'open_budget', now() - interval '5 days'), -- entra
        ('${A}', '5534991110002', 'Bruno dup',  'cold',       now() - interval '5 days'), -- mesmo telefone: uma linha
        ('${A}', '5534991110003', NULL,         'cold',       now() - interval '5 days'), -- entra, sem nome
        ('${A}', '5534991110004', 'Pediu sair', 'cold',       now() - interval '5 days'),
        ('${A}', '5534991110005', 'Na tabela',  'cold',       now() - interval '5 days'),
        ('${A}', '5534991110006', 'Recebeu',    'cold',       now() - interval '5 days'),
        ('${A}', '5534991110007', 'Campanha',   'cold',       now() - interval '5 days'),
        ('${A}', '5534991110008', 'Escreveu',   'cold',       now() - interval '5 days'),
        ('${A}', '5534991110009', 'Encerrado',  'descartado', now() - interval '5 days'),
        ('${A}', '123',           'Inválido',   'cold',       now() - interval '5 days'),
        ('${B}', '5534991110010', 'Outra',      'cold',       now() - interval '5 days');
      UPDATE leads SET opt_out = true WHERE telefone = '5534991110004';
      INSERT INTO lead_optouts (client_id, phone) VALUES ('${A}', '5534991110005');
      INSERT INTO lead_messages (client_id, phone, direction, message_timestamp) VALUES
        ('${A}', '5534991110006', 'outbound', now() - interval '2 days'),
        ('${A}', '5534991110008@s.whatsapp.net', 'inbound', now() - interval '2 days');
      INSERT INTO campaign_dispatch_runs (client_id, phone, status, sent_at) VALUES ('${A}', '34991110007', 'sent', now() - interval '2 days');
    `);
    const card = await measureBaseSlices(pool, { clientId: A, asOf: new Date() });
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const res = await exportList(WHO.vexoComConversas, "neverApproached");
      expect(res.status).toBe(200);
      const lines = res.text.replace(/^﻿/, "").trim().split("\r\n");
      expect(lines[0]).toBe("Nome;Telefone");
      expect(lines.length - 1).toBe(card.neverApproached.reachable);
      expect(lines.slice(1)).toEqual(["Ana;5534991110001", "Bruno;5534991110002", ";5534991110003"]);
    } finally {
      infoSpy.mockRestore();
    }
  });
});

describe("Plano de ação — matriz código × schema", () => {
  it("[TESTE OBRIGATÓRIO] código novo com schema velho (sem a tabela): a aba diz que não dá para salvar, sem 500", async () => {
    const old = await createPgliteDb(SCHEMA_BASE);
    pool = poolFor(old);
    metrics = payload();
    const http = await startHttp((app) => registerDashboardPlanRoutes(app));
    try {
      const read = await http.call("GET", `/api/dashboard/plan?clientId=${A}`, { access: WHO.vexoComConversas });
      expect(read.status).toBe(503);
      expect(read.body.error.code).toBe("PLAN_STORAGE_UNAVAILABLE");
      const write = await http.call("PUT", "/api/dashboard/plan", { access: WHO.vexoComConversas, body: { clientId: A, items: ITEMS } });
      expect(write.status).toBe(503);
      expect(write.body.error.code).toBe("PLAN_STORAGE_UNAVAILABLE");
      // a planilha não depende da tabela nova
      queueResult = { oldest: [] };
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      expect((await http.call("GET", `/api/dashboard/plan/export?clientId=${A}&list=waiting`, { access: WHO.vexoComConversas })).status).toBe(200);
      infoSpy.mockRestore();
    } finally {
      await http.close();
      await old.close();
    }
  });

  it("migration idempotente e aditiva: roda duas vezes; semana que não é segunda é recusada pelo banco", async () => {
    const fresh = await createPgliteDb(SCHEMA_BASE);
    try {
      await fresh.exec(MIGRATION);
      await fresh.exec(MIGRATION);
      // o que já existia continua igual (código antigo lê a base como antes)
      const cols = await fresh.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'leads'");
      expect(cols.rows[0].n).toBe(11);
      await expect(
        fresh.query("INSERT INTO dashboard_action_plans (client_id, week_start, created_by, updated_by) VALUES ('x', '2026-11-18', 'u', 'u')")
      ).rejects.toThrow(/week_is_monday/);
      await expect(
        fresh.query("INSERT INTO dashboard_action_plans (client_id, week_start, items, created_by, updated_by) VALUES ('x', '2026-11-16', '{}', 'u', 'u')")
      ).rejects.toThrow(/items_array/);
    } finally {
      await fresh.close();
    }
  });
});
