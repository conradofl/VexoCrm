// backend/src/test/campaignChipQuota.test.js
//
// Cota diária de chip NO DISPARO DE CAMPANHA. O follow-up já reservava por mensagem; a campanha não reservava nada
// (o rodízio que faria isso nunca foi ligado ao laço). Agora a cota é reservada no chip que de fato envia (o dono do
// webhook do disparo), por MENSAGEM, antes de enviar — e o contador passa a refletir campanha.
//
// O contador (evolution_instance_daily_usage) roda em Postgres REAL (pglite) com a SQL do produto; o resto da rota
// (supabase, claims) é simulado como nos outros testes de ponta a ponta. O tempo é controlado (só `Date`) para provar
// o "retoma no dia seguinte". Limites do pglite (helpers/pgliteDb.js): não prova produção; tudo roda sem adaptação.
//
// FORA de escopo de propósito (registrado em services/chipQuota.js): resposta do chatbot, mensagem manual do inbox e
// envio do módulo GD continuam sem reservar — o número da cota NÃO é o total de mensagens que o chip manda.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";
import { countBurstSteps, dispatchCampaignSequence, endsBurst } from "../campaign-outbound.js";
import { createChipQuotaGate, buildQuotaExhaustedMessage, findInstanceByWebhookUrl } from "../services/campaignQuotaGate.js";
import { ensureEvolutionInstanceDailyUsageTable, getChipDailyUsage, resetChipQuotaStateForTest, reserveChipDailyQuota } from "../services/chipQuota.js";
import { getLeadClientEvolutionInstances } from "../services/evolution.js";
import { getDateKey } from "../services/analytics.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const SLOW = 90_000;
const TENANT = "tenant-e2e";
const CHIP = "11111111-2222-4333-8444-555555555555";
const OUTRO_CHIP = "99999999-2222-4333-8444-555555555555"; // outro chip do tenant: não é o que envia
const HOJE = new Date("2026-10-05T15:00:00.000Z"); // segunda 12h em Brasília
const AMANHA = new Date("2026-10-06T15:00:00.000Z");
const DIA_HOJE = getDateKey(HOJE, "America/Sao_Paulo");
const DIA_AMANHA = getDateKey(AMANHA, "America/Sao_Paulo");

const SCHEMA = `
  CREATE TABLE lead_client_evolution_instances (
    id uuid PRIMARY KEY, client_id text, name text, dispatch_webhook_url text, dispatch_webhook_token text,
    inbound_bearer_token text, owner_uid text, active boolean DEFAULT true, is_default boolean DEFAULT false,
    chip_state text DEFAULT 'cold', connection_state text, daily_limit_override int, webhook_enabled boolean DEFAULT false,
    created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), updated_by_email text);
  CREATE TABLE lead_client_n8n_settings (client_id text PRIMARY KEY, send_window_timezone text);
`;

const openDbs = [];
async function bancoDeCota() {
  const db = await createPgliteDb("SET TimeZone = 'UTC';\n" + SCHEMA);
  openDbs.push(db);
  await db.query("INSERT INTO lead_client_evolution_instances (id, client_id, name, chip_state, daily_limit_override) VALUES ($1,$2,'Chip Principal','warm',NULL)", [CHIP, TENANT]);
  return db;
}
afterAll(async () => {
  for (const db of openDbs) await db.close();
});

let originalFetch;
let intervalSpy;
beforeAll(() => {
  // o agendador interno do módulo arma um setInterval ao registrar: aqui ele não pode disparar sozinho
  intervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(() => ({ unref() {}, ref() {} }));
});
afterAll(() => intervalSpy.mockRestore());
beforeEach(() => {
  resetChipQuotaStateForTest();
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ key: { id: "wa-1" } }), text: async () => '{"key":{"id":"wa-1"}}' });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(HOJE);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
  intervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(() => ({ unref() {}, ref() {} }));
});

// ── supabase em memória (só o que o disparo e o agendador usam) ────────────────────────────────────────────────────
function fakeSupabase(tables) {
  const from = (name) => {
    tables[name] ||= [];
    const st = { filters: [], patch: null, mode: "select", lim: null };
    const rows = () => {
      let r = tables[name].filter((row) => st.filters.every((f) => f(row)));
      if (st.lim) r = r.slice(0, st.lim);
      return r;
    };
    const b = {
      select() { if (st.mode === "update") st.mode = "update-select"; return b; },
      eq(c, v) { st.filters.push((r) => r[c] === v); return b; },
      in(c, vs) { st.filters.push((r) => vs.includes(r[c])); return b; },
      lte(c, v) { st.filters.push((r) => String(r[c]) <= String(v)); return b; },
      order() { return b; },
      limit(n) { st.lim = n; return b; },
      update(patch) { st.mode = "update"; st.patch = patch; return b; },
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: "not found" } }),
      then(resolve) {
        if (st.mode === "update" || st.mode === "update-select") {
          const r = rows();
          r.forEach((row) => Object.assign(row, st.patch));
          return resolve({ data: st.mode === "update-select" ? r.map((x) => ({ id: x.id })) : null, error: null });
        }
        return resolve({ data: rows(), error: null });
      },
    };
    return b;
  };
  return { from };
}

const chipRow = (over = {}) => ({
  id: CHIP, client_id: TENANT, name: "GD Gabriel", dispatch_webhook_url: "https://evolution.teste/message/sendText/chip-1",
  dispatch_webhook_token: "secret", active: true, chip_state: "warm", daily_limit_override: null, ...over,
});
const outroChip = () => chipRow({ id: OUTRO_CHIP, name: "Outro Chip", dispatch_webhook_url: "https://evolution.teste/message/sendText/outro" });

const passos = (n) => Array.from({ length: n }, (_, i) => ({ id: `step-${i + 1}`, type: "text", text: `Mensagem ${i + 1} para {{nome}}`, order: i + 1, enabled: true, delayAfterSeconds: 0 }));

