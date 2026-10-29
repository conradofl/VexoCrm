// backend/src/test/campaignQueueFreios.test.js
//
// PR 2 — os freios da fila de leads (startNextCampaignLeadInQueue, dívida DT-001): janela de envio, cota do chip e opt-out.
//
// Antes: se um lead respondia de madrugada, a fila puxava o próximo lead da base e começava a sequência dele, fora do
// horário, sem contar na cota do chip e sem checar opt-out. Em 7 dias, 15 de 47 leads iniciados pela fila saíram fora da
// janela (medição de 29/10/2026). Em agosto um chip foi restringido pelo WhatsApp por concentração de volume.
//
// A regra que não pode quebrar: freio que bloqueia NÃO pode significar lead perdido. Bloqueou por janela ou cota → a fila
// adia (marcador em campaign_queue_deferrals), o lead continua elegível e o claim é devolvido; o agendador retoma depois.
// Opt-out é o contrário: o lead é pulado de vez (nunca mais recebe).
//
// Postgres REAL (pglite); a migration da tabela de adiados é a do repositório, executada como está.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { ensureEvolutionInstanceDailyUsageTable, reserveChipDailyQuota, resetChipQuotaStateForTest } from "../services/chipQuota.js";

const estado = vi.hoisted(() => ({ settings: { send_window_enabled: false }, instances: [] }));

vi.mock("../campaign/settings.js", async (importOriginal) => ({
  ...(await importOriginal()),
  resolveCampaignDispatchSettings: async () => ({
    webhookUrl: "http://evolution.test/message/sendText/chip-teste",
    webhookToken: "token-teste",
    source: "teste",
  }),
}));
vi.mock("../services/evolution.js", async (importOriginal) => ({
  ...(await importOriginal()),
  checkEvolutionInstanceHealth: async () => ({ state: "open" }),
  getLeadClientEvolutionInstances: async () => estado.instances,
  resolveInstanceIdentifier: async ({ identifier }) => ({ canonicalName: identifier || null }),
}));
vi.mock("../services/n8nSettings.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getLeadClientN8nSettings: async () => estado.settings,
}));

const T = "tenant-freios";
const CAMP = "aaaaaaaa-0000-4000-8000-000000000001";
const IMP = "bbbbbbbb-0000-4000-8000-000000000002";
const CHIP = "cccccccc-0000-4000-8000-0000000000c1";
const ITEM = (n) => `dddddddd-0000-4000-8000-00000000000${n}`;
const FONE = (n) => `553499000000${n}`;
const STEP = { id: "passo-1", type: "text", text: "Oi, como vai?", order: 1, enabled: true, delayAfterSeconds: 0 };
// 2 passos: o 2º espera resposta. Com 1 passo só, o lead terminaria "finalizado" assim que o passo 1 saísse.
const STEP2 = { id: "passo-2", type: "text", text: "Segue o link", order: 2, enabled: true, delayAfterSeconds: 0, triggerMode: "after_reply" };
const WEBHOOK = "http://evolution.test/message/sendText/chip-teste";
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE public.leads_clients (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, telefone TEXT, nome TEXT,
    opt_out BOOLEAN DEFAULT false, metadata JSONB DEFAULT '{}'::jsonb, dados JSONB DEFAULT '{}'::jsonb,
    ultima_interacao_bot TIMESTAMPTZ, status_conversa TEXT, ultima_interacao_usuario TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.campaigns (
    id UUID PRIMARY KEY, client_id TEXT NOT NULL, name TEXT NOT NULL, import_id UUID, limit_per_run INT,
    status TEXT NOT NULL DEFAULT 'processing', archived_at TIMESTAMPTZ, last_triggered_at TIMESTAMPTZ, scheduled_for TIMESTAMPTZ,
    analytics_meta JSONB NOT NULL DEFAULT '{}'::jsonb, phones JSONB, webhook_url TEXT, webhook_token TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.lead_import_items (
    id UUID PRIMARY KEY, import_id UUID, client_id TEXT NOT NULL, lead_id UUID, telefone TEXT, imported BOOLEAN DEFAULT true,
    normalized_data JSONB NOT NULL DEFAULT '{}'::jsonb, status_conversa TEXT, ultima_interacao_bot TIMESTAMPTZ,
    ultima_interacao_usuario TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.campaign_dispatch_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dispatch_id UUID NOT NULL, campaign_id UUID NOT NULL, client_id TEXT NOT NULL,
    phone TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lead_id UUID, claimed_at TIMESTAMPTZ, lead_import_item_id UUID
  );
  CREATE TABLE public.lead_optouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, phone TEXT NOT NULL, reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (client_id, phone)
  );
  CREATE TABLE public.lead_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, lead_id UUID, campaign_id UUID, phone TEXT,
    sender_type TEXT, direction TEXT, engagement_signal TEXT, message_text TEXT, delivered_at TIMESTAMPTZ,
    message_timestamp TIMESTAMPTZ, meta JSONB DEFAULT '{}'::jsonb, instance_name TEXT, wa_message_id TEXT, media_path TEXT,
    media_url TEXT, content_type TEXT, dispatch_id UUID
  );
