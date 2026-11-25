// PR 10a do untangle: portão de envio de campanha (campaign/sendGate.js) e a primeira porta ligada nele,
// POST /api/n8n-dispatches ("envio manual"), que até aqui saía fora da janela e, com importId vazio, para a base inteira.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { evaluateCampaignSendGate, evaluateDirectSendGate, hasExplicitSendSource, SEND_GATE_POLICY } from "../campaign/sendGate.js";
import { evaluateManualSendWindow as viaRotas, registerCampaignsRoutes } from "../domains/campaigns/routes.js";
import { evaluateManualSendWindow } from "../campaign/sendGate.js";

const TENANT = "tenant-porta";
// 25/11/2026 é quarta-feira; horários fixos em São Paulo (UTC-3)
const QUARTA_15H_SP = "2026-11-25T18:00:00Z";
const QUARTA_21H_SP = "2026-11-26T00:00:00Z";
const JANELA = { send_window_enabled: true, send_window_start: "08:00", send_window_end: "20:00", send_window_days: ["seg", "ter", "qua", "qui", "sex"], send_window_timezone: "America/Sao_Paulo" };

describe("evaluateCampaignSendGate: na dúvida, não envia", () => {
  it("política declarada", () => {
    expect(SEND_GATE_POLICY).toBe("na_duvida_nao_envia");
  });

  it("origem vazia recusa (vazio seria a base inteira); origem dita de propósito passa", () => {
    for (const vazio of [undefined, null, "", "   ", [], ["", " "]]) expect(hasExplicitSendSource(vazio)).toBe(false);
    for (const ok of ["imp-1", "__all__", "__crm__", ["imp-1"]]) expect(hasExplicitSendSource(ok)).toBe(true);
    const r = evaluateCampaignSendGate({ now: new Date(QUARTA_15H_SP), settings: JANELA, importSelection: "" });
    expect(r).toMatchObject({ allowed: false, status: 422, code: "SEND_WITHOUT_SOURCE" });
  });

  it("dentro da janela passa; fora recusa com a próxima abertura", () => {
    expect(evaluateCampaignSendGate({ now: new Date(QUARTA_15H_SP), settings: JANELA, importSelection: "imp-1" })).toMatchObject({ allowed: true, forced: false });
    const fora = evaluateCampaignSendGate({ now: new Date(QUARTA_21H_SP), settings: JANELA, importSelection: "imp-1" });
    expect(fora).toMatchObject({ allowed: false, status: 422, code: "OUTSIDE_SEND_WINDOW" });
    expect(fora.details.nextOpening).toBeTruthy();
  });

  it("forçar fora da janela só com o booleano true", () => {
    expect(evaluateCampaignSendGate({ now: new Date(QUARTA_21H_SP), settings: JANELA, importSelection: "imp-1", forceOutsideWindow: "true" }).allowed).toBe(false);
    expect(evaluateCampaignSendGate({ now: new Date(QUARTA_21H_SP), settings: JANELA, importSelection: "imp-1", forceOutsideWindow: true })).toMatchObject({ allowed: true, forced: true });
  });

  it("configuração vazia usa a janela padrão (08–20, seg–sex): não manda de madrugada", () => {
    expect(evaluateCampaignSendGate({ now: new Date(QUARTA_21H_SP), settings: {}, importSelection: "imp-1" }).allowed).toBe(false);
  });

  it("a regra da janela é uma só: a rota reexporta a do portão", () => {
    expect(viaRotas).toBe(evaluateManualSendWindow);
  });
});

function montar({ settings = JANELA, settingsFalha = false } = {}) {
  const routes = {};
  const app = { get() {}, put() {}, patch() {}, delete() {}, use() {}, post: (p, ...h) => { routes[p] = h[h.length - 1]; } };
  const buildDispatchLeads = vi.fn(async () => []);
  const resolveDispatchWebhookSettings = vi.fn(async () => ({ webhookUrl: "https://evo.teste/message/sendText/x", webhookToken: "t" }));
  const sendError = vi.fn((res, status, code, message, details) => { res.statusCode = status; res.body = { error: { code, message, details } }; });
  registerCampaignsRoutes(app, {
    CAMPAIGN_SCHEDULER_MAX_BATCH: 10, buildDispatchLeads, canCampaignBeDispatched: () => true,
    checkEvolutionInstanceHealth: async () => ({ state: "open" }), continueCampaignLeadFromReply: async () => {},
    ensureDb: () => true, executeCampaignDispatch: async () => {}, findCampaignReplyMatches: async () => [],
    getClientName: async () => "T", getLeadClientEvolutionInstances: async () => [],
    getLeadClientN8nSettings: async () => { if (settingsFalha) throw new Error("db fora"); return settings; },
    getRequestId: () => "req", getSafeDispatchSettingsLog: () => ({}), internalErrorPayloadDetails: () => ({}),
    isMissingSchemaError: () => false, isProduction: false, logCampaignReplyFlow: () => {}, logDirectDispatch: () => {},
    maskPhoneForLog: (p) => p, normalizeIsoDate: (d) => d, leadsTableName: "lead_import_items",
    normalizeString: (s) => String(s ?? "").trim(), normalizeTenantKey: (s) => String(s || "").trim(), parseOptionalUuid: (s) => ({ value: s }),
    pgDatabasePool: null, requireAppViewAccess: () => (q, r, n) => n(), requireCampaignDispatchAccess: (q, r, n) => n(),
    requireFirebaseAuth: (q, r, n) => n(), requireInternalPageAccess: () => (q, r, n) => n(), resolveAuthorizedClientId: () => TENANT,
    resolveCampaignDispatchSettings: async () => ({}), resolveDispatchWebhookSettings, runDueCampaignDispatches: async () => {},
    sanitizePhone: (p) => p, sendError, supabase: null, validateN8nInboundBearer: () => true,
  });
  const direto = async (body) => {
    const res = { statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } };
    await routes["/api/campaigns/direct-dispatch"]({ body: { clientId: TENANT, phone: "5511999990001", text: "Oi", ...body }, query: {}, headers: {}, authAccess: { uid: "u", email: "e@x" } }, res);
    return res;
  };
  const chamar = async (body) => {
    const res = { statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } };
    await routes["/api/n8n-dispatches"]({ body: { clientId: TENANT, message: "Oi", ...body }, query: {}, headers: {}, authAccess: { uid: "u", email: "e@x" } }, res);
    return res;
  };
  return { chamar, direto, buildDispatchLeads, resolveDispatchWebhookSettings };
}