/** Monta a rota real de campanhas com o contador de cota em Postgres real. */
async function mundoDeDisparo({ qdb, nLeads = 2, nPassos = 2, chip: chipInicial = chipRow(), instancias = null, settings = null, falhaNaCota = null } = {}) {
  const atual = { chip: chipInicial }; // o dono pode mudar o chip (ex.: subir o limite) com o lote já pausado
  const estado = { claimed: [], sent: [], sentLeadIds: new Set(), usageQueries: 0, claimBloqueado: new Set() };
  const leads = Array.from({ length: nLeads }, (_, i) => ({ id: `lead-${i + 1}`, nome: `Lead ${i + 1}`, telefone: `551199999${String(1000 + i)}`, client_id: TENANT }));
  const campaign = { id: "camp-1", name: "Campanha", client_id: TENANT, mode: "campanha", analytics_meta: { sequence: passos(nPassos) } };
  const tables = {
    campaign_dispatches: [{
      id: "disp-1", campaign_id: "camp-1", client_id: TENANT, name: "Lote", status: "running", target_count: nLeads, sent_count: 0,
      failed_count: 0, dispatch_options: { leadDelaySeconds: 0 }, evolution_instance_id: null, scheduled_at: "2026-10-01T00:00:00.000Z", error_message: null,
    }],
    campaigns: [campaign],
  };
  const supabase = fakeSupabase(tables);

  const pool = {
    query: vi.fn(async (sql, params) => {
      const t = String(sql);
      if (t.includes("evolution_instance_daily_usage")) {
        estado.usageQueries += 1;
        if (falhaNaCota) throw new Error(falhaNaCota); // o contador não responde (ex.: a coluna uuid antes da migration)
        return qdb.query(sql, params);
      }
      if (t.includes("INSERT INTO public.campaign_dispatch_runs")) {
        if (estado.claimBloqueado.has(params[3])) return { rowCount: 0, rows: [] }; // lead já tocado neste disparo
        estado.claimed.push(params[3]);
        return { rowCount: 1, rows: [{ id: "claim" }] };
      }
      if (t.includes("UPDATE public.campaign_dispatch_runs SET status = 'sent'")) {
        estado.sent.push({ leadId: params[2], chipId: params[3] });
        estado.sentLeadIds.add(params[2]);
        return { rowCount: 1, rows: [] };
      }
      if (t.includes("COUNT(*) FILTER")) return { rows: [{ sent: estado.sent.length, failed: 0, skipped: 0 }] };
      return { rows: [], rowCount: 0 };
    }),
  };

  const deps = {
    CAMPAIGN_SCHEDULER_MAX_BATCH: 10,
    // o que a fila devolve: só quem ainda não foi tocado neste disparo (o excludeDispatchId do produto)
    buildDispatchLeads: async () => leads.filter((l) => !estado.sentLeadIds.has(l.id)),
    canCampaignBeDispatched: () => true,
    checkEvolutionInstanceHealth: async () => ({ state: "open" }),
    continueCampaignLeadFromReply: async () => {},
    ensureDb: () => true,
    executeCampaignDispatch: async () => {},
    findCampaignReplyMatches: async () => [],
    getClientName: async () => "Tenant Teste",
    getLeadClientEvolutionInstances: async () => instancias || [outroChip(), atual.chip], // o outro vem PRIMEIRO de propósito
    getLeadClientN8nSettings: async () => ({ send_window_enabled: false, send_window_start: "00:00", send_window_end: "23:59", send_window_days: ["seg", "ter", "qua", "qui", "sex", "sab", "dom"] }),
    getRequestId: () => "req-1",
    getSafeDispatchSettingsLog: () => ({}),
    internalErrorPayloadDetails: () => ({}),
    isMissingSchemaError: () => false,
    isProduction: false,
    logCampaignReplyFlow: () => {},
    logDirectDispatch: () => {},
    maskPhoneForLog: (p) => p,
    normalizeIsoDate: (d) => d,
    leadsTableName: "lead_import_items",
    normalizeString: (s) => String(s || "").trim(),
    normalizeTenantKey: (s) => String(s || "").trim(),
    parseOptionalUuid: (s) => s,
    pgDatabasePool: pool,
    requireAppViewAccess: () => (req, res, next) => next(),
    requireCampaignDispatchAccess: () => (req, res, next) => next(),
    requireFirebaseAuth: (req, res, next) => next(),
    requireInternalPageAccess: () => (req, res, next) => next(),
    resolveAuthorizedClientId: () => TENANT,
    // o webhook de envio: instância cadastrada (ou, se `settings` vier, o que o teste definir — ex.: sem instância)
    resolveCampaignDispatchSettings: async () => settings || {
      webhookUrl: atual.chip.dispatch_webhook_url, webhookToken: "secret", source: "campaign_evolution_instance", selectedEvolutionInstanceId: atual.chip.id,
    },
    resolveDispatchWebhookSettings: async () => ({}),
    runDueCampaignDispatches: async () => {},
    sanitizePhone: (p) => p,
    sendError: vi.fn(),
    supabase,
    validateN8nInboundBearer: () => true,
  };
  const dummyApp = { get() {}, post() {}, put() {}, patch() {}, delete() {}, use() {} };
  const routes = registerCampaignsRoutes(dummyApp, deps);
  return { routes, estado, tables, supabase, campaign, dispatch: tables.campaign_dispatches[0], pool, trocarChip: (novo) => { atual.chip = novo; } };
}

const usoDoChip = (qdb, chip, dia) => getChipDailyUsage(chip, dia, qdb);
const mensagensEnviadas = () => globalThis.fetch.mock.calls.filter((c) => !/connectionState|fetchInstances|whatsappNumbers/.test(String(c[0]))).length;