`;

vi.setConfig({ testTimeout: 180_000 });
let db;
beforeAll(async () => {
  db = await createPgliteDb(SCHEMA);
}, 180_000);
afterAll(async () => {
  _setPgDatabasePoolForTesting(null);
  if (db) await db.close();
});

let fetchOriginal;
let timeoutOriginal;
let enviados;
let spies = [];
beforeEach(() => {
  enviados = [];
  fetchOriginal = globalThis.fetch;
  timeoutOriginal = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => timeoutOriginal(fn, ms >= 1000 ? 0 : ms, ...args);
  globalThis.fetch = vi.fn(async (url, init) => {
    if (/sendText/.test(String(url))) {
      enviados.push(String(JSON.parse(init?.body || "{}").number || ""));
      await new Promise((r) => timeoutOriginal(r, 10));
      return { ok: true, status: 201, text: async () => '{"key":{"id":"wa"}}' };
    }
    return { ok: true, status: 200, text: async () => "[]", json: async () => [] };
  });
  spies = ["log", "info", "warn", "error"].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  globalThis.setTimeout = timeoutOriginal;
  spies.forEach((s) => s.mockRestore());
});

const HOJE_TZ = () =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/Sao_Paulo" }).format(new Date()).toLowerCase().slice(0, 3);
const JANELA_ABERTA = { send_window_enabled: false };
// fechada o dia todo: todos os dias da semana, menos hoje
const JANELA_FECHADA = () => ({
  send_window_enabled: true,
  send_window_start: "08:00",
  send_window_end: "20:00",
  send_window_days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].filter((d) => d !== HOJE_TZ()),
  send_window_timezone: "America/Sao_Paulo",
});
const chipComLimite = (limite) => ({
  id: CHIP, name: "Chip Teste", chip_state: "warm", daily_limit_override: limite, dispatch_webhook_url: WEBHOOK,
});

async function mundo({ leads = 3 } = {}) {
  await db.exec(
    "TRUNCATE public.leads, public.campaigns, public.lead_import_items, public.campaign_dispatch_runs, public.lead_optouts, public.lead_messages, public.leads_clients CASCADE"
  );
  await db.exec(await readFile(join(MIGRATIONS, "20261029200000_create_campaign_queue_deferrals.sql"), "utf8"));
  await db.exec("TRUNCATE public.campaign_queue_deferrals");
  _setPgDatabasePoolForTesting({ query: (sql, params) => db.query(sql, params) });
  await ensureEvolutionInstanceDailyUsageTable({ query: (sql, params) => db.query(sql, params) });
  await db.exec("TRUNCATE public.evolution_instance_daily_usage");
  resetChipQuotaStateForTest?.();
  estado.settings = JANELA_ABERTA;
  estado.instances = [chipComLimite(5)];
  await db.query("INSERT INTO public.leads_clients (id, name) VALUES ($1, 'Freios')", [T]);
  const analytics = { sequence: [STEP, STEP2], dispatchOptions: { waitForReply: true }, message: "Oi" };
  await db.query("INSERT INTO public.campaigns (id, client_id, name, import_id, limit_per_run, analytics_meta) VALUES ($1, $2, 'Fila', $3, 50, $4)", [
    CAMP, T, IMP, JSON.stringify(analytics),
  ]);
  for (let n = 1; n <= leads; n += 1) {
    // lead 1 é o mais novo: a lista vem do mais novo para o mais antigo
    await db.query(
      "INSERT INTO public.lead_import_items (id, import_id, client_id, telefone, created_at) VALUES ($1, $2, $3, $4, now() - ($5 || ' minutes')::interval)",
      [ITEM(n), IMP, T, FONE(n), String(n)]
    );
  }
  const { startNextCampaignLeadInQueue, maybeFinalizeCampaignAfterReply } = await import("../campaign/dispatch.js");
  const campaign = { id: CAMP, name: "Fila", client_id: T, import_id: IMP, limit_per_run: 50, analytics_meta: analytics };
  const progressoDe = async (n) =>
    (await db.query("SELECT normalized_data->'campaign_progress'->$2 AS p FROM public.lead_import_items WHERE id = $1", [ITEM(n), CAMP])).rows[0]?.p ?? null;
  const adiamento = async () => (await db.query("SELECT reason, retry_after, deferred_at FROM public.campaign_queue_deferrals WHERE campaign_id = $1", [CAMP])).rows[0] ?? null;
  return { campaign, startNext: () => startNextCampaignLeadInQueue({ campaign, clientId: T }), maybeFinalize: () => maybeFinalizeCampaignAfterReply({ campaignId: CAMP, clientId: T }), progressoDe, adiamento };
}

describe("fila de leads — janela de envio", () => {
  it("[OBRIGATÓRIO] fora da janela: não envia, o lead continua disponível e a fila fica adiada com o horário da próxima abertura", async () => {
    const w = await mundo();
    estado.settings = JANELA_FECHADA();
    const res = await w.startNext();
    expect(res.started).toBe(false);
    expect(res.deferred).toBe(true);
    expect(res.reason).toBe("outside_send_window");
    expect(enviados).toHaveLength(0);
    expect(await w.progressoDe(1)).toBeNull(); // lead intacto: sem claim pendurado, sem progresso
    const ad = await w.adiamento();
    expect(ad.reason).toBe("send_window");
    expect(new Date(ad.retry_after).getTime()).toBeGreaterThan(Date.now());
  });

  it("regressão: dentro da janela, com cota e sem opt-out, a fila envia normalmente e não deixa adiamento", async () => {
    const w = await mundo();
    const res = await w.startNext();
    expect(res.started).toBe(true);
    expect(enviados).toEqual([FONE(1)]);
    expect((await w.progressoDe(1)).status).toBe("aguardando_usuario");
    expect(await w.adiamento()).toBeNull();
  });
});

describe("fila de leads — cota do chip", () => {
  it("[OBRIGATÓRIO] cota esgotada: não envia, o claim é devolvido, o lead continua disponível e a fila fica adiada", async () => {
    const w = await mundo();
    estado.instances = [chipComLimite(1)];
    await reserveChipDailyQuota(CHIP, new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()), { query: (s, p) => db.query(s, p) }, 1);
    const res = await w.startNext();
    expect(res.started).toBe(false);
    expect(res.deferred).toBe(true);
    expect(res.reason).toBe("chip_quota_exhausted");
    expect(enviados).toHaveLength(0);
    expect(await w.progressoDe(1)).toBeNull(); // claim devolvido: nada de "iniciando" pendurado
    expect((await w.adiamento()).reason).toBe("chip_quota");
  });

  it("a mensagem enviada pela fila conta na cota do chip", async () => {
    const w = await mundo();
    estado.instances = [chipComLimite(5)];
    await w.startNext();
    const { rows } = await db.query("SELECT sent_count FROM public.evolution_instance_daily_usage WHERE instance_id::text = $1", [CHIP]);
    expect(Number(rows[0]?.sent_count)).toBe(1);
  });
});

describe("fila de leads — opt-out", () => {
  it("[OBRIGATÓRIO] lead em lead_optouts é pulado de vez: não recebe claim, não recebe envio e a fila segue para o próximo", async () => {
    const w = await mundo();
    await db.query("INSERT INTO public.lead_optouts (client_id, phone, reason) VALUES ($1, $2, 'Opt-out via WhatsApp: parar')", [T, FONE(1)]);
    const res = await w.startNext();
    expect(res.started).toBe(true);
    expect(enviados).toEqual([FONE(2)]);
    expect(await w.progressoDe(1)).toBeNull(); // nunca reivindicado
    await w.startNext();
    expect(enviados).toEqual([FONE(2), FONE(3)]); // e NÃO volta para a fila: a segunda chamada também o pula
    expect(await w.progressoDe(1)).toBeNull();
  });

  it("opt-out de TODOS os candidatos: nada é enviado e a fila não fica adiada (não há o que retomar)", async () => {
    const w = await mundo({ leads: 1 });
    await db.query("INSERT INTO public.lead_optouts (client_id, phone) VALUES ($1, $2)", [T, FONE(1)]);
    const res = await w.startNext();
    expect(res.started).toBe(false);
    expect(res.deferred).not.toBe(true);
    expect(enviados).toHaveLength(0);
    expect(await w.adiamento()).toBeNull();
  });
});

describe("fila adiada não encerra a campanha", () => {
  // Campanha com um lead concluído e leads ainda não iniciados: o fechamento só conta quem já tem progresso de espera.
  async function campanhaComUmConcluido(w) {
    await db.query("UPDATE public.campaigns SET status = 'processing' WHERE id = $1", [CAMP]);
    await db.query(
      `UPDATE public.lead_import_items SET normalized_data = jsonb_build_object('campaign_progress', jsonb_build_object($2::text,
         jsonb_build_object('campaignId', $2::text, 'waitForReply', true, 'status', 'finalizado', 'nextStepIndex', null))) WHERE id = $1`,
      [ITEM(1), CAMP]
    );
  }

  it("[OBRIGATÓRIO] com adiamento registrado, maybeFinalizeCampaignAfterReply NÃO encerra a campanha", async () => {
    const w = await mundo();
    await campanhaComUmConcluido(w);
    await db.query("INSERT INTO public.campaign_queue_deferrals (campaign_id, client_id, reason, retry_after) VALUES ($1, $2, 'send_window', now() + interval '1 hour')", [CAMP, T]);
    const res = await w.maybeFinalize();
    expect(res.finalized).toBe(false);
    expect(res.reason).toBe("queue_deferred");
  });

  it("sem adiamento (controle): o mesmo cenário encerra a campanha — é o defeito que o marcador evita", async () => {
    const w = await mundo();
    await campanhaComUmConcluido(w);
    const res = await w.maybeFinalize();
    expect(res.finalized).toBe(true);
  });
});

describe("agendador retoma a fila adiada", () => {
  it("[OBRIGATÓRIO] adiamento vencido e janela aberta: a fila retoma, envia ao próximo lead e limpa o adiamento", async () => {
    const w = await mundo();
    await db.query("INSERT INTO public.campaign_queue_deferrals (campaign_id, client_id, reason, retry_after) VALUES ($1, $2, 'send_window', now() - interval '1 minute')", [CAMP, T]);
    const { resumeDeferredQueues } = await import("../campaign/queueResume.js");
    const out = await resumeDeferredQueues({ pool: { query: (s, p) => db.query(s, p) } });
    expect(out.resumed).toBe(1);
    expect(enviados).toEqual([FONE(1)]);
    expect(await w.adiamento()).toBeNull();
  });

  it("adiamento que ainda não venceu NÃO é retomado", async () => {
    const w = await mundo();
    await db.query("INSERT INTO public.campaign_queue_deferrals (campaign_id, client_id, reason, retry_after) VALUES ($1, $2, 'send_window', now() + interval '1 hour')", [CAMP, T]);
    const { resumeDeferredQueues } = await import("../campaign/queueResume.js");
    const out = await resumeDeferredQueues({ pool: { query: (s, p) => db.query(s, p) } });
    expect(out.resumed).toBe(0);
    expect(enviados).toHaveLength(0);
    expect(await w.adiamento()).not.toBeNull();
  });

  it("vencido mas a janela ainda está fechada: não envia e o adiamento é reagendado", async () => {
    const w = await mundo();
    estado.settings = JANELA_FECHADA();
    await db.query("INSERT INTO public.campaign_queue_deferrals (campaign_id, client_id, reason, retry_after) VALUES ($1, $2, 'send_window', now() - interval '1 minute')", [CAMP, T]);
    const { resumeDeferredQueues } = await import("../campaign/queueResume.js");
    await resumeDeferredQueues({ pool: { query: (s, p) => db.query(s, p) } });
    expect(enviados).toHaveLength(0);
    expect(new Date((await w.adiamento()).retry_after).getTime()).toBeGreaterThan(Date.now());
  });

  it("dois agendadores no mesmo instante: só um retoma (concessão atômica), nenhum lead recebe duas vezes", async () => {
    const w = await mundo();
    await db.query("INSERT INTO public.campaign_queue_deferrals (campaign_id, client_id, reason, retry_after) VALUES ($1, $2, 'send_window', now() - interval '1 minute')", [CAMP, T]);
    const { resumeDeferredQueues } = await import("../campaign/queueResume.js");
    const pool = { query: (s, p) => db.query(s, p) };
    const [a, b] = await Promise.all([resumeDeferredQueues({ pool }), resumeDeferredQueues({ pool })]);
    expect(a.resumed + b.resumed).toBe(1);
    expect(enviados).toEqual([FONE(1)]);
  });

  it("campanha pausada ou arquivada: o adiamento é descartado e nada é enviado", async () => {
    const w = await mundo();
    await db.query("UPDATE public.campaigns SET status = 'paused' WHERE id = $1", [CAMP]);
    await db.query("INSERT INTO public.campaign_queue_deferrals (campaign_id, client_id, reason, retry_after) VALUES ($1, $2, 'send_window', now() - interval '1 minute')", [CAMP, T]);
    const { resumeDeferredQueues } = await import("../campaign/queueResume.js");
    await resumeDeferredQueues({ pool: { query: (s, p) => db.query(s, p) } });
    expect(enviados).toHaveLength(0);
    expect(await w.adiamento()).toBeNull();
  });
});

describe("migration ainda não aplicada (código novo + schema velho não pode derrubar a fila)", () => {
  it("[OBRIGATÓRIO] sem a tabela de adiamentos: janela fechada bloqueia sem lançar erro e sem claim pendurado", async () => {
    const w = await mundo();
    await db.exec("DROP TABLE public.campaign_queue_deferrals");
    estado.settings = JANELA_FECHADA();
    const res = await w.startNext();
    expect(res.started).toBe(false);
    expect(enviados).toHaveLength(0);
    expect(await w.progressoDe(1)).toBeNull();
  });
});

describe("DT-004 — claim 'iniciando' que não expira", () => {
  const iniciando = (minutosAtras) => ({
    status: "iniciando",
    claimedAt: new Date(Date.now() - minutosAtras * 60_000).toISOString(),
  });
  const gravar = (w, n, progresso) =>
    db.query(
      `UPDATE public.lead_import_items SET normalized_data = jsonb_build_object('campaign_progress', jsonb_build_object($2::text, $3::jsonb)) WHERE id = $1`,
      [ITEM(n), CAMP, JSON.stringify(progresso)]
    );

  it("claim 'iniciando' com mais de 10 minutos é de um processo que morreu: o lead volta a ser elegível", async () => {
    const w = await mundo({ leads: 2 });
    await gravar(w, 1, iniciando(11));
    await w.startNext();
    expect(enviados).toEqual([FONE(1)]);
  });

  it("claim 'iniciando' recente (envio em andamento) continua valendo: a fila pula para o próximo", async () => {
    const w = await mundo({ leads: 2 });
    await gravar(w, 1, iniciando(1));
    await w.startNext();
    expect(enviados).toEqual([FONE(2)]);
  });
});

describe("opt-out — leitura única das duas fontes", () => {
  it("lê lead_optouts, a flag do lead e variações de formato do telefone; ninguém é bloqueado por engano", async () => {
    const w = await mundo({ leads: 1 });
    const { isPhoneOptedOut } = await import("../campaign/queueOptOut.js");
    const pool = { query: (s, p) => db.query(s, p) };
    await db.query("INSERT INTO public.lead_optouts (client_id, phone) VALUES ($1, '+55 34 99000-0001')", [T]);
    await db.query("INSERT INTO public.leads (client_id, telefone, opt_out) VALUES ($1, '5534990000002', true)", [T]);
    await db.query("INSERT INTO public.leads (client_id, telefone, metadata) VALUES ($1, '5534990000003', '{\"opt_out\":\"true\"}')", [T]);
    await db.query("INSERT INTO public.leads (client_id, telefone) VALUES ($1, '5534990000004')", [T]);
    expect(await isPhoneOptedOut(pool, { clientId: T, phone: "5534990000001" })).toBe(true); // tabela, formato diferente
    expect(await isPhoneOptedOut(pool, { clientId: T, phone: "5534990000002" })).toBe(true); // flag opt_out
    expect(await isPhoneOptedOut(pool, { clientId: T, phone: "5534990000003" })).toBe(true); // metadata.opt_out
    expect(await isPhoneOptedOut(pool, { clientId: T, phone: "5534990000004" })).toBe(false);
    expect(await isPhoneOptedOut(pool, { clientId: "outro-tenant", phone: "5534990000001" })).toBe(false); // outro tenant
  });
});
