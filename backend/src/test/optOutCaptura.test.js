// backend/src/test/optOutCaptura.test.js
//
// Captura do pedido de saída na mensagem do lead (services/optOutCapture.js), com as regras do dono de 12/11/2026.
//
// Os textos são os REAIS da medição E em produção (12/11/2026): os dois pedidos de verdade têm de capturar; os falsos
// positivos que a lista larga pegava não podem capturar.
//
// Postgres real (pglite) com as migrations do follow-up + a da fonte única. Dublê só no que sai do processo: fila (Redis),
// HTTP da Evolution, configurações do tenant e lista de chips.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEAD_PHONE, asPool, tolerantPool, getDb, setupFollowupReplyDb, closeFollowupReplyDb } from "./helpers/followupReplyDb.js";

vi.mock("../followup/db.js", async () => {
  const h = await import("./helpers/followupReplyDb.js");
  return { getPool: () => h.asPool(), query: (sql, params) => h.asPool().query(sql, params), getSupabase: () => ({}) };
});
vi.mock("../followup/queue.js", () => ({
  QUEUE_NAME: "followup-messages",
  getRedisConnection: () => ({}),
  getFollowupQueue: () => ({ add: vi.fn(async () => ({ id: "bull-1" })) }),
}));

import { registerChatbotRoutes } from "../domains/chatbot/routes.js";
import { isPhoneOptedOut, revokeOptOut } from "../services/optOut.js";
import { captureOptOutFromInbound, detectOptOutRequest, isSdrPhone } from "../services/optOutCapture.js";

const MIGRATION = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations", "20261112010000_lead_optouts_fonte_unica.sql");
const TENANT = "t-a";

// Medição E, 12/11/2026.
const REAL_SEM_INTERESSE_1 = "Muito obrigado não tenho interesse";
const REAL_SEM_INTERESSE_2 = "Não tenho interesse, obrigado.";
const REAL_FALSO_BLOQUEAR = "Tudo ajuda a não bloquear";
const REAL_FALSO_AGENDA = "Meu irmão, você só me lembra na véspera, tá? Porque eu tô fora aqui e não mandei pra agenda, você me lembra pra colocar na agenda, tá?";
const REAL_ASAAS = [
  "Não enviei nenhum arquivo. Só expliquei que sou o assistente financeiro do Asaas: posso ajudar você a consultar saldo, criar cobranças e fazer pagamentos ou Pix. Não contrato publicidade.",
  "Obrigado, Container LED! Não tenho interesse em contratar publicidade. Estou à disposição para ajudar com as finanças da sua conta Asaas.",
  "Olá! Obrigado pela oferta, mas não tenho interesse em contratar publicidade. Estou à disposição para ajudar com as finanças da Container LED no Asaas.",
];