describe("[TESTE OBRIGATÓRIO] envio de campanha reserva a cota no chip que enviou, por MENSAGEM", () => {
  it("2 leads × 2 passos = 4 mensagens = 4 unidades, só no chip que enviou (não no outro chip do tenant)", async () => {
    const qdb = await bancoDeCota();
    const w = await mundoDeDisparo({ qdb, nLeads: 2, nPassos: 2 });

    await w.routes.runCampaignDispatch({ dispatch: w.dispatch, campaign: w.campaign, supabase: w.supabase });

    expect(mensagensEnviadas()).toBe(4);
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(4); // por mensagem, não 2 (por lead)
    expect(await usoDoChip(qdb, OUTRO_CHIP, DIA_HOJE)).toBe(0); // o outro chip do tenant não foi debitado
    expect(w.dispatch.status).toBe("done");
  }, SLOW);

  it("lead com 3 passos gasta 3 unidades (a mesma unidade do follow-up: 1 mensagem = 1)", async () => {
    const qdb = await bancoDeCota();
    const w = await mundoDeDisparo({ qdb, nLeads: 1, nPassos: 3 });

    await w.routes.runCampaignDispatch({ dispatch: w.dispatch, campaign: w.campaign, supabase: w.supabase });

    expect(mensagensEnviadas()).toBe(3);
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(3);
  }, SLOW);

  it("lead que já foi tocado neste disparo (claim recusado) não gasta cota", async () => {
    const qdb = await bancoDeCota();
    const w = await mundoDeDisparo({ qdb, nLeads: 2, nPassos: 2 });
    w.estado.claimBloqueado.add("lead-1");

    await w.routes.runCampaignDispatch({ dispatch: w.dispatch, campaign: w.campaign, supabase: w.supabase });

    expect(w.estado.sent.map((s) => s.leadId)).toEqual(["lead-2"]);
    expect(mensagensEnviadas()).toBe(2);
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(2); // só as 2 mensagens do lead 2; a reserva do lead 1 foi devolvida
  }, SLOW);

  it("mensagem que FALHA no envio devolve a cota (o contador é do que saiu)", async () => {
    const qdb = await bancoDeCota();
    const w = await mundoDeDisparo({ qdb, nLeads: 1, nPassos: 1 });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "Número de WhatsApp inválido" });

    await w.routes.runCampaignDispatch({ dispatch: w.dispatch, campaign: w.campaign, supabase: w.supabase });

    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(0);
  }, SLOW);
});

describe("[TESTE OBRIGATÓRIO] cota esgotada pausa o lote com a mensagem existente, e o agendador retoma no dia seguinte", () => {
  const MENSAGEM = "Pausado — cota diária do chip atingida (3/3). Retoma amanhã.";

  async function lotePausadoPorCota(qdb, over = {}) {
    // limite 3, 2 leads × 2 passos: o 1º lead usa 2; o 2º precisaria de mais 2 (=4 > 3) → pausa ANTES de reivindicar
    const w = await mundoDeDisparo({ qdb, nLeads: 2, nPassos: 2, chip: chipRow({ daily_limit_override: 3 }), ...over });
    await w.routes.runCampaignDispatch({ dispatch: w.dispatch, campaign: w.campaign, supabase: w.supabase });
    return w;
  }

  it("esgotada: o lote pausa com a mensagem que já existe, o lead que não coube NÃO é enviado nem reivindicado, e a reserva em excesso é devolvida", async () => {
    const qdb = await bancoDeCota();

    const w = await lotePausadoPorCota(qdb);

    expect(w.dispatch.status).toBe("paused");
    expect(w.dispatch.error_message).toBe(MENSAGEM);
    expect(w.dispatch.error_message).toBe(buildQuotaExhaustedMessage(3));
    expect(w.estado.sent.map((s) => s.leadId)).toEqual(["lead-1"]);
    expect(w.estado.claimed).toEqual(["lead-1"]); // o lead 2 nem foi reivindicado: nada fica meio enviado
    expect(mensagensEnviadas()).toBe(2);
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(2); // não 4: o excesso foi devolvido
  }, SLOW);

  it("no mesmo dia o agendador NÃO retoma enquanto o próximo lead não cabe (nada de pausar de novo a cada 30s)", async () => {
    const qdb = await bancoDeCota();
    const w = await lotePausadoPorCota(qdb);

    const r = await w.routes.runDueIndependentDispatches({ limit: 10 });

    expect(r.processed).toBe(0);
    expect(w.dispatch.status).toBe("paused");
    expect(w.estado.sent).toHaveLength(1);
  }, SLOW);

  it("no dia seguinte o agendador retoma e termina o lote; o contador do novo dia é separado", async () => {
    const qdb = await bancoDeCota();
    const w = await lotePausadoPorCota(qdb);
    vi.setSystemTime(AMANHA);

    const r = await w.routes.runDueIndependentDispatches({ limit: 10 });

    expect(r.items.map((i) => i.status)).toEqual(["success"]);
    expect(w.estado.sent.map((s) => s.leadId)).toEqual(["lead-1", "lead-2"]);
    expect(w.dispatch.status).toBe("done");
    expect(await usoDoChip(qdb, CHIP, DIA_AMANHA)).toBe(2);
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(2);
  }, SLOW);

  it("sobrando cota no mesmo dia (limite aumentado) o agendador retoma sem esperar o dia seguinte", async () => {
    const qdb = await bancoDeCota();
    const w = await lotePausadoPorCota(qdb);
    w.trocarChip(chipRow({ daily_limit_override: 4 })); // o dono sobe o limite do chip: 2 usados + 2 do próximo lead cabem

    const r = await w.routes.runDueIndependentDispatches({ limit: 10 });

    expect(r.items.map((i) => i.status)).toEqual(["success"]);
    expect(w.estado.sent.map((s) => s.leadId)).toEqual(["lead-1", "lead-2"]);
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(4);
  }, SLOW);

  it("o agendador olha o chip que ENVIA (o dono do webhook), não o primeiro chip do tenant", async () => {
    const qdb = await bancoDeCota();
    const w = await lotePausadoPorCota(qdb);
    // o OUTRO chip (primeiro na lista) está sem uso nenhum; só o que envia está esgotado
    expect(await usoDoChip(qdb, OUTRO_CHIP, DIA_HOJE)).toBe(0);

    const r = await w.routes.runDueIndependentDispatches({ limit: 10 });

    expect(r.processed).toBe(0); // continua pausado: o chip certo segue esgotado
    expect(w.dispatch.status).toBe("paused");
  }, SLOW);
});

