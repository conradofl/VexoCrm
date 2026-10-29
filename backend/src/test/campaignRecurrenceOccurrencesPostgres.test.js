// backend/src/test/campaignRecurrenceOccurrencesPostgres.test.js
//
// Campanha recorrente pelo caminho da fila — Bloco 3, primeira parte: o passo que cria as ocorrências e a trava por
// campanha no agendador.
//
// Postgres REAL (pglite) com as migrations DO PRODUTO (20261008180000 e 20261012120000) aplicadas sobre um schema
// base, e a mesma camada supabase→pg da produção (pgSupabaseCompat). O público vem do buildDispatchLeads real.
// Limites do pglite (helpers/pgliteDb.js): conexão única — "concorrência" aqui é intercalação de awaits entre duas
// chamadas, não duas conexões. A garantia entre conexões é o índice único parcial, testado direto.

import express from "express";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { buildDispatchLeads } from "../campaign/dispatch.js";
import { materializeDueRecurringOccurrences } from "../services/campaignRecurrenceOccurrences.js";
import { normalizeCampaignAnalyticsMeta, validateCampaignAnalyticsMeta } from "../campaign-outbound.js";

const SLOW = 120_000;
const T = "tenant-condominio";
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");

const BASE_SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE public.leads_clients (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
    nome TEXT, telefone TEXT, tipo_cliente TEXT, faixa_consumo TEXT, qualificacao TEXT, cidade TEXT, estado TEXT, status TEXT,
    opt_out BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb,
    dados JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.lead_import_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id UUID NOT NULL,
    client_id TEXT NOT NULL,
    lead_id UUID,
    telefone TEXT,
    imported BOOLEAN NOT NULL DEFAULT true,
    normalized_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    status_conversa TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    import_id UUID,
    limit_per_run INT,
    webhook_url TEXT,
    webhook_token TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    scheduled_for TIMESTAMPTZ,
    last_triggered_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT now(),
    analytics_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    campaign_prompt_id UUID,
    mode TEXT,
    created_by_uid TEXT,
    created_by_email TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    chatbot_prompt_type TEXT NOT NULL DEFAULT 'campanha',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.campaign_dispatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual', 'scheduled', 'auto_resume', 'draft')),
    scheduled_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'done', 'failed', 'cancelled', 'interrupted')),
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    triggered_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error_message TEXT,
    limit_per_run INTEGER,
    "offset" INTEGER,
    campaign_prompt_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.campaign_dispatch_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatch_id UUID NOT NULL REFERENCES public.campaign_dispatches(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    phone TEXT NOT NULL,
    lead_id UUID, -- em produção nasce pelo ensureDispatchRunsClaimSchema
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

const SEQUENCIA = [{ id: "s1", type: "text", text: "Olá {{nome}}, a assembleia é dia 20.", order: 1, enabled: true, delayAfterSeconds: 0 }];

const openDbs = [];
async function banco() {
  const db = await createPgliteDb(BASE_SCHEMA);
  openDbs.push(db);
  for (const file of ["20261008180000_add_recurrence_to_campaigns.sql", "20261012120000_campaign_recurrence_occurrences.sql"]) {
    await db.exec(await readFile(join(MIGRATIONS, file), "utf8"));
  }
  await db.query("INSERT INTO leads_clients (id, name) VALUES ($1, 'Condomínio')", [T]);
  const pool = { query: (sql, params) => db.query(sql, params) };
  _setPgDatabasePoolForTesting(pool);
  return { db, pool };
}
afterAll(async () => {
  _setPgDatabasePoolForTesting(null);
  for (const db of openDbs) await db.close();
});

async function inserirLeads(db, n, prefixo = "5511990") {
  for (let i = 0; i < n; i += 1) {
    await db.query("INSERT INTO leads (client_id, nome, telefone) VALUES ($1, $2, $3)", [T, `Cotista ${prefixo}-${i}`, `${prefixo}${String(10000 + i)}`]);
  }
}

async function campanhaRecorrente(db, over = {}) {
  const c = {
    name: "Aviso de assembleia",
    pattern: "monthly",
    dayOfMonth: 15,
    dayOfWeek: null,
    time: "09:00",
    nextRunAt: "2026-11-15T12:00:00.000Z", // 15/11 09:00 em São Paulo
    endType: "never",
    endsAt: null,
    maxOccurrences: null,
    limitPerRun: null,
    ...over,
  };
  const { rows } = await db.query(
    `INSERT INTO campaigns (client_id, name, status, limit_per_run, analytics_meta, is_recurring, recurrence_pattern,
       recurrence_day_of_month, recurrence_day_of_week, recurrence_time, next_run_at, recurrence_end_type,
       recurrence_ends_at, recurrence_max_occurrences)
     VALUES ($1, $2, 'active', $3, $4::jsonb, true, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [T, c.name, c.limitPerRun, JSON.stringify({ importSource: "__crm__", sequence: SEQUENCIA }), c.pattern, c.dayOfMonth,
      c.dayOfWeek, c.time, c.nextRunAt, c.endType, c.endsAt, c.maxOccurrences]
  );
  return rows[0].id;
}

// Mesmos ingredientes que o agendador passa (routes.js → materializeRecurringOccurrences), com o buildDispatchLeads REAL.
function deps(pool, timezone = "America/Sao_Paulo") {
  return {
    pool,
    resolveTimezone: async () => timezone,
    buildSteps: (campaign) => {
      const v = validateCampaignAnalyticsMeta(normalizeCampaignAnalyticsMeta(campaign.analytics_meta || {}));
      return v.valid ? { steps: v.analyticsMeta.sequence } : { error: v.message };
    },
    // igual ao do produto: recorrente não tem limite por envio
    countAudience: async (campaign) => {
      const all = await buildDispatchLeads({ clientId: campaign.client_id, importId: "__crm__" });
      return { total: all.length, toSend: all.length, limitPerRun: null };
    },
  };
}

const ocorrencias = async (db, campaignId) =>
  (await db.query("SELECT outcome, reason, dispatch_id, audience_count, occurrence_at FROM campaign_recurrence_occurrences WHERE campaign_id = $1 ORDER BY occurrence_at", [campaignId])).rows;
const lotes = async (db, campaignId) =>
  (await db.query("SELECT id, status, target_count, recurrence_occurrence_at, name, scheduled_at FROM campaign_dispatches WHERE campaign_id = $1 ORDER BY created_at", [campaignId])).rows;
const campanha = async (db, id) => (await db.query("SELECT * FROM campaigns WHERE id = $1", [id])).rows[0];
const iso = (d) => (d ? new Date(d).toISOString() : null);

describe("ocorrência vencida vira lote novo na fila", () => {
  it("cria um lote 'scheduled' marcado como ocorrência, registra 'created' com o público do dia e avança o próximo envio", async () => {
    const { db, pool } = await banco();
    await inserirLeads(db, 3);
    const id = await campanhaRecorrente(db);

    const r = await materializeDueRecurringOccurrences({ ...deps(pool), now: new Date("2026-11-15T12:00:10.000Z") });

    expect(r.items.map((i) => i.status)).toEqual(["created"]);
    const [lote] = await lotes(db, id);
    expect(lote.status).toBe("scheduled");
    expect(iso(lote.recurrence_occurrence_at)).toBe("2026-11-15T12:00:00.000Z");
    expect(lote.target_count).toBe(3);
    expect(lote.name).toBe("Envio recorrente — 15/11 às 09:00");
    const [occ] = await ocorrencias(db, id);
    expect(occ).toMatchObject({ outcome: "created", reason: null, dispatch_id: lote.id, audience_count: 3 });
    const c = await campanha(db, id);
    expect(iso(c.next_run_at)).toBe("2026-12-15T12:00:00.000Z");
    expect(c.recurrence_occurrences_count).toBe(1);
  }, SLOW);

  it("recorrente antiga, sem fim declarado (criada antes deste bloco), NÃO dispara no deploy", async () => {
    const { db, pool } = await banco();
    const id = await campanhaRecorrente(db, { endType: null, nextRunAt: "2026-10-15T12:00:00Z" });

    const r = await materializeDueRecurringOccurrences({ ...deps(pool), now: new Date("2026-11-15T12:00:10Z") });

    expect(r.items).toHaveLength(0);
    expect(await lotes(db, id)).toHaveLength(0);
    expect(iso((await campanha(db, id)).next_run_at)).toBe("2026-10-15T12:00:00.000Z"); // intocada
  }, SLOW);

  it("ocorrência ainda não vencida não cria nada", async () => {
    const { db, pool } = await banco();
    const id = await campanhaRecorrente(db);

    await materializeDueRecurringOccurrences({ ...deps(pool), now: new Date("2026-11-15T11:59:00.000Z") });

    expect(await lotes(db, id)).toHaveLength(0);
    expect(await ocorrencias(db, id)).toHaveLength(0);
  }, SLOW);

  it("dois ticks concorrentes no mesmo horário criam UM lote só", async () => {
    const { db, pool } = await banco();
    await inserirLeads(db, 2);
    const id = await campanhaRecorrente(db);
    const now = new Date("2026-11-15T12:00:10.000Z");

    const [a, b] = await Promise.all([
      materializeDueRecurringOccurrences({ ...deps(pool), now }),
      materializeDueRecurringOccurrences({ ...deps(pool), now }),
    ]);

    expect([...a.items, ...b.items].map((i) => i.status).sort()).toEqual(["already_claimed", "created"]);
    expect(await lotes(db, id)).toHaveLength(1);
    expect(await ocorrencias(db, id)).toHaveLength(1);
  }, SLOW);
});

describe("[OBRIGATÓRIO] nunca empilhar: ocorrência que vence com a anterior em andamento é pulada, com motivo", () => {
  for (const status of ["running", "paused"]) {
    it(`lote anterior '${status}' → ocorrência pulada, motivo registrado, nenhum lote novo, próximo envio avança`, async () => {
      const { db, pool } = await banco();
      await inserirLeads(db, 2);
      const id = await campanhaRecorrente(db);
      await db.query(
        "INSERT INTO campaign_dispatches (campaign_id, client_id, name, status, recurrence_occurrence_at) VALUES ($1, $2, 'Envio recorrente — 15/10 às 09:00', $3, '2026-10-15T12:00:00Z')",
        [id, T, status]
      );

      const r = await materializeDueRecurringOccurrences({ ...deps(pool), now: new Date("2026-11-15T12:00:10.000Z") });

      expect(r.items[0].status).toBe("skipped");
      const occ = await ocorrencias(db, id);
      expect(occ).toHaveLength(1);
      expect(occ[0].outcome).toBe("skipped");
      expect(occ[0].dispatch_id).toBeNull();
      expect(occ[0].reason).toContain("Pulado: o envio \"Envio recorrente — 15/10 às 09:00\" ainda estava");
      expect(occ[0].reason).toContain("mensagem dobrada");
      expect(await lotes(db, id)).toHaveLength(1); // só o anterior
      const c = await campanha(db, id);
      expect(iso(c.next_run_at)).toBe("2026-12-15T12:00:00.000Z");
      expect(c.recurrence_occurrences_count).toBe(0); // pulada não conta
    }, SLOW);
  }

  it("lote anterior já terminado ('done') não impede", async () => {
    const { db, pool } = await banco();
    const id = await campanhaRecorrente(db);
    await db.query("INSERT INTO campaign_dispatches (campaign_id, client_id, status, recurrence_occurrence_at) VALUES ($1, $2, 'done', '2026-10-15T12:00:00Z')", [id, T]);

    const r = await materializeDueRecurringOccurrences({ ...deps(pool), now: new Date("2026-11-15T12:00:10.000Z") });

    expect(r.items[0].status).toBe("created");
  }, SLOW);

  it("lote manual agendado para DEPOIS da ocorrência não impede (ainda não começou)", async () => {
    const { db, pool } = await banco();
    const id = await campanhaRecorrente(db);
    await db.query("INSERT INTO campaign_dispatches (campaign_id, client_id, status, scheduled_at) VALUES ($1, $2, 'scheduled', '2026-11-20T12:00:00Z')", [id, T]);

    const r = await materializeDueRecurringOccurrences({ ...deps(pool), now: new Date("2026-11-15T12:00:10.000Z") });

    expect(r.items[0].status).toBe("created");
  }, SLOW);
});

describe("fim declarado para de verdade", () => {
  it("fim por contagem (2): cria 2 e para; next_run_at fica NULL e a 3ª chamada não cria nada", async () => {
    const { db, pool } = await banco();
    const id = await campanhaRecorrente(db, { endType: "count", maxOccurrences: 2 });
    const tick = (at) => materializeDueRecurringOccurrences({ ...deps(pool), now: new Date(at) });

    await tick("2026-11-15T12:00:10Z");
    await db.query("UPDATE campaign_dispatches SET status = 'done' WHERE campaign_id = $1", [id]);
    await tick("2026-12-15T12:00:10Z");
    // logo após a última: nada de "Próximo envio: 15/01" na tela para um envio que não vai existir
    expect((await campanha(db, id)).next_run_at).toBeNull();
    await db.query("UPDATE campaign_dispatches SET status = 'done' WHERE campaign_id = $1", [id]);
    await tick("2027-01-15T12:00:10Z");

    expect(await lotes(db, id)).toHaveLength(2);
    const c = await campanha(db, id);
    expect(c.next_run_at).toBeNull();
    expect(c.recurrence_ended_at).not.toBeNull();
    expect(c.recurrence_occurrences_count).toBe(2);
  }, SLOW);

  it("fim por contagem não conta ocorrência pulada: 2 criadas mesmo com uma pulada no meio", async () => {
    const { db, pool } = await banco();
    const id = await campanhaRecorrente(db, { endType: "count", maxOccurrences: 2 });
    const tick = (at) => materializeDueRecurringOccurrences({ ...deps(pool), now: new Date(at) });

    await tick("2026-11-15T12:00:10Z"); // criada; fica 'scheduled' → a de dezembro é pulada
    await db.query("UPDATE campaign_dispatches SET status = 'running' WHERE campaign_id = $1", [id]);
    await tick("2026-12-15T12:00:10Z"); // pulada
    await db.query("UPDATE campaign_dispatches SET status = 'done' WHERE campaign_id = $1", [id]);
    await tick("2027-01-15T12:00:10Z"); // criada, 2ª → fim

    expect((await ocorrencias(db, id)).map((o) => o.outcome)).toEqual(["created", "skipped", "created"]);
    expect((await campanha(db, id)).next_run_at).toBeNull();
  }, SLOW);

  it("fim por data: a ocorrência depois da data não acontece", async () => {
    const { db, pool } = await banco();
    const id = await campanhaRecorrente(db, { endType: "until_date", endsAt: "2026-12-31T23:59:59-03:00" });
    const tick = (at) => materializeDueRecurringOccurrences({ ...deps(pool), now: new Date(at) });

    await tick("2026-11-15T12:00:10Z");
    await db.query("UPDATE campaign_dispatches SET status = 'done' WHERE campaign_id = $1", [id]);
    await tick("2026-12-15T12:00:10Z"); // última: a próxima (15/01) passa da data → encerra aqui
    expect((await campanha(db, id)).next_run_at).toBeNull(); // já encerrada, sem prometer 15/01
    await tick("2027-01-15T12:00:10Z");

    expect(await lotes(db, id)).toHaveLength(2);
    const c = await campanha(db, id);
    expect(c.next_run_at).toBeNull();
    expect(c.recurrence_ended_at).not.toBeNull();
  }, SLOW);
});

describe("fim já alcançado antes da ocorrência", () => {
  it("o dono puxou a data de fim para antes do próximo envio: encerra sem criar lote nem registro", async () => {
    const { db, pool } = await banco();
    const id = await campanhaRecorrente(db, { endType: "until_date", endsAt: "2026-11-10T23:59:59-03:00" });

    const r = await materializeDueRecurringOccurrences({ ...deps(pool), now: new Date("2026-11-15T12:00:10Z") });

    expect(r.items[0].status).toBe("ended");
    expect(await lotes(db, id)).toHaveLength(0);
    const c = await campanha(db, id);
    expect(c.next_run_at).toBeNull();
    expect(c.recurrence_ended_at).not.toBeNull();
  }, SLOW);
});

describe("calendário e fuso", () => {
  it("mensal no dia 31: novembro cai no último dia (30) e dezembro volta ao 31", async () => {
    const { db, pool } = await banco();
    const id = await campanhaRecorrente(db, { dayOfMonth: 31, nextRunAt: "2026-10-31T12:00:00Z" });
    const tick = (at) => materializeDueRecurringOccurrences({ ...deps(pool), now: new Date(at) });

    await tick("2026-10-31T12:00:10Z");
    expect(iso((await campanha(db, id)).next_run_at)).toBe("2026-11-30T12:00:00.000Z");
    await db.query("UPDATE campaign_dispatches SET status = 'done' WHERE campaign_id = $1", [id]);
    await tick("2026-11-30T12:00:10Z");
    expect(iso((await campanha(db, id)).next_run_at)).toBe("2026-12-31T12:00:00.000Z");
  }, SLOW);

  it("fuso do tenant: 09:00 em Manaus (UTC-4) é 13:00 UTC, não 12:00", async () => {
    const { db, pool } = await banco();
    const id = await campanhaRecorrente(db, { nextRunAt: "2026-11-15T13:00:00Z" });

    await materializeDueRecurringOccurrences({ ...deps(pool, "America/Manaus"), now: new Date("2026-11-15T13:00:10Z") });

    expect(iso((await campanha(db, id)).next_run_at)).toBe("2026-12-15T13:00:00.000Z");
    expect((await lotes(db, id))[0].name).toBe("Envio recorrente — 15/11 às 09:00");
  }, SLOW);

  it("diária: avança um dia, mesmo horário", async () => {
    const { db, pool } = await banco();
    const id = await campanhaRecorrente(db, { pattern: "daily", dayOfMonth: null, nextRunAt: "2026-11-15T12:00:00Z" });

    await materializeDueRecurringOccurrences({ ...deps(pool), now: new Date("2026-11-15T12:00:10Z") });

    expect(iso((await campanha(db, id)).next_run_at)).toBe("2026-11-16T12:00:00.000Z");
  }, SLOW);
});

describe("o público é recalculado a cada ocorrência", () => {
  it("lead que entrou na base entre duas ocorrências aparece na contagem da segunda", async () => {
    const { db, pool } = await banco();
    await inserirLeads(db, 3);
    const id = await campanhaRecorrente(db);
    const tick = (at) => materializeDueRecurringOccurrences({ ...deps(pool), now: new Date(at) });

    await tick("2026-11-15T12:00:10Z");
    await db.query("UPDATE campaign_dispatches SET status = 'done' WHERE campaign_id = $1", [id]);
    await inserirLeads(db, 2, "5521980"); // dois cotistas novos
    await tick("2026-12-15T12:00:10Z");

    expect((await ocorrencias(db, id)).map((o) => o.audience_count)).toEqual([3, 5]);
    expect((await lotes(db, id)).map((l) => l.target_count)).toEqual([3, 5]);
  }, SLOW);

  it("[OBRIGATÓRIO] recorrente ignora limit_per_run: o lote da ocorrência nasce SEM limite e com o público inteiro", async () => {
    const { db, pool } = await banco();
    await inserirLeads(db, 5);
    const id = await campanhaRecorrente(db, { limitPerRun: 2 });

    await materializeDueRecurringOccurrences({ ...deps(pool), now: new Date("2026-11-15T12:00:10Z") });

    const { rows: [lote] } = await db.query("SELECT limit_per_run, target_count FROM campaign_dispatches WHERE campaign_id = $1", [id]);
    expect(lote).toEqual({ limit_per_run: null, target_count: 5 });
  }, SLOW);
});

describe("índice único: a última barreira, no banco", () => {
  it("[OBRIGATÓRIO] duas ocorrências da mesma campanha não ficam 'running' juntas", async () => {
    const { db } = await banco();
    const id = await campanhaRecorrente(db);
    await db.query("INSERT INTO campaign_dispatches (campaign_id, client_id, status, recurrence_occurrence_at) VALUES ($1, $2, 'running', '2026-10-15T12:00:00Z')", [id, T]);
    await db.query("INSERT INTO campaign_dispatches (campaign_id, client_id, status, recurrence_occurrence_at) VALUES ($1, $2, 'scheduled', '2026-11-15T12:00:00Z')", [id, T]);

    await expect(
      db.query("UPDATE campaign_dispatches SET status = 'running' WHERE campaign_id = $1 AND status = 'scheduled'", [id])
    ).rejects.toMatchObject({ code: "23505" });
  }, SLOW);

  it("lotes manuais (não ocorrência) da mesma campanha continuam podendo rodar juntos, como hoje", async () => {
    const { db } = await banco();
    const id = await campanhaRecorrente(db);
    await db.query("INSERT INTO campaign_dispatches (campaign_id, client_id, status) VALUES ($1, $2, 'running'), ($1, $2, 'running')", [id, T]);
    expect((await lotes(db, id)).filter((l) => l.status === "running")).toHaveLength(2);
  }, SLOW);
});

// ── A trava no agendador de verdade (runDueIndependentDispatches) ─────────────────────────────────────────────────
// O runCampaignDispatch entra e fica PRESO em resolveCampaignDispatchSettings (portão controlado pelo teste): é o lote
// "ainda rodando". Um segundo tick concorrente não pode começar outra ocorrência da mesma campanha.

let intervalSpy;
beforeAll(() => {
  intervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(() => ({ unref() {}, ref() {} }));
});
afterAll(() => intervalSpy.mockRestore());

async function agendador(pool, { findConcurrentOverride, app: appReal = null, settings = null, instancias = [], buildLeads = buildDispatchLeads } = {}) {
  const entradas = [];
  let abrir;
  const portao = new Promise((resolve) => { abrir = resolve; });
  if (settings) abrir();
  const supabase = createPgSupabaseClient(pool);

  let registerCampaignsRoutes;
  if (findConcurrentOverride) {
    vi.resetModules();
    vi.doMock("../services/campaignRecurrenceOccurrences.js", async (importOriginal) => ({
      ...(await importOriginal()),
      findConcurrentRunningDispatch: findConcurrentOverride,
    }));
    ({ registerCampaignsRoutes } = await import("../domains/campaigns/routes.js"));
    vi.doUnmock("../services/campaignRecurrenceOccurrences.js");
  } else {
    ({ registerCampaignsRoutes } = await import("../domains/campaigns/routes.js"));
  }

  const noop = () => {};
  const deps = {
    CAMPAIGN_SCHEDULER_MAX_BATCH: 10,
    buildDispatchLeads: buildLeads,
    canCampaignBeDispatched: () => true,
    checkEvolutionInstanceHealth: async () => ({ state: "open" }),
    continueCampaignLeadFromReply: async () => {},
    ensureDb: () => true,
    executeCampaignDispatch: async () => {},
    findCampaignReplyMatches: async () => [],
    getClientName: async () => "Condomínio",
    getLeadClientEvolutionInstances: async () => instancias,
    getLeadClientN8nSettings: async () => ({ send_window_enabled: false }),
    getRequestId: () => "req",
    getSafeDispatchSettingsLog: () => ({}),
    internalErrorPayloadDetails: () => ({}),
    isMissingSchemaError: () => false,
    isProduction: false,
    logCampaignReplyFlow: noop,
    logDirectDispatch: noop,
    maskPhoneForLog: (p) => p,
    normalizeIsoDate: (d) => d,
    leadsTableName: "lead_import_items",
    normalizeString: (s) => String(s || "").trim(),
    normalizeTenantKey: (s) => String(s || "").trim(),
    parseOptionalUuid: (s) => ({ value: s }),
    pgDatabasePool: pool,
    requireAppViewAccess: () => (req, res, next) => next(),
    requireCampaignDispatchAccess: (req, res, next) => next(),
    requireFirebaseAuth: (req, res, next) => next(),
    requireInternalPageAccess: () => (req, res, next) => next(),
    resolveAuthorizedClientId: () => T,
    resolveCampaignDispatchSettings: async (clientId, campaign) => {
      if (settings) return settings; // modo "envia de verdade" (fetch simulado)
      entradas.push(campaign.id);
      await portao; // "rodando" até o teste abrir
      return { webhookUrl: null }; // depois sai com erro de configuração: irrelevante aqui
    },
    resolveDispatchWebhookSettings: async () => ({}),
    runDueCampaignDispatches: async () => {},
    sanitizePhone: (p) => p,
    sendError: (res, status, code, message) => res.status(status).json({ error: { code, message } }),
    supabase,
    validateN8nInboundBearer: () => true,
  };
  const app = appReal || { get: noop, post: noop, put: noop, patch: noop, delete: noop, use: noop };
  const routes = registerCampaignsRoutes(app, deps);
  return { routes, entradas, abrir };
}

const ate = async (cond, ms = 5000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout esperando condição");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("[OBRIGATÓRIO] trava por campanha no agendador: duas ocorrências da mesma campanha nunca rodam ao mesmo tempo", () => {
  // Restauração pontual: vi.restoreAllMocks() desfaria o espião do setInterval e o registro seguinte das rotas armaria
  // o timer real de 30 s do agendador no meio dos testes.
  let logSpy;
  beforeEach(() => { logSpy = vi.spyOn(console, "log").mockImplementation(() => {}); });
  afterEach(() => logSpy.mockRestore());

  async function duasOcorrenciasVencidas(db, { ocorrencia = true } = {}) {
    // campanha recorrente com o próximo envio no futuro: o tick não materializa nada, só dispara os lotes já criados
    const id = await campanhaRecorrente(db, { nextRunAt: "2099-01-01T12:00:00Z" });
    const occ = ocorrencia ? ["2026-10-15T12:00:00Z", "2026-11-15T12:00:00Z"] : [null, null];
    for (const [i, at] of occ.entries()) {
      await db.query(
        `INSERT INTO campaign_dispatches (campaign_id, client_id, name, steps, trigger_type, status, scheduled_at, recurrence_occurrence_at, created_at)
         VALUES ($1, $2, $3, $4::jsonb, 'scheduled', 'scheduled', $5, $6, $7)`,
        [id, T, `Lote ${i + 1}`, JSON.stringify(SEQUENCIA), `2026-10-0${i + 1}T00:00:00Z`, at, `2026-10-0${i + 1}T00:00:00Z`]
      );
    }
    return id;
  }

  it("tick 2 concorrente encontra a ocorrência 1 rodando: NÃO começa a 2 (fica 'scheduled', status blocked_same_campaign)", async () => {
    const { db, pool } = await banco();
    const id = await duasOcorrenciasVencidas(db);
    const w = await agendador(pool);

    const tick1 = w.routes.runDueIndependentDispatches({ limit: 10 });
    await ate(() => w.entradas.length === 1); // ocorrência 1 está rodando
    const r2 = await w.routes.runDueIndependentDispatches({ limit: 10 });

    expect(w.entradas).toHaveLength(1); // a 2 não entrou
    expect(r2.items.map((i) => i.status)).toEqual(["blocked_same_campaign"]);
    const l = await lotes(db, id);
    expect(l.map((x) => x.status)).toEqual(["running", "scheduled"]);
    // barrou na checagem do agendador (que aponta quem está rodando), não só no índice
    expect(r2.items[0].blockingDispatchId).toBe(l[0].id);

    w.abrir();
    await tick1;
  }, SLOW);

  it("se a checagem deixar passar (corrida), o índice único segura: a 2 fica 'scheduled', não 'failed'", async () => {
    const { db, pool } = await banco();
    const id = await duasOcorrenciasVencidas(db);
    const checagem = vi.fn(async () => null);
    const w = await agendador(pool, { findConcurrentOverride: checagem });

    const tick1 = w.routes.runDueIndependentDispatches({ limit: 10 });
    await ate(() => w.entradas.length === 1);
    const r2 = await w.routes.runDueIndependentDispatches({ limit: 10 });

    expect(checagem).toHaveBeenCalled(); // a checagem foi mesmo desligada: quem segurou foi o índice
    expect(w.entradas).toHaveLength(1);
    expect(r2.items.map((i) => i.status)).toEqual(["blocked_same_campaign"]);
    expect(r2.items[0].blockingDispatchId).toBeUndefined();
    expect((await lotes(db, id)).map((x) => x.status)).toEqual(["running", "scheduled"]);

    w.abrir();
    await tick1;
  }, SLOW);

  it("lotes manuais fatiados da mesma campanha seguem rodando em paralelo, como hoje", async () => {
    const { db, pool } = await banco();
    await duasOcorrenciasVencidas(db, { ocorrencia: false });
    const w = await agendador(pool);

    const tick1 = w.routes.runDueIndependentDispatches({ limit: 10 });
    await ate(() => w.entradas.length === 1);
    const tick2 = w.routes.runDueIndependentDispatches({ limit: 10 });
    await ate(() => w.entradas.length === 2);

    expect(w.entradas).toHaveLength(2);
    w.abrir();
    await Promise.all([tick1, tick2]);
  }, SLOW);

  it("o tick materializa a ocorrência vencida e a dispara no mesmo tick", async () => {
    const { db, pool } = await banco();
    await inserirLeads(db, 2);
    const id = await campanhaRecorrente(db, { nextRunAt: new Date(Date.now() - 1000).toISOString() });
    const w = await agendador(pool);

    const tick = w.routes.runDueIndependentDispatches({ limit: 10 });
    await ate(() => w.entradas.length === 1);

    const l = await lotes(db, id);
    expect(l).toHaveLength(1);
    expect(l[0].status).toBe("running");
    expect((await ocorrencias(db, id))[0].outcome).toBe("created");
    w.abrir();
    await tick;
  }, SLOW);

  it("pelo agendador real: o público da 2ª ocorrência inclui quem entrou na base depois da 1ª (e o limit_per_run não corta)", async () => {
    const { db, pool } = await banco();
    await inserirLeads(db, 2);
    const id = await campanhaRecorrente(db, { nextRunAt: new Date(Date.now() - 1000).toISOString(), limitPerRun: 1 });
    const w = await agendador(pool);
    w.abrir(); // nada fica preso: só interessa o lote criado

    await w.routes.runDueIndependentDispatches({ limit: 10 });
    await db.query("UPDATE campaign_dispatches SET status = 'done' WHERE campaign_id = $1", [id]);
    await inserirLeads(db, 2, "5521980");
    await db.query("UPDATE campaigns SET next_run_at = $2 WHERE id = $1", [id, new Date(Date.now() - 1000).toISOString()]);
    await w.routes.runDueIndependentDispatches({ limit: 10 });

    expect((await lotes(db, id)).map((l) => l.target_count)).toEqual([2, 4]);
    expect((await ocorrencias(db, id)).map((o) => o.audience_count)).toEqual([2, 4]);
  }, SLOW);
});

// ── Rotas reais: salvar, prévia e histórico ───────────────────────────────────────────────────────────────────────
const CHIP = "11111111-2222-4333-8444-555555555555";
const chipFrio = { id: CHIP, client_id: T, name: "Chip GD", chip_state: "cold", daily_limit_override: null, active: true };

async function servidor(pool, { comChip = false, buildLeads } = {}) {
  const app = express();
  app.use(express.json());
  // salvar não pode ficar preso no portão do teste de trava; com chip, o envio sai pelo "Chip GD" (cota de chip frio: 50/dia)
  await agendador(pool, comChip
    ? { app, settings: { webhookUrl: "https://evo.teste/message/sendText/gd", source: "campaign_evolution_instance", selectedEvolutionInstanceId: CHIP }, instancias: [chipFrio], buildLeads }
    : { app, settings: { webhookUrl: null }, buildLeads });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const resp = await fetch(url + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: resp.status, json: await resp.json() };
  };
  return { call, close: () => new Promise((r) => server.close(r)) };
}

const corpoCampanha = (over = {}) => ({
  name: "Aviso de assembleia",
  clientId: T,
  mode: "disparo",
  importId: "__crm__",
  analyticsMeta: { sequence: [{ ...SEQUENCIA[0], textVariants: ["Olá {{nome}}, assembleia dia 20.", "Oi {{nome}}! A assembleia é dia 20."] }] },
  isRecurring: true,
  recurrencePattern: "monthly",
  recurrenceDayOfMonth: 31,
  recurrenceTime: "09:00",
  recurrenceEndType: "count",
  recurrenceMaxOccurrences: 12,
  ...over,
});

describe("rotas: salvar campanha recorrente", () => {

  it("[OBRIGATÓRIO] planilha + sem variações: a rota NÃO salva e devolve o motivo", async () => {
    const { db, pool } = await banco();
    const s = await servidor(pool);
    try {
      const r = await s.call("POST", "/api/campaigns", corpoCampanha({
        importId: "11111111-1111-4111-8111-111111111111",
        importIds: ["11111111-1111-4111-8111-111111111111"],
        analyticsMeta: { sequence: SEQUENCIA },
      }));
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe("RECURRENCE_VARIANTS_REQUIRED");
      expect((await db.query("SELECT count(*)::int AS n FROM campaigns")).rows[0].n).toBe(0);
    } finally { await s.close(); }
  }, SLOW);

  it("CRM + sem variações: salva e devolve o aviso", async () => {
    const { pool } = await banco();
    const s = await servidor(pool);
    try {
      const r = await s.call("POST", "/api/campaigns", corpoCampanha({ analyticsMeta: { sequence: SEQUENCIA } }));
      expect(r.status).toBe(201);
      expect(r.json.recurrenceWarnings[0]).toContain("Sem variações do texto em o passo 1");
    } finally { await s.close(); }
  }, SLOW);

  it("sem fim sem confirmação: a rota recusa", async () => {
    const { pool } = await banco();
    const s = await servidor(pool);
    try {
      const r = await s.call("POST", "/api/campaigns", corpoCampanha({ recurrenceEndType: "never" }));
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe("RECURRENCE_NO_END_NOT_CONFIRMED");
    } finally { await s.close(); }
  }, SLOW);

  it("salva com fim declarado e o agendador passa a enxergá-la (fim declarado = entra no novo caminho)", async () => {
    const { db, pool } = await banco();
    const s = await servidor(pool);
    try {
      const r = await s.call("POST", "/api/campaigns", corpoCampanha());
      expect(r.status).toBe(201);
      const c = await campanha(db, r.json.item.id);
      expect(c).toMatchObject({ is_recurring: true, recurrence_end_type: "count", recurrence_max_occurrences: 12, recurrence_day_of_month: 31 });
      expect(c.next_run_at).not.toBeNull();
    } finally { await s.close(); }
  }, SLOW);

  it("[OBRIGATÓRIO] o agendador ANTIGO não enxerga a recorrente salva pelo caminho novo (sem envio dobrado via /run-due)", async () => {
    const { pool } = await banco();
    const s = await servidor(pool);
    try {
      const criada = await s.call("POST", "/api/campaigns", corpoCampanha({ recurrencePattern: "daily", recurrenceDayOfMonth: null }));
      expect(criada.status).toBe(201);
      const { runDueCampaignDispatches } = await import("../campaign/scheduler.js");
      // 3 dias depois: o primeiro envio da recorrente já venceu — se o caminho antigo a enxergasse, dispararia agora
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
      try {
        const r = await runDueCampaignDispatches({ limit: 10, triggerSource: "teste" });
        expect(r.processed).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    } finally { await s.close(); }
  }, SLOW);

  it("editar: trocar a origem para planilha numa recorrente sem variações é recusado", async () => {
    const { db, pool } = await banco();
    const s = await servidor(pool);
    try {
      const criada = await s.call("POST", "/api/campaigns", corpoCampanha({ analyticsMeta: { sequence: SEQUENCIA } }));
      const r = await s.call("PATCH", `/api/campaigns/${criada.json.item.id}`, {
        importId: "11111111-1111-4111-8111-111111111111",
        importIds: ["11111111-1111-4111-8111-111111111111"],
      });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe("RECURRENCE_VARIANTS_REQUIRED");
      expect((await campanha(db, criada.json.item.id)).analytics_meta.importSource).toBe("__crm__");
    } finally { await s.close(); }
  }, SLOW);
});

describe("[OBRIGATÓRIO] ocorrência que não cabe no intervalo: não salva em silêncio", () => {
  it("diária, 120 leads, chip frio de 50/dia → ~3 dias por envio > 1 dia: recusa com os números", async () => {
    const { db, pool } = await banco();
    await inserirLeads(db, 120);
    const s = await servidor(pool, { comChip: true });
    try {
      const r = await s.call("POST", "/api/campaigns", corpoCampanha({ recurrencePattern: "daily", recurrenceDayOfMonth: null }));
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe("RECURRENCE_OVERRUN");
      expect(r.json.error.message).toContain('a cota do chip "Chip GD" (50 mensagens/dia, 1 por lead)');
      expect(r.json.error.message).toContain("cada envio para 120 leads leva cerca de 3 dias; sua repetição é a cada 1 dia");
      expect(r.json.error.message).toContain("não vai conseguir acontecer como configurada");
      expect((await db.query("SELECT count(*)::int AS n FROM campaigns")).rows[0].n).toBe(0);
    } finally { await s.close(); }
  }, SLOW);

  it("com a confirmação explícita do dono, salva — e devolve a mesma conta", async () => {
    const { pool, db } = await banco();
    await inserirLeads(db, 120);
    const s = await servidor(pool, { comChip: true });
    try {
      const r = await s.call("POST", "/api/campaigns", corpoCampanha({ recurrencePattern: "daily", recurrenceDayOfMonth: null, recurrenceOverrunConfirmed: true }));
      expect(r.status).toBe(201);
      expect(r.json.recurrenceLoad).toMatchObject({ overrun: true, days: 3, intervalDays: 1, dailyQuota: 50, chipName: "Chip GD" });
    } finally { await s.close(); }
  }, SLOW);

  it("mensal com o mesmo público cabe: salva sem pedir confirmação", async () => {
    const { pool, db } = await banco();
    await inserirLeads(db, 120);
    const s = await servidor(pool, { comChip: true });
    try {
      const r = await s.call("POST", "/api/campaigns", corpoCampanha({ recurrenceDayOfMonth: 15 }));
      expect(r.status).toBe(201);
      expect(r.json.recurrenceLoad.overrun).toBe(false);
    } finally { await s.close(); }
  }, SLOW);

  it("a prévia já mostra a conta antes de salvar", async () => {
    const { pool, db } = await banco();
    await inserirLeads(db, 120);
    const s = await servidor(pool, { comChip: true });
    try {
      const r = await s.call("POST", "/api/campaigns/recurrence-preview", {
        clientId: T, importId: "__crm__", recurrencePattern: "daily", recurrenceTime: "09:00", analyticsMeta: { sequence: SEQUENCIA },
      });
      expect(r.json.load).toMatchObject({ overrun: true, days: 3, intervalDays: 1 });
    } finally { await s.close(); }
  }, SLOW);
});

describe("rodar pendentes de uma ocorrência interrompida", () => {
  it("conta o público inteiro, não o limit_per_run da campanha (igual ao envio)", async () => {
    const { db, pool } = await banco();
    await inserirLeads(db, 5);
    const id = await campanhaRecorrente(db, { limitPerRun: 2 });
    await materializeDueRecurringOccurrences({ ...deps(pool), now: new Date("2026-11-15T12:00:10Z") });
    const { rows: [lote] } = await db.query("UPDATE campaign_dispatches SET status = 'interrupted' WHERE campaign_id = $1 RETURNING id", [id]);
    const s = await servidor(pool);
    try {
      const r = await s.call("POST", `/api/campaigns/dispatches/${lote.id}/run-pending`);
      expect(r.status).toBe(200);
      expect(r.json.pendingCount).toBe(5);
    } finally { await s.close(); }
  }, SLOW);
});

describe("rotas: prévia e histórico", () => {
  it("prévia: próximo envio no fuso, regra do dia 31 por escrito, público de hoje inteiro (sem o limite)", async () => {
    const { db, pool } = await banco();
    await inserirLeads(db, 7);
    const s = await servidor(pool);
    try {
      const r = await s.call("POST", "/api/campaigns/recurrence-preview", {
        clientId: T, importId: "__crm__", recurrencePattern: "monthly", recurrenceDayOfMonth: 31, recurrenceTime: "09:00",
        limitPerRun: 5, analyticsMeta: { sequence: SEQUENCIA },
      });
      expect(r.status).toBe(200);
      expect(r.json.nextRunLabel).toMatch(/^\d{2}\/\d{2} às 09:00$/);
      expect(r.json.monthEndNote).toBe("Em meses sem dia 31, o envio sai no último dia do mês (ex.: 30/11, 28/02).");
      expect(r.json.audience).toEqual({ total: 7, toSend: 7, limitPerRun: null }); // limite ignorado: recorrente cobre todos
      expect(r.json.originKind).toBe("crm");
      expect(r.json.missingVariantSteps).toEqual([1]);
      expect(r.json.variantsBlocking).toBe(false);
    } finally { await s.close(); }
  }, SLOW);

  it("histórico: ocorrência pulada aparece com o motivo; criada aparece com o número daquele dia", async () => {
    const { db, pool } = await banco();
    await inserirLeads(db, 3);
    const id = await campanhaRecorrente(db);
    await materializeDueRecurringOccurrences({ ...deps(pool), now: new Date("2026-11-15T12:00:10Z") });
    await materializeDueRecurringOccurrences({ ...deps(pool), now: new Date("2026-12-15T12:00:10Z") }); // anterior ainda 'scheduled' → pulada
    const s = await servidor(pool);
    try {
      const r = await s.call("GET", `/api/campaigns/${id}/recurrence`);
      expect(r.status).toBe(200);
      expect(r.json.nextRunLabel).toBe("15/01 às 09:00");
      expect(r.json.summary).toBe("Todo mês, no dia 15, às 09:00");
      expect(r.json.occurrences.map((o) => [o.label, o.outcome])).toEqual([["15/12 às 09:00", "skipped"], ["15/11 às 09:00", "created"]]);
      expect(r.json.occurrences[0].reason).toContain("Pulado");
      expect(r.json.occurrences[1].audienceCount).toBe(3);
      expect(r.json.audienceToday.total).toBe(3);
    } finally { await s.close(); }
  }, SLOW);
});

// ── Variação por ocorrência, de ponta a ponta (runCampaignDispatch real, envio capturado no fetch) ────────────────
describe("[OBRIGATÓRIO] cada ocorrência usa outra variação do texto", () => {
  const VARIACOES = ["Variação A para {{nome}}", "Variação B para {{nome}}", "Variação C para {{nome}}"];
  let fetchOriginal;
  let timeoutOriginal;
  let enviados;
  beforeEach(() => {
    enviados = [];
    // o envio agendado espera 30–90 s entre leads: aqui as esperas longas (>= 1 s) viram imediatas
    timeoutOriginal = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) => timeoutOriginal(fn, ms >= 1000 ? 0 : ms, ...args);
    fetchOriginal = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      if (/sendText/.test(u)) {
        const body = JSON.parse(init?.body || "{}");
        enviados.push({ phone: String(body.number || ""), text: String(body.text || "") });
        return { ok: true, status: 200, json: async () => ({ key: { id: "wa" } }), text: async () => '{"key":{"id":"wa"}}' };
      }
      // checagem de número/conexão: tudo existe e está aberto
      return { ok: true, status: 200, json: async () => [], text: async () => "[]" };
    });
  });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    globalThis.setTimeout = timeoutOriginal;
  });

  it("duas ocorrências seguidas: nenhum lead recebe a mesma variação duas vezes, e dentro do lote as variações se espalham", async () => {
    const { db, pool } = await banco();
    await inserirLeads(db, 9);
    // limit_per_run 2 na campanha: a ocorrência tem que ignorar e mandar para os 9
    const id = await campanhaRecorrente(db, { nextRunAt: new Date(Date.now() - 1000).toISOString(), limitPerRun: 2 });
    await db.query(
      "UPDATE campaigns SET analytics_meta = $2::jsonb WHERE id = $1",
      [id, JSON.stringify({ importSource: "__crm__", sequence: [{ ...SEQUENCIA[0], text: VARIACOES[0], textVariants: VARIACOES }] })]
    );
    const w = await agendador(pool, { settings: { webhookUrl: "https://evo.teste/message/sendText/chip", webhookToken: "t" } });

    await w.routes.runDueIndependentDispatches({ limit: 10 });
    const primeira = new Map(enviados.map((e) => [e.phone, e.text]));
    enviados.length = 0;
    await db.query("UPDATE campaign_dispatches SET status = 'done' WHERE campaign_id = $1", [id]);
    await db.query("UPDATE campaigns SET next_run_at = $2 WHERE id = $1", [id, new Date(Date.now() - 1000).toISOString()]);
    await w.routes.runDueIndependentDispatches({ limit: 10 });
    const segunda = new Map(enviados.map((e) => [e.phone, e.text]));

    expect(primeira.size).toBe(9); // os 9, não os 2 do limit_per_run da campanha
    expect(segunda.size).toBe(9);
    for (const [phone, texto] of primeira) {
      expect(segunda.get(phone), `lead ${phone} recebeu o mesmo texto nas duas ocorrências`).not.toBe(texto);
    }
    const variacaoDe = (t) => t.slice(0, "Variação X".length);
    expect(new Set([...primeira.values()].map(variacaoDe)).size).toBeGreaterThan(1);
    expect(new Set([...segunda.values()].map(variacaoDe)).size).toBeGreaterThan(1);
  }, SLOW);
});

// ── Origem da ocorrência: o público contado é o da origem da campanha, nunca a base inteira do tenant ──────────────
// Mesmo defeito do lote 3edb7b73 (alvo 504 para público de 2, 22/10/2026), agora pela porta da recorrência: campanha de
// público do Banco sem origem passava pela materialização, o countCampaignAudience resolvia a origem pelo caminho
// PERMISSIVO (nulo = todas as planilhas) e o lote nascia com target_count = base do tenant. A trava do envio barrava a
// saída depois, mas o lote e a métrica já estavam errados. Aqui o tenant tem planilhas MAIORES que a da campanha: se a
// origem se perder, o número muda e o teste pega.
const PLANILHA_A = "00000000-0000-4000-8000-00000000000a"; // 2 contatos
const PLANILHA_B = "00000000-0000-4000-8000-00000000000b"; // 6 contatos
const PLANILHA_C = "00000000-0000-4000-8000-00000000000c"; // 4 contatos
const BANCO_CRITERIOS = { temperature: ["quente"] }; // público do Banco: o que marca a campanha como "do Banco"

async function inserirPlanilha(db, importId, n, prefixo) {
  for (let i = 0; i < n; i += 1) {
    await db.query(
      "INSERT INTO lead_import_items (import_id, client_id, telefone, normalized_data) VALUES ($1, $2, $3, $4::jsonb)",
      [importId, T, `${prefixo}${String(10000 + i)}`, JSON.stringify({ nome: `Contato ${prefixo}-${i}` })]
    );
  }
}

async function tenantComPlanilhas(db) {
  await inserirPlanilha(db, PLANILHA_A, 2, "5511970");
  await inserirPlanilha(db, PLANILHA_B, 6, "5511971");
  await inserirPlanilha(db, PLANILHA_C, 4, "5511972");
}

async function definirOrigem(db, id, { importId = null, meta = {} } = {}) {
  await db.query("UPDATE campaigns SET import_id = $2, analytics_meta = $3::jsonb WHERE id = $1", [
    id,
    importId,
    JSON.stringify({ sequence: SEQUENCIA, ...meta }),
  ]);
}

const MOTIVO_SEM_ORIGEM = /^Pulado: campanha sem origem definida/;

describe("[OBRIGATÓRIO] ocorrência de campanha do Banco sem origem é pulada, sem lote e sem contar a base inteira", () => {
  it("materialização: vira 'skipped' com motivo legível, não cria lote, não conta público e avança a próxima data", async () => {
    const { db, pool } = await banco();
    await tenantComPlanilhas(db);
    const id = await campanhaRecorrente(db);
    await definirOrigem(db, id, { importId: null, meta: { audienceCriteria: BANCO_CRITERIOS } });
    const countAudience = vi.fn(async () => ({ total: 12, toSend: 12, limitPerRun: null }));

    const r = await materializeDueRecurringOccurrences({ ...deps(pool), countAudience, now: new Date("2026-11-15T12:00:10Z") });

    expect(r.items.map((i) => i.status)).toEqual(["skipped"]);
    expect(r.items[0].reason).toMatch(MOTIVO_SEM_ORIGEM);
    expect(r.items[0].dispatchId).toBeNull();
    expect(countAudience).not.toHaveBeenCalled(); // a contagem inflada nem chega a acontecer
    expect(await lotes(db, id)).toHaveLength(0);
    const [occ] = await ocorrencias(db, id);
    expect(occ).toMatchObject({ outcome: "skipped", dispatch_id: null, audience_count: null });
    expect(occ.reason).toMatch(MOTIVO_SEM_ORIGEM);
    const c = await campanha(db, id);
    expect(iso(c.next_run_at)).toBe("2026-12-15T12:00:00.000Z"); // a agenda segue: o dono corrige e o mês seguinte sai
    expect(c.recurrence_occurrences_count).toBe(0); // pulada não conta para o fim por contagem
  }, SLOW);

  it("agendador de verdade (contagem do produto): nenhum lote nasce e o buildDispatchLeads nunca é chamado sem origem", async () => {
    const { db, pool } = await banco();
    await tenantComPlanilhas(db);
    const id = await campanhaRecorrente(db, { nextRunAt: new Date(Date.now() - 1000).toISOString() });
    await definirOrigem(db, id, { importId: null, meta: { audienceCriteria: BANCO_CRITERIOS } });
    const chamadas = [];
    const buildLeads = async (args) => {
      chamadas.push(args);
      return buildDispatchLeads(args);
    };
    const w = await agendador(pool, { settings: { webhookUrl: null }, buildLeads });

    const r = await w.routes.runDueIndependentDispatches({ limit: 10 });

    expect(r.recurrence.items.map((i) => i.status)).toEqual(["skipped"]);
    expect(await lotes(db, id)).toHaveLength(0);
    expect((await ocorrencias(db, id))[0].reason).toMatch(MOTIVO_SEM_ORIGEM);
    expect(chamadas).toEqual([]);
  }, SLOW);

  it("histórico: o 'público de hoje' de campanha do Banco sem origem é zero com o aviso, não a base do tenant (12)", async () => {
    const { db, pool } = await banco();
    await tenantComPlanilhas(db);
    const id = await campanhaRecorrente(db);
    await definirOrigem(db, id, { importId: null, meta: { audienceCriteria: BANCO_CRITERIOS } });
    const s = await servidor(pool);
    try {
      const r = await s.call("GET", `/api/campaigns/${id}/recurrence`);
      expect(r.status).toBe(200);
      expect(r.json.audienceToday).toEqual({ total: 0, toSend: 0, limitPerRun: null, missingOrigin: true });
    } finally { await s.close(); }
  }, SLOW);
});

describe("[OBRIGATÓRIO] ocorrência COM origem continua materializando com o público da origem (agendador de verdade)", () => {
  // Cada caso: o tenant tem as planilhas A (2), B (6) e C (4) e 3 leads no CRM. O alvo do lote tem que ser o da origem.
  const casos = [
    ["uma planilha", { importId: PLANILHA_A }, 2],
    ["campanha do Banco com planilha escolhida", { importId: PLANILHA_A, meta: { audienceCriteria: BANCO_CRITERIOS } }, 2],
    ["origem CRM", { importId: null, meta: { importSource: "__crm__" } }, 3],
    ["todas as planilhas (import_id nulo, campanha que não é do Banco)", { importId: null }, 12],
    ["todas as planilhas (importSource '__all__')", { importId: null, meta: { importSource: "__all__" } }, 12],
    ["várias planilhas (A e C)", { importId: PLANILHA_A, meta: { importIds: [PLANILHA_A, PLANILHA_C] } }, 6],
  ];

  it.each(casos)("%s → lote com alvo %#", async (_nome, origem, esperado) => {
    const { db, pool } = await banco();
    await tenantComPlanilhas(db);
    await inserirLeads(db, 3);
    const id = await campanhaRecorrente(db, { nextRunAt: new Date(Date.now() - 1000).toISOString() });
    await definirOrigem(db, id, origem);
    const w = await agendador(pool, { settings: { webhookUrl: null } });

    const r = await w.routes.runDueIndependentDispatches({ limit: 10 });

    expect(r.recurrence.items.map((i) => i.status)).toEqual(["created"]);
    const [lote] = await lotes(db, id);
    expect(lote.target_count).toBe(esperado);
    const [occ] = await ocorrencias(db, id);
    expect(occ).toMatchObject({ outcome: "created", reason: null, dispatch_id: lote.id, audience_count: esperado });
  }, SLOW);
});