describe("detectOptOutRequest (função pura)", () => {
  it("[OBRIGATÓRIO] os dois pedidos reais da medição capturam como 'sem_interesse'", () => {
    expect(detectOptOutRequest(REAL_SEM_INTERESSE_1)).toEqual({ source: "sem_interesse", reason: "nao tenho interesse" });
    expect(detectOptOutRequest(REAL_SEM_INTERESSE_2)).toEqual({ source: "sem_interesse", reason: "nao tenho interesse" });
  });

  it("[OBRIGATÓRIO] os falsos positivos reais da medição NÃO capturam", () => {
    expect(detectOptOutRequest(REAL_FALSO_BLOQUEAR)).toBeNull();
    expect(detectOptOutRequest(REAL_FALSO_AGENDA)).toBeNull();
    for (const texto of REAL_ASAAS) expect(detectOptOutRequest(texto), texto).toBeNull();
  });

  it("palavra sozinha captura como 'palavra', com maiúscula, pontuação, espaço e emoji em volta", () => {
    for (const texto of ["sair", "Parar", "PARE", "stop", "Cancelar.", "descadastrar", "  parar!!  ", "Sair 🙏", "*STOP*", "parar\n"]) {
      expect(detectOptOutRequest(texto)?.source, texto).toBe("palavra");
    }
    expect(detectOptOutRequest("Parar!")).toEqual({ source: "palavra", reason: "parar" });
  });

  it("palavra dentro de frase NÃO captura (só a mensagem inteira)", () => {
    for (const texto of [
      "pode parar de enrolar e mandar o preço",
      "quero parar de pagar aluguel",
      "vou sair agora, falo depois",
      "como faço para cancelar o pedido?",
      "parar sair",
      "para",
      "paro",
    ]) {
      expect(detectOptOutRequest(texto), texto).toBeNull();
    }
  });

  it("frase larga NÃO captura: bloquear, não mande, tirar da lista, denunciar", () => {
    for (const texto of [
      "Pode bloquear então",
      "nao ta bloqueando",
      "não me mande mais mensagem",
      "me tira da lista",
      "remova meu número",
      "vou denunciar",
      "pare de me mandar mensagem",
      "não quero mais",
    ]) {
      expect(detectOptOutRequest(texto), texto).toBeNull();
    }
  });

  it("'sem interesse' e 'não tenho interesse' só em mensagem de até 60 caracteres", () => {
    expect(detectOptOutRequest("sem interesse")?.source).toBe("sem_interesse");
    expect(detectOptOutRequest("Obrigada, no momento não tenho interesse")?.source).toBe("sem_interesse");
    expect(detectOptOutRequest("NAO TENHO INTERESSE")?.source).toBe("sem_interesse");

    const com60 = "não tenho interesse" + ".".repeat(41);
    const com61 = "não tenho interesse" + ".".repeat(42);
    expect([...com60]).toHaveLength(60);
    expect(detectOptOutRequest(com60)?.source).toBe("sem_interesse");
    expect(detectOptOutRequest(com61)).toBeNull();
  });

  it("não confunde com quem TEM interesse nem com palavra parecida", () => {
    for (const texto of ["tenho interesse", "Tenho interesse sim, me conta mais", "sem interesses ocultos", "", "   ", null, undefined]) {
      expect(detectOptOutRequest(texto), String(texto)).toBeNull();
    }
  });
});

describe("isSdrPhone", () => {
  it("reconhece o número SDR em qualquer grafia, pela lista nova e pela coluna antiga", () => {
    expect(isSdrPhone({ sdr_whatsapp_numbers: ["34991093607"] }, "5534991093607")).toBe(true);
    expect(isSdrPhone({ sdr_whatsapp_numbers: ["5534991093607"] }, "553491093607@s.whatsapp.net")).toBe(true);
    expect(isSdrPhone({ sdr_whatsapp_number: "5534991093607" }, "34991093607")).toBe(true);
    expect(isSdrPhone({ sdr_whatsapp_numbers: ["5534988880001"] }, "5534991093607")).toBe(false);
    expect(isSdrPhone({}, "5534991093607")).toBe(false);
    expect(isSdrPhone(null, "5534991093607")).toBe(false);
  });
});