describe("[TESTE OBRIGATÓRIO] chip sem limite próprio usa o padrão do estado: 50 se frio, 500 se aquecido", () => {
  async function gateComUso(estadoDoChip, usoInicial, override = null) {
    const qdb = await bancoDeCota();
    await ensureEvolutionInstanceDailyUsageTable(qdb);
    await reserveChipDailyQuota(CHIP, DIA_HOJE, qdb, usoInicial);
    const gate = createChipQuotaGate({ chip: { id: CHIP, name: "Chip", chip_state: estadoDoChip, daily_limit_override: override }, timezone: "America/Sao_Paulo", pool: qdb, clock: () => HOJE });
    return { qdb, gate };
  }

  it("frio: cabe até a 50ª mensagem; a 51ª esgota com '50/50'", async () => {
    const { qdb, gate } = await gateComUso("cold", 49);

    expect((await gate.reserve(1)).status).toBe("reserved"); // 50ª
    const r = await gate.reserve(1); // 51ª

    expect(r).toMatchObject({ status: "exhausted", limitQuota: 50, usedQuota: 50 });
    expect(r.message).toBe("Pausado — cota diária do chip atingida (50/50). Retoma amanhã.");
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(50); // o excesso foi devolvido
  }, SLOW);

  it("aquecido: cabe até a 500ª; a 501ª esgota com '500/500'", async () => {
    const { gate } = await gateComUso("warm", 499);

    expect((await gate.reserve(1)).status).toBe("reserved");
    expect(await gate.reserve(1)).toMatchObject({ status: "exhausted", limitQuota: 500 });
  }, SLOW);

  it("limite próprio (override) vence o padrão do estado", async () => {
    const { gate } = await gateComUso("cold", 119, 120);

    expect((await gate.reserve(1)).status).toBe("reserved");
    expect(await gate.reserve(1)).toMatchObject({ status: "exhausted", limitQuota: 120 });
  }, SLOW);

  it("lead que não cabe INTEIRO no que sobra não envia nenhuma mensagem (sem lead pela metade)", async () => {
    const { qdb, gate } = await gateComUso("cold", 49);

    const r = await gate.reserve(3); // sobra 1, precisa de 3

    expect(r.status).toBe("exhausted");
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(49);
  }, SLOW);
});

describe("[TESTE OBRIGATÓRIO] chip não identificado não envia com cota inventada, e o caso é registrado", () => {
  it("webhook que não é de instância cadastrada: o envio SEGUE, nada é debitado de nenhum chip, e fica registrado", async () => {
    const qdb = await bancoDeCota();
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = await mundoDeDisparo({
      qdb, nLeads: 1, nPassos: 2,
      settings: { webhookUrl: "https://evolution.teste/message/sendText/config-do-tenant", webhookToken: "t", source: "client_settings" },
    });

    await w.routes.runCampaignDispatch({ dispatch: w.dispatch, campaign: w.campaign, supabase: w.supabase });

    expect(mensagensEnviadas()).toBe(2); // enviou
    expect(w.dispatch.status).toBe("done");
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(0); // nenhum chip debitado
    expect(await usoDoChip(qdb, OUTRO_CHIP, DIA_HOJE)).toBe(0);
    expect(w.estado.sent[0].chipId).toBeNull(); // o envio fica sem chip registrado (aparece assim no dashboard)
    const registro = aviso.mock.calls.find((c) => String(c[0]).includes("mensagens enviadas sem cota (chip não identificado)"));
    expect(registro?.[1]).toMatchObject({ dispatchId: "disp-1", clientId: TENANT, mensagens: 2, origemDoWebhook: "client_settings" });
  }, SLOW);

  it("o portão conta as mensagens sem chip e não escreve na tabela da cota", async () => {
    const qdb = await bancoDeCota();
    await ensureEvolutionInstanceDailyUsageTable(qdb);
    const logger = { warn: vi.fn() };
    const gate = createChipQuotaGate({ chip: null, pool: qdb, logger });

    expect(await gate.reserve(3)).toEqual({ status: "unidentified" });
    expect(await gate.reserve(2)).toEqual({ status: "unidentified" });

    expect(gate.unidentifiedMessages).toBe(5);
    expect(logger.warn).toHaveBeenCalledTimes(1); // um aviso por disparo, não um por mensagem
    expect((await qdb.query("SELECT count(*)::int AS n FROM evolution_instance_daily_usage")).rows[0].n).toBe(0);
  }, SLOW);

  it("só a igualdade EXATA da URL identifica a instância no envio manual/direto (nada de aproximação)", () => {
    const instancias = [chipRow(), outroChip()];

    expect(findInstanceByWebhookUrl(instancias, "https://evolution.teste/message/sendText/chip-1")?.id).toBe(CHIP);
    expect(findInstanceByWebhookUrl(instancias, "https://evolution.teste/message/sendText/chip-1/")).toBeNull();
    expect(findInstanceByWebhookUrl(instancias, "https://evolution.teste/message/sendText/chip")).toBeNull();
    expect(findInstanceByWebhookUrl(instancias, "")).toBeNull();
    expect(findInstanceByWebhookUrl(null, "x")).toBeNull();
  });
});

describe("[TESTE OBRIGATÓRIO] o contador de uso diário reflete campanha e 'enviados hoje' bate com os envios reais", () => {
  it("depois de um disparo, 'enviados hoje' na tela de chips (a função real) é igual às mensagens que de fato saíram", async () => {
    const qdb = await bancoDeCota();
    const w = await mundoDeDisparo({ qdb, nLeads: 2, nPassos: 2 });

    await w.routes.runCampaignDispatch({ dispatch: w.dispatch, campaign: w.campaign, supabase: w.supabase });

    const instancias = await getLeadClientEvolutionInstances(TENANT, qdb);
    const doChip = instancias.find((i) => i.id === CHIP);
    expect(Number(doChip.sent_count_today)).toBe(mensagensEnviadas());
    expect(Number(doChip.sent_count_today)).toBe(4);
  }, SLOW);

  it("follow-up e campanha somam no MESMO contador (mesma unidade, mesmo chip)", async () => {
    const qdb = await bancoDeCota();
    await ensureEvolutionInstanceDailyUsageTable(qdb);
    await reserveChipDailyQuota(CHIP, DIA_HOJE, qdb); // o que o follow-up faz: 1 mensagem
    const w = await mundoDeDisparo({ qdb, nLeads: 1, nPassos: 2 });

    await w.routes.runCampaignDispatch({ dispatch: w.dispatch, campaign: w.campaign, supabase: w.supabase });

    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(3);
  }, SLOW);
});