describe("[OBRIGATÓRIO] POST /api/n8n-dispatches atravessa o portão", () => {
  it("fora da janela: 422 OUTSIDE_SEND_WINDOW e nem monta a fila", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(QUARTA_21H_SP));
    try {
      const w = montar();
      const res = await w.chamar({ importId: "imp-1" });
      expect(res.statusCode).toBe(422);
      expect(res.body.error.code).toBe("OUTSIDE_SEND_WINDOW");
      expect(w.buildDispatchLeads).not.toHaveBeenCalled();
      expect(w.resolveDispatchWebhookSettings).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("importId vazio: 422 SEND_WITHOUT_SOURCE, não vira a base inteira", async () => {
    const w = montar({ settings: { send_window_enabled: false } });
    const res = await w.chamar({ importId: "" });
    expect(res.statusCode).toBe(422);
    expect(res.body.error.code).toBe("SEND_WITHOUT_SOURCE");
    expect(w.buildDispatchLeads).not.toHaveBeenCalled();
  });

  it("janela ilegível (leitura falhou): 500 e nada sai", async () => {
    const w = montar({ settingsFalha: true });
    const res = await w.chamar({ importId: "imp-1" });
    expect(res.statusCode).toBe(500);
    expect(w.buildDispatchLeads).not.toHaveBeenCalled();
  });

  it("dentro da janela e com origem: segue para montar a fila com a origem pedida", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(QUARTA_15H_SP));
    try {
      const w = montar();
      const res = await w.chamar({ importId: "imp-1" });
      expect(w.buildDispatchLeads).toHaveBeenCalledWith(expect.objectContaining({ clientId: TENANT, importId: "imp-1" }));
      expect(res.body.error.code).toBe("NO_DISPATCH_LEADS");
    } finally {
      vi.useRealTimers();
    }
  });

  it("forçado fora da janela (true): segue e registra no log", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(QUARTA_21H_SP));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const w = montar();
      await w.chamar({ importId: "imp-1", forceOutsideWindow: true });
      expect(w.buildDispatchLeads).toHaveBeenCalled();
      expect(warn.mock.calls.some((c) => String(c[0]).includes("envio_manual_forcado_fora_da_janela"))).toBe(true);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("a rota chama o portão antes do webhook", () => {
    const rotas = readFileSync(resolve("src/domains/campaigns/routes.js"), "utf8");
    const ini = rotas.indexOf('"/api/n8n-dispatches"');
    const trecho = rotas.slice(ini, ini + 4000);
    expect(trecho.indexOf("evaluateCampaignSendGate(")).toBeGreaterThan(0);
    expect(trecho.indexOf("evaluateCampaignSendGate(")).toBeLessThan(trecho.indexOf("resolveDispatchWebhookSettings("));
  });
});

describe("[OBRIGATÓRIO] POST /api/campaigns/direct-dispatch atravessa o portão (PR 10c)", () => {
  it("evaluateDirectSendGate: dentro passa, fora recusa, forçar só com true", () => {
    expect(evaluateDirectSendGate({ now: new Date(QUARTA_15H_SP), settings: JANELA }).allowed).toBe(true);
    expect(evaluateDirectSendGate({ now: new Date(QUARTA_21H_SP), settings: JANELA })).toMatchObject({ allowed: false, code: "OUTSIDE_SEND_WINDOW" });
    expect(evaluateDirectSendGate({ now: new Date(QUARTA_21H_SP), settings: JANELA, forceOutsideWindow: "true" }).allowed).toBe(false);
    expect(evaluateDirectSendGate({ now: new Date(QUARTA_21H_SP), settings: JANELA, forceOutsideWindow: true })).toMatchObject({ allowed: true, forced: true });
  });

  it("fora da janela: 422 e nem lê o webhook", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(QUARTA_21H_SP));
    try {
      const w = montar();
      const res = await w.direto({});
      expect(res.statusCode).toBe(422);
      expect(res.body.error.code).toBe("OUTSIDE_SEND_WINDOW");
      expect(w.resolveDispatchWebhookSettings).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("janela ilegível: 500 e nem lê o webhook", async () => {
    const w = montar({ settingsFalha: true });
    const res = await w.direto({});
    expect(res.statusCode).toBe(500);
    expect(w.resolveDispatchWebhookSettings).not.toHaveBeenCalled();
  });

  it("dentro da janela: segue para o webhook", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(QUARTA_15H_SP));
    try {
      const w = montar();
      await w.direto({}).catch(() => {});
      expect(w.resolveDispatchWebhookSettings).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("forçado fora da janela (true): segue para o webhook", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(QUARTA_21H_SP));
    try {
      const w = montar();
      await w.direto({ forceOutsideWindow: true }).catch(() => {});
      expect(w.resolveDispatchWebhookSettings).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