describe("com banco: captureOptOutFromInbound e o webhook de entrada", () => {
  beforeEach(async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    await setupFollowupReplyDb();
    await getDb().exec(`
      CREATE TABLE public.leads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, telefone text, opt_out boolean DEFAULT false,
        metadata jsonb DEFAULT '{}'::jsonb, dados jsonb DEFAULT '{}'::jsonb, updated_at timestamptz DEFAULT now()
      );
    `);
    await getDb().exec(await readFile(MIGRATION, "utf8"));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await closeFollowupReplyDb();
  });

  const linhas = async () => (await getDb().query("SELECT client_id, phone, source, reason, wa_message_id, message_text, revoked_at FROM lead_optouts ORDER BY optout_at")).rows;
  const semSdr = async () => ({});

  it("grava o pedido na fonte única com origem, motivo, id e texto da mensagem", async () => {
    const r = await captureOptOutFromInbound(asPool(), { clientId: TENANT, phone: `${LEAD_PHONE}@s.whatsapp.net`, text: REAL_SEM_INTERESSE_2, waMessageId: "WA-9", getTenantSettings: semSdr });
    expect(r).toMatchObject({ captured: true, source: "sem_interesse" });
    expect(await linhas()).toEqual([
      { client_id: TENANT, phone: LEAD_PHONE, source: "sem_interesse", reason: "nao tenho interesse", wa_message_id: "WA-9", message_text: REAL_SEM_INTERESSE_2, revoked_at: null },
    ]);
  });

  it("[OBRIGATÓRIO] número da lista SDR nunca é capturado", async () => {
    const r = await captureOptOutFromInbound(asPool(), {
      clientId: TENANT, phone: LEAD_PHONE, text: "parar", getTenantSettings: async () => ({ sdr_whatsapp_numbers: ["34991093607"] }),
    });
    expect(r).toEqual({ captured: false, skipped: "sdr_number" });
    expect(await linhas()).toHaveLength(0);
  });

  it("sem conseguir ler a lista SDR, não captura (não dá para garantir a regra)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await captureOptOutFromInbound(asPool(), {
      clientId: TENANT, phone: LEAD_PHONE, text: "parar", getTenantSettings: async () => { throw new Error("settings fora do ar"); },
    });
    expect(r).toEqual({ captured: false, skipped: "settings_unavailable" });
    expect(await linhas()).toHaveLength(0);
    errSpy.mockRestore();
  });

  it("mensagem comum não lê configuração nem grava; erro de banco não derruba quem chama", async () => {
    const getTenantSettings = vi.fn(semSdr);
    expect(await captureOptOutFromInbound(asPool(), { clientId: TENANT, phone: LEAD_PHONE, text: REAL_FALSO_BLOQUEAR, getTenantSettings })).toEqual({ captured: false });
    expect(getTenantSettings).not.toHaveBeenCalled();

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const quebrado = { query: async () => { throw new Error("connection terminated unexpectedly"); } };
    expect(await captureOptOutFromInbound(quebrado, { clientId: TENANT, phone: LEAD_PHONE, text: "sair", getTenantSettings: semSdr })).toEqual({ captured: false, skipped: "error" });
    errSpy.mockRestore();
  });

  function setupWebhook({ findCampaignReplyMatches, settings = {} }) {
    const routes = {};
    const register = (method) => vi.fn((p, ...handlers) => { routes[`${method} ${p}`] = handlers[handlers.length - 1]; });
    const app = { post: register("POST"), get: register("GET"), delete: register("DELETE"), put: register("PUT"), patch: register("PATCH") };
    const chain = () => {
      const c = {
        select: vi.fn(() => c), eq: vi.fn(() => c), in: vi.fn(() => c), gte: vi.fn(() => c), is: vi.fn(() => c),
        order: vi.fn(() => c), limit: vi.fn(() => c),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        single: vi.fn(async () => ({ data: null, error: null })),
        then: (resolve) => resolve({ data: [], error: null }),
      };
      return c;
    };
    const supabase = {
      from: vi.fn(() => ({
        ...chain(),
        insert: vi.fn(async (payload) => ({ data: payload, error: null })),
        update: vi.fn(() => ({ eq: vi.fn(() => ({ in: vi.fn(async () => ({})), is: vi.fn(async () => ({})) })) })),
      })),
    };
    registerChatbotRoutes(app, {
      ensureDb: () => true,
      getLeadClientEvolutionInstances: async () => [],
      getLeadClientN8nSettings: async (clientId) => ({ clientId, chatbot_enabled: false, ...settings }),
      internalErrorPayloadDetails: () => ({}),
      isMissingSchemaError: () => false,
      leadsTableName: (c) => `leads_${c}`,
      maskPhoneForLog: (p) => p,
      MAX_LEADS_OUTLIER_BATCH: 100,
      continueCampaignLeadFromReply: vi.fn(),
      findCampaignReplyMatches,
      normalizeString: (s) => (s ? String(s).trim() : ""),
      normalizeTenantKey: (k) => (k ? String(k).trim() : ""),
      pgDatabasePool: tolerantPool(),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      requireFirebaseAuth: (_req, _res, next) => next(),
      resolveAuthorizedClientId: (_req, _res, cid) => cid,
      resolveDispatchWebhookSettings: async () => ({}),
      resolveInboundDispatchSettings: async () => ({}),
      sanitizePhone: (p) => String(p || "").replace(/@.*$/, "").replace(/\D/g, ""),
      sendError: vi.fn(),
      supabase,
      validateLeadsOutlierRecord: () => true,
      validateN8nInboundBearer: () => true,
    });
    return routes["POST /api/hardcoded-chat-webhook"];
  }

  const inbound = (id, text, { fromMe = false, clientId = TENANT } = {}) => {
    const body = {
      event: "messages.upsert", phone: LEAD_PHONE, instance: "Chip 1",
      data: { key: { remoteJid: `${LEAD_PHONE}@s.whatsapp.net`, fromMe, id }, message: { conversation: text }, messageTimestamp: 1788212600 },
    };
    if (clientId) body.clientId = clientId;
    return { body, query: {} };
  };

  async function call(handler, req) {
    let out = null;
    await handler(req, { json: vi.fn((d) => { out = d; }), status: vi.fn(function () { return this; }) });
    return out;
  }

  const semCampanha = () => vi.fn(async () => ({ matches: [], waitForReplyMatches: [], processingWaitForReplyMatches: [], activePeriodCampaign: null }));

  it("[OBRIGATÓRIO] webhook: 'não tenho interesse' real grava o pedido e a PRÓPRIA mensagem já não chega em campanha nem em agente", async () => {
    const findCampaignReplyMatches = semCampanha();
    const handler = setupWebhook({ findCampaignReplyMatches });

    const out = await call(handler, inbound("WA-REAL-1", REAL_SEM_INTERESSE_1));

    expect(out).toMatchObject({ success: true, status: "skipped_opt_out" });
    expect(findCampaignReplyMatches).not.toHaveBeenCalled();
    const rows = await linhas();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ client_id: TENANT, phone: LEAD_PHONE, source: "sem_interesse", wa_message_id: "WA-REAL-1" });
    expect(globalThis.fetch).not.toHaveBeenCalled(); // sem mensagem de confirmação, sem envio nenhum
  });

  it("[OBRIGATÓRIO] webhook: palavra sozinha grava com origem 'palavra' e a mensagem seguinte do lead também fica sem robô", async () => {
    const findCampaignReplyMatches = semCampanha();
    const handler = setupWebhook({ findCampaignReplyMatches });

    await call(handler, inbound("WA-P-1", "PARAR"));
    const depois = await call(handler, inbound("WA-P-2", "oi, tudo bem?"));

    expect((await linhas()).map((l) => l.source)).toEqual(["palavra"]);
    expect(depois).toMatchObject({ status: "skipped_opt_out" });
    expect(findCampaignReplyMatches).not.toHaveBeenCalled();
  });

  it("[OBRIGATÓRIO] webhook: os falsos positivos reais não gravam nada e a mensagem segue o fluxo normal", async () => {
    const findCampaignReplyMatches = semCampanha();
    const handler = setupWebhook({ findCampaignReplyMatches });

    let n = 0;
    for (const texto of [REAL_FALSO_BLOQUEAR, REAL_FALSO_AGENDA, ...REAL_ASAAS]) {
      n += 1;
      const out = await call(handler, inbound(`WA-FP-${n}`, texto));
      expect(out?.status, texto).not.toBe("skipped_opt_out");
    }
    expect(await linhas()).toHaveLength(0);
    expect(findCampaignReplyMatches).toHaveBeenCalledTimes(n);
  });

  it("webhook: número SDR, mensagem nossa (fromMe) e webhook sem empresa explícita não capturam", async () => {
    const comSdr = setupWebhook({ findCampaignReplyMatches: semCampanha(), settings: { sdr_whatsapp_numbers: [LEAD_PHONE] } });
    await call(comSdr, inbound("WA-SDR-1", "parar"));

    const normal = setupWebhook({ findCampaignReplyMatches: semCampanha() });
    await call(normal, inbound("WA-ME-1", "parar", { fromMe: true }));
    await call(normal, inbound("WA-SEM-1", "parar", { clientId: null }));

    expect(await linhas()).toHaveLength(0);
  });

  // Variante n8n: POST /api/campaigns/reply-webhook avança a campanha ali mesmo, antes de a mensagem chegar ao webhook
  // do chatbot. A captura tem de acontecer ANTES de continueCampaignLeadFromReply.
  it("[OBRIGATÓRIO] reply-webhook (n8n): o pedido é gravado ANTES de a campanha tentar avançar", async () => {
    const { registerCampaignsRoutes } = await import("../domains/campaigns/routes.js");
    const handlers = {};
    const guardar = (metodo) => (path, ...hs) => { handlers[`${metodo} ${path}`] = hs[hs.length - 1]; };
    const app = { get: guardar("GET"), post: guardar("POST"), put: guardar("PUT"), patch: guardar("PATCH"), delete: guardar("DELETE"), use() {} };
    const noop = () => {};
    const ordem = [];
    const continuar = vi.fn(async () => {
      ordem.push(`continue:optout=${await isPhoneOptedOut(asPool(), { clientId: TENANT, phone: LEAD_PHONE })}`);
      return { continued: false, reason: "opt_out" };
    });
    registerCampaignsRoutes(app, {
      CAMPAIGN_SCHEDULER_MAX_BATCH: 10, buildDispatchLeads: async () => [], canCampaignBeDispatched: () => true,
      checkEvolutionInstanceHealth: async () => ({ state: "open" }), continueCampaignLeadFromReply: continuar,
      ensureDb: () => true, executeCampaignDispatch: async () => {},
      findCampaignReplyMatches: async () => {
        ordem.push("find");
        const match = { id: "11111111-1111-4111-8111-111111111111", name: "Campanha" };
        return { matches: [match], waitForReplyMatches: [match], processingWaitForReplyMatches: [match], activePeriodCampaign: null };
      },
      getClientName: async () => "A", getLeadClientEvolutionInstances: async () => [],
      getLeadClientN8nSettings: async () => ({ send_window_enabled: false }), getRequestId: () => "req",
      getSafeDispatchSettingsLog: () => ({}), internalErrorPayloadDetails: () => ({}), isMissingSchemaError: () => false,
      isProduction: false, logCampaignReplyFlow: noop, logDirectDispatch: noop, maskPhoneForLog: (p) => p,
      normalizeIsoDate: (d) => d, leadsTableName: "lead_import_items", normalizeString: (s) => String(s ?? "").trim(),
      normalizeTenantKey: (s) => String(s || "").trim(), parseOptionalUuid: (s) => ({ value: s }), pgDatabasePool: tolerantPool(),
      requireAppViewAccess: () => (req, res, next) => next(), requireCampaignDispatchAccess: (req, res, next) => next(),
      requireFirebaseAuth: (req, res, next) => next(), requireInternalPageAccess: () => (req, res, next) => next(),
      resolveAuthorizedClientId: () => TENANT, resolveCampaignDispatchSettings: async () => ({}),
      resolveDispatchWebhookSettings: async () => ({}), runDueCampaignDispatches: async () => {},
      sanitizePhone: (p) => String(p || "").replace(/@.*$/, "").replace(/\D/g, ""),
      sendError: (res, s, c, m) => res.status(s).json({ error: { code: c, message: m } }), supabase: null,
      validateN8nInboundBearer: async () => true,
    });
    const handler = handlers["POST /api/campaigns/reply-webhook"];
    const res = { status() { return this; }, json() { return this; } };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await handler({
      body: { clientId: TENANT, phone: LEAD_PHONE, data: { key: { id: "WA-N8N-1", remoteJid: `${LEAD_PHONE}@s.whatsapp.net` }, message: { conversation: REAL_SEM_INTERESSE_2 } } },
      query: {}, params: {}, headers: {},
    }, res).catch(() => {});

    const rows = await linhas();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ client_id: TENANT, phone: LEAD_PHONE, source: "sem_interesse" });
    // quando a campanha tentou avançar, o pedido já estava gravado
    expect(ordem).toEqual(["find", "continue:optout=true"]);
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("desfeito (revogado), o número volta ao fluxo normal e um novo pedido cria outra linha", async () => {
    const findCampaignReplyMatches = semCampanha();
    const handler = setupWebhook({ findCampaignReplyMatches });
    await call(handler, inbound("WA-R-1", "sair"));
    await revokeOptOut(asPool(), { clientId: TENANT, phone: LEAD_PHONE, revokedBy: "operador" });
    expect(await isPhoneOptedOut(asPool(), { clientId: TENANT, phone: LEAD_PHONE })).toBe(false);

    await call(handler, inbound("WA-R-2", "voltei, quero saber mais"));
    expect(findCampaignReplyMatches).toHaveBeenCalledTimes(1);

    await call(handler, inbound("WA-R-3", REAL_SEM_INTERESSE_2));
    const rows = await linhas();
    expect(rows).toHaveLength(2);
    expect(rows.filter((l) => l.revoked_at === null).map((l) => l.source)).toEqual(["sem_interesse"]);
  });
});