describe("[TESTE OBRIGATÓRIO] a previsão de término do lote usa o contador correto", () => {
  it("lote de 20 leads pendentes, chip frio (cota 50): com 45 mensagens de campanha hoje o fim passa para outro dia; com 0, termina hoje", async () => {
    const { estimateDispatchCompletion } = await import("../services/campaignDispatchSummary.js");
    const qdb = await bancoDeCota();
    await qdb.query("UPDATE lead_client_evolution_instances SET chip_state='cold' WHERE id=$1", [CHIP]);
    await ensureEvolutionInstanceDailyUsageTable(qdb);

    const lerChip = async () => (await getLeadClientEvolutionInstances(TENANT, qdb)).find((i) => i.id === CHIP);
    const antes = await lerChip();
    const gate = createChipQuotaGate({ chip: antes, timezone: "America/Sao_Paulo", pool: qdb, clock: () => HOJE });
    expect((await gate.reserve(45)).status).toBe("reserved");
    const depois = await lerChip();

    const dias = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const etaCom = (chip) => estimateDispatchCompletion({ pendingLeads: 20, dailyLimit: 50, sentToday: Number(chip.sent_count_today), windowDays: dias, windowEnd: "20:00", now: HOJE });
    expect(Number(antes.sent_count_today)).toBe(0);
    expect(Number(depois.sent_count_today)).toBe(45);
    expect(etaCom(antes).isToday).toBe(true); // contador vazio: "termina hoje"
    expect(etaCom(depois).isToday).toBe(false); // contador com a campanha: sobra 5 hoje, o resto fica para outro dia
  }, SLOW);

  it("pela ROTA real do resumo: a previsão lê o contador do banco (sent_count_today) com a campanha incluída", async () => {
    const qdb = await bancoDeCota();
    await qdb.query("UPDATE lead_client_evolution_instances SET chip_state='cold' WHERE id=$1", [CHIP]);
    await ensureEvolutionInstanceDailyUsageTable(qdb);
    const gate = createChipQuotaGate({ chip: { id: CHIP, name: "Chip", chip_state: "cold", daily_limit_override: null }, pool: qdb, clock: () => HOJE });
    expect((await gate.reserve(45)).status).toBe("reserved");

    const grouped = [{
      campaign_id: "camp-1", campaign_name: "Campanha", lote_count: 1, sent_total: 0, failed_total: 0, leads_total: 20, leads_pending: 20,
      leads_pause_target: 0, leads_resume_target: 0, leads_cancel_target: 0, statuses: ["scheduled"], evolution_instance_id: CHIP,
      next_scheduled_at: null, last_updated_at: HOJE.toISOString(),
    }];
    const pool = { query: vi.fn(async (sql) => (String(sql).includes("GROUP BY d.campaign_id, c.name") ? { rows: grouped } : { rows: [] })) };
    const routes = {};
    const app = { get: (p, ...h) => { routes[`get ${p}`] = h[h.length - 1]; }, post() {}, put() {}, patch() {}, delete() {}, use() {} };
    registerCampaignsRoutes(app, {
      CAMPAIGN_SCHEDULER_MAX_BATCH: 10, buildDispatchLeads: async () => [], canCampaignBeDispatched: () => true,
      checkEvolutionInstanceHealth: async () => ({}), continueCampaignLeadFromReply: async () => {}, ensureDb: () => true,
      executeCampaignDispatch: async () => {}, findCampaignReplyMatches: async () => [], getClientName: async () => "T",
      getLeadClientEvolutionInstances: (clientId) => getLeadClientEvolutionInstances(clientId, qdb), // a função REAL, no banco real
      getLeadClientN8nSettings: async () => ({ send_window_days: ["dom", "seg", "ter", "qua", "qui", "sex", "sab"], send_window_end: "20:00" }),
      getRequestId: () => "r", getSafeDispatchSettingsLog: () => ({}), internalErrorPayloadDetails: () => ({}),
      isMissingSchemaError: () => false, isProduction: false, logCampaignReplyFlow: () => {}, logDirectDispatch: () => {},
      maskPhoneForLog: (p) => p, normalizeIsoDate: (d) => d, leadsTableName: "lead_import_items",
      normalizeString: (s) => String(s || "").trim(), normalizeTenantKey: (s) => String(s || "").trim(), parseOptionalUuid: (s) => s,
      pgDatabasePool: pool, requireAppViewAccess: () => (q, r, n) => n(), requireCampaignDispatchAccess: (q, r, n) => n(),
      requireFirebaseAuth: (q, r, n) => n(), requireInternalPageAccess: () => (q, r, n) => n(), resolveAuthorizedClientId: () => TENANT,
      resolveCampaignDispatchSettings: async () => ({}), resolveDispatchWebhookSettings: async () => ({}), runDueCampaignDispatches: async () => {},
      sanitizePhone: (p) => p, sendError: vi.fn(), supabase: null, validateN8nInboundBearer: () => true,
    });
    const res = { statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } };

    await routes["get /api/campaigns/dispatch-summary"]({ query: { clientId: TENANT, scope: "active" } }, res);

    const campanha = res.body.campaigns[0];
    expect(campanha.chipName).toBe("Chip Principal");
    expect(campanha.eta.isToday).toBe(false); // 45 de 50 já usados por campanha hoje: não termina hoje
  }, SLOW);
});

describe("os outros dois chamadores de dispatchCampaignSequence: envio direto e envio manual", () => {
  function reqRes(body) {
    const req = { body, query: {}, headers: {}, authAccess: { uid: "u", email: "e@x" } };
    const res = {
      statusCode: 200, body: null, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(s) { this.statusCode = s; return this; },
      json(b) { this.body = b; return this; },
    };
    return { req, res };
  }

  async function registrar(qdb, { webhookUrl, chip = chipRow(), source = "client_settings" } = {}) {
    const routes = {};
    const app = { get() {}, put() {}, patch() {}, delete() {}, use() {}, post: (p, ...h) => { routes[`post ${p}`] = h[h.length - 1]; } };
    const sendError = vi.fn((res, status, code, message, details) => { res.statusCode = status; res.body = { error: { code, message, details } }; });
    const url = webhookUrl ?? chip.dispatch_webhook_url;
    registerCampaignsRoutes(app, {
      CAMPAIGN_SCHEDULER_MAX_BATCH: 10,
      buildDispatchLeads: async () => [{ id: "lead-1", nome: "Ana", telefone: "5511999990001", client_id: TENANT }],
      canCampaignBeDispatched: () => true, checkEvolutionInstanceHealth: async () => ({ state: "open" }),
      continueCampaignLeadFromReply: async () => {}, ensureDb: () => true, executeCampaignDispatch: async () => {},
      findCampaignReplyMatches: async () => [], getClientName: async () => "T",
      getLeadClientEvolutionInstances: async () => [outroChip(), chip],
      getLeadClientN8nSettings: async () => ({}),
      getRequestId: () => "req-1", getSafeDispatchSettingsLog: () => ({}), internalErrorPayloadDetails: () => ({}),
      isMissingSchemaError: () => false, isProduction: false, logCampaignReplyFlow: () => {}, logDirectDispatch: () => {},
      maskPhoneForLog: (p) => p, normalizeIsoDate: (d) => d, leadsTableName: "lead_import_items",
      normalizeString: (s) => String(s || "").trim(), normalizeTenantKey: (s) => String(s || "").trim(), parseOptionalUuid: (s) => s,
      pgDatabasePool: { query: (sql, params) => qdb.query(sql, params) },
      requireAppViewAccess: () => (q, r, n) => n(), requireCampaignDispatchAccess: (q, r, n) => n(),
      requireFirebaseAuth: (q, r, n) => n(), requireInternalPageAccess: () => (q, r, n) => n(), resolveAuthorizedClientId: () => TENANT,
      resolveCampaignDispatchSettings: async () => ({}),
      resolveDispatchWebhookSettings: async () => ({ webhookUrl: url, webhookToken: "secret", source }),
      runDueCampaignDispatches: async () => {}, sanitizePhone: (p) => String(p || ""), sendError,
      supabase: null, validateN8nInboundBearer: () => true,
    });
    return { routes, sendError };
  }

  const DIRETO = { clientId: TENANT, phone: "5511999990001", text: "Oi, tudo bem?" };
  const MANUAL = { clientId: TENANT, importId: "imp-1", message: "Oi, tudo bem?", limit: 5 };

  it("[envio direto] reserva 1 unidade no chip cujo webhook é a URL usada e envia", async () => {
    const qdb = await bancoDeCota();
    const { routes } = await registrar(qdb);
    const { req, res } = reqRes({ ...DIRETO });

    await routes["post /api/campaigns/direct-dispatch"](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.successCount).toBe(1);
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(1);
    expect(await usoDoChip(qdb, OUTRO_CHIP, DIA_HOJE)).toBe(0);
  }, SLOW);

  it("[envio direto] cota esgotada responde 429 CHIP_QUOTA_EXHAUSTED e NÃO envia", async () => {
    const qdb = await bancoDeCota();
    const { routes, sendError } = await registrar(qdb, { chip: chipRow({ daily_limit_override: 1 }) });
    await ensureEvolutionInstanceDailyUsageTable(qdb);
    await reserveChipDailyQuota(CHIP, DIA_HOJE, qdb, 1);
    const { req, res } = reqRes({ ...DIRETO });

    await routes["post /api/campaigns/direct-dispatch"](req, res);

    expect(sendError).toHaveBeenCalledWith(res, 429, "CHIP_QUOTA_EXHAUSTED", "Pausado — cota diária do chip atingida (1/1). Retoma amanhã.", expect.anything());
    expect(mensagensEnviadas()).toBe(0);
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(1);
  }, SLOW);

  it("[envio direto] URL que não é de instância cadastrada: envia, sem debitar ninguém, e registra", async () => {
    const qdb = await bancoDeCota();
    const { routes } = await registrar(qdb, { webhookUrl: "https://evolution.teste/message/sendText/config-do-tenant" });
    const { req, res } = reqRes({ ...DIRETO });

    await routes["post /api/campaigns/direct-dispatch"](req, res);

    expect(res.statusCode).toBe(200);
    expect(mensagensEnviadas()).toBe(1);
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(0);
  }, SLOW);

  it("[envio manual] reserva por mensagem e envia", async () => {
    const qdb = await bancoDeCota();
    const { routes } = await registrar(qdb);
    const { req, res } = reqRes({ ...MANUAL });

    await routes["post /api/n8n-dispatches"](req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.successCount).toBe(1);
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(1);
  }, SLOW);

  it("[envio manual] cota esgotada responde 429 CHIP_QUOTA_EXHAUSTED e NÃO envia", async () => {
    const qdb = await bancoDeCota();
    const { routes, sendError } = await registrar(qdb, { chip: chipRow({ daily_limit_override: 1 }) });
    await ensureEvolutionInstanceDailyUsageTable(qdb);
    await reserveChipDailyQuota(CHIP, DIA_HOJE, qdb, 1);
    const { req, res } = reqRes({ ...MANUAL });

    await routes["post /api/n8n-dispatches"](req, res);

    expect(sendError).toHaveBeenCalledWith(res, 429, "CHIP_QUOTA_EXHAUSTED", expect.stringContaining("cota diária do chip atingida"), expect.objectContaining({ successCount: 0 }));
    expect(mensagensEnviadas()).toBe(0);
  }, SLOW);
});

describe("[TESTE OBRIGATÓRIO] a regra de rajada: a cota reserva só o que sai agora (passos after_reply não contam)", () => {
  const passo = (n, triggerMode = "immediate") => ({ id: `s${n}`, type: "text", text: `Mensagem ${n}`, order: n, enabled: true, triggerMode, delayAfterSeconds: 0 });
  const MANUAL_COM = (sequence) => ({ clientId: TENANT, importId: "imp-1", analyticsMeta: { sequence }, limit: 5 });

  // o envio MANUAL passa a sequência CRUA (o direto monta só passos imediatos: texto e imagem)
  async function manual(qdb, sequence, { chip = chipRow({ chip_state: "cold" }), usoInicial = 0 } = {}) {
    if (usoInicial > 0) {
      await ensureEvolutionInstanceDailyUsageTable(qdb);
      await reserveChipDailyQuota(CHIP, DIA_HOJE, qdb, usoInicial);
    }
    const routes = {};
    const app = { get() {}, put() {}, patch() {}, delete() {}, use() {}, post: (p, ...h) => { routes[`post ${p}`] = h[h.length - 1]; } };
    const sendError = vi.fn((res, status, code, message, details) => { res.statusCode = status; res.body = { error: { code, message, details } }; });
    registerCampaignsRoutes(app, {
      CAMPAIGN_SCHEDULER_MAX_BATCH: 10, buildDispatchLeads: async () => [{ id: "lead-1", nome: "Ana", telefone: "5511999990001", client_id: TENANT }],
      canCampaignBeDispatched: () => true, checkEvolutionInstanceHealth: async () => ({ state: "open" }), continueCampaignLeadFromReply: async () => {},
      ensureDb: () => true, executeCampaignDispatch: async () => {}, findCampaignReplyMatches: async () => [], getClientName: async () => "T",
      getLeadClientEvolutionInstances: async () => [outroChip(), chip], getLeadClientN8nSettings: async () => ({}),
      getRequestId: () => "r", getSafeDispatchSettingsLog: () => ({}), internalErrorPayloadDetails: () => ({}), isMissingSchemaError: () => false,
      isProduction: false, logCampaignReplyFlow: () => {}, logDirectDispatch: () => {}, maskPhoneForLog: (p) => p, normalizeIsoDate: (d) => d,
      leadsTableName: "lead_import_items", normalizeString: (x) => String(x || "").trim(), normalizeTenantKey: (x) => String(x || "").trim(),
      parseOptionalUuid: (x) => x, pgDatabasePool: { query: (sql, params) => qdb.query(sql, params) },
      requireAppViewAccess: () => (q, r, n) => n(), requireCampaignDispatchAccess: (q, r, n) => n(), requireFirebaseAuth: (q, r, n) => n(),
      requireInternalPageAccess: () => (q, r, n) => n(), resolveAuthorizedClientId: () => TENANT, resolveCampaignDispatchSettings: async () => ({}),
      resolveDispatchWebhookSettings: async () => ({ webhookUrl: chip.dispatch_webhook_url, webhookToken: "secret", source: "client_settings" }),
      runDueCampaignDispatches: async () => {}, sanitizePhone: (x) => String(x || ""), sendError, supabase: null, validateN8nInboundBearer: () => true,
    });
    const res = { statusCode: 200, body: null, headers: {}, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await routes["post /api/n8n-dispatches"]({ body: MANUAL_COM(sequence), query: {}, headers: {}, authAccess: { uid: "u", email: "e@x" } }, res);
    return { res, sendError };
  }

  it("1 passo imediato + 2 'after_reply': reserva 1, não 3, e só 1 mensagem sai", async () => {
    const qdb = await bancoDeCota();

    const { res } = await manual(qdb, [passo(1), passo(2, "after_reply"), passo(3, "after_reply")]);

    expect(res.statusCode).toBe(200);
    expect(mensagensEnviadas()).toBe(1);
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(1);
  }, SLOW);

  it("48 de 50 usados nessa mesma sequência: envia e NÃO pausa (reservar 3 estouraria; reservar 1 cabe)", async () => {
    const qdb = await bancoDeCota();

    const { res, sendError } = await manual(qdb, [passo(1), passo(2, "after_reply"), passo(3, "after_reply")], { usoInicial: 48 });

    expect(sendError).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.successCount).toBe(1);
    expect(mensagensEnviadas()).toBe(1);
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(49);
  }, SLOW);

  it("sequência só de passos imediatos: reserva todos", async () => {
    const qdb = await bancoDeCota();

    await manual(qdb, [passo(1), passo(2), passo(3)]);

    expect(mensagensEnviadas()).toBe(3);
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(3);
  }, SLOW);

  it("o PRIMEIRO passo sai mesmo sendo 'after_reply' (a rajada só termina a partir do segundo)", async () => {
    const qdb = await bancoDeCota();

    await manual(qdb, [passo(1, "after_reply"), passo(2, "after_reply")]);

    expect(mensagensEnviadas()).toBe(1);
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(1);
  }, SLOW);

  it("envio direto monta só passos imediatos (texto + imagem): reserva as 2", async () => {
    const qdb = await bancoDeCota();
    const routes = {};
    const app = { get() {}, put() {}, patch() {}, delete() {}, use() {}, post: (p, ...h) => { routes[`post ${p}`] = h[h.length - 1]; } };
    registerCampaignsRoutes(app, {
      CAMPAIGN_SCHEDULER_MAX_BATCH: 10, buildDispatchLeads: async () => [], canCampaignBeDispatched: () => true,
      checkEvolutionInstanceHealth: async () => ({ state: "open" }), continueCampaignLeadFromReply: async () => {}, ensureDb: () => true,
      executeCampaignDispatch: async () => {}, findCampaignReplyMatches: async () => [], getClientName: async () => "T",
      getLeadClientEvolutionInstances: async () => [outroChip(), chipRow()], getLeadClientN8nSettings: async () => ({}), getRequestId: () => "r",
      getSafeDispatchSettingsLog: () => ({}), internalErrorPayloadDetails: () => ({}), isMissingSchemaError: () => false, isProduction: false,
      logCampaignReplyFlow: () => {}, logDirectDispatch: () => {}, maskPhoneForLog: (p) => p, normalizeIsoDate: (d) => d,
      leadsTableName: "lead_import_items", normalizeString: (x) => String(x || "").trim(), normalizeTenantKey: (x) => String(x || "").trim(),
      parseOptionalUuid: (x) => x, pgDatabasePool: { query: (sql, params) => qdb.query(sql, params) },
      requireAppViewAccess: () => (q, r, n) => n(), requireCampaignDispatchAccess: (q, r, n) => n(), requireFirebaseAuth: (q, r, n) => n(),
      requireInternalPageAccess: () => (q, r, n) => n(), resolveAuthorizedClientId: () => TENANT, resolveCampaignDispatchSettings: async () => ({}),
      resolveDispatchWebhookSettings: async () => ({ webhookUrl: chipRow().dispatch_webhook_url, webhookToken: "secret", source: "client_settings" }),
      runDueCampaignDispatches: async () => {}, sanitizePhone: (x) => String(x || ""), sendError: vi.fn(), supabase: null, validateN8nInboundBearer: () => true,
    });
    const res = { statusCode: 200, body: null, headers: {}, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    const image = { name: "x.png", type: "image/png", size: 10, dataUrl: "data:image/png;base64,iVBORw0KGgo=" };

    await routes["post /api/campaigns/direct-dispatch"]({ body: { clientId: TENANT, phone: "5511999990001", text: "Oi", image }, query: {}, headers: {}, authAccess: { uid: "u" } }, res);

    expect(res.statusCode).toBe(200);
    expect(mensagensEnviadas()).toBe(2);
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(2);
  }, SLOW);

  it("disparo pós-resposta (isReplyTrigger): os passos 'after_reply' SAEM, então a cota reserva todos", async () => {
    const qdb = await bancoDeCota();
    const gate = createChipQuotaGate({ chip: chipRow({ chip_state: "cold" }), pool: qdb, clock: () => HOJE });

    await dispatchCampaignSequence({
      webhookUrl: "https://evolution.teste/message/sendText/chip-1", webhookToken: "t", quotaGate: gate, leadDelayProvider: () => 0,
      leads: [{ id: "lead-1", nome: "Ana", telefone: "5511999990001" }], context: { isReplyTrigger: true },
      analyticsMeta: { sequence: [passo(1), passo(2, "after_reply"), passo(3, "after_reply")] },
    });

    expect(mensagensEnviadas()).toBe(3);
    expect(await usoDoChip(qdb, CHIP, DIA_HOJE)).toBe(3);
  }, SLOW);

  it("o laço de envio e a conta da cota leem a MESMA função (uma condição só, sem cópia)", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const src = readFileSync(resolve("src/campaign-outbound.js"), "utf8");

    // a condição de parada existe uma única vez, dentro de endsBurst; laço e contagem a chamam
    expect(src.match(/triggerMode === "after_reply" && !isReplyTrigger/g)).toHaveLength(1);
    expect(src).toMatch(/if \(endsBurst\(stepIndex, step, Boolean\(context\?\.isReplyTrigger\)\)\)/);
    expect(src).toMatch(/if \(endsBurst\(i, enabledSteps\[i\], isReplyTrigger\)\) break;/);
    // e as duas respondem igual
    const seq = [passo(1), passo(2, "after_reply")];
    expect(countBurstSteps(seq)).toBe(1);
    expect(countBurstSteps(seq, true)).toBe(2);
    expect(endsBurst(0, passo(1, "after_reply"))).toBe(false);
    expect(endsBurst(1, passo(2, "after_reply"))).toBe(true);
    expect(endsBurst(1, passo(2, "after_reply"), true)).toBe(false);
  });
});

describe("[TESTE OBRIGATÓRIO] cota que NÃO PODE SER LIDA não derruba o disparo (o incidente de 05/10/2026)", () => {
  it("o contador estoura (ex.: 'operator does not exist: uuid = text'): o lote ENVIA tudo, sem cota, com o erro registrado", async () => {
    const qdb = await bancoDeCota();
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = await mundoDeDisparo({ qdb, nLeads: 2, nPassos: 2, falhaNaCota: "operator does not exist: uuid = text" });

    await w.routes.runCampaignDispatch({ dispatch: w.dispatch, campaign: w.campaign, supabase: w.supabase });

    expect(mensagensEnviadas()).toBe(4); // enviou tudo
    expect(w.estado.sent.map((s) => s.leadId)).toEqual(["lead-1", "lead-2"]);
    expect(w.dispatch.status).toBe("done"); // não pausou, não falhou
    const aviso = erro.mock.calls.find((c) => String(c[0]).includes("cota indisponível: o envio SEGUE sem cota"));
    expect(aviso?.[1]).toMatchObject({ instanceId: CHIP, error: "operator does not exist: uuid = text" });
    const resumo = erro.mock.calls.find((c) => String(c[0]).includes("mensagens enviadas sem cota (cota indisponível"));
    expect(resumo?.[1]).toMatchObject({ dispatchId: "disp-1", mensagens: 4 });
  }, SLOW);

  it("depois de uma falha o portão não insiste a cada lead (backoff) e volta a tentar depois", async () => {
    const calls = [];
    const pool = { query: vi.fn(async (sql) => { calls.push(String(sql).slice(0, 20)); throw new Error("banco fora"); }) };
    let agora = HOJE.getTime();
    const gate = createChipQuotaGate({ chip: chipRow(), pool, clock: () => new Date(agora), logger: { warn() {}, error() {} } });

    await gate.reserve(2);
    const tentativasNaPrimeira = pool.query.mock.calls.length;
    await gate.reserve(2);
    await gate.reserve(2);
    expect(pool.query.mock.calls.length).toBe(tentativasNaPrimeira); // dentro do backoff: nenhuma consulta nova
    expect(gate.unavailableMessages).toBe(6);

    agora += 61_000; // passou o backoff
    await gate.reserve(2);
    expect(pool.query.mock.calls.length).toBeGreaterThan(tentativasNaPrimeira);
  }, SLOW);

  it("mesmo um portão que LANÇA (defeito inesperado) não derruba o laço de envio", async () => {
    const aviso = vi.spyOn(console, "error").mockImplementation(() => {});
    const gateQuebrado = { reserve: async () => { throw new Error("defeito inesperado no portão"); }, unidentifiedMessages: 0, unavailableMessages: 0 };

    const { summary } = await dispatchCampaignSequence({
      webhookUrl: "https://evolution.teste/message/sendText/chip-1", webhookToken: "t", quotaGate: gateQuebrado, leadDelayProvider: () => 0,
      leads: [{ id: "lead-1", nome: "Ana", telefone: "5511999990001" }, { id: "lead-2", nome: "Bia", telefone: "5511999990002" }],
      analyticsMeta: { sequence: [{ id: "s1", type: "text", text: "Oi", order: 1, enabled: true, triggerMode: "immediate", delayAfterSeconds: 0 }] },
    });

    expect(summary.successCount).toBe(2);
    expect(summary.allChipsExhausted).toBe(false);
    expect(mensagensEnviadas()).toBe(2);
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining("falha inesperada no portão de cota"), expect.objectContaining({ error: "defeito inesperado no portão" }));
  }, SLOW);

  it("'esgotada' continua pausando o lote (erro de infraestrutura e esgotada são tratados à parte)", async () => {
    const qdb = await bancoDeCota();
    const w = await mundoDeDisparo({ qdb, nLeads: 2, nPassos: 2, chip: chipRow({ daily_limit_override: 3 }) });

    await w.routes.runCampaignDispatch({ dispatch: w.dispatch, campaign: w.campaign, supabase: w.supabase });

    expect(w.dispatch.status).toBe("paused");
    expect(w.dispatch.error_message).toBe("Pausado — cota diária do chip atingida (3/3). Retoma amanhã.");
  }, SLOW);
});
