import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Mocks para followup/db.js e followup/queue.js — mesmo padrão de followupTimingAndAnchor.test.js
vi.mock("../followup/db.js", () => {
  const queryMock = vi.fn();
  const supabaseMock = {
    from: vi.fn(),
  };
  return {
    query: queryMock,
    getSupabase: () => supabaseMock,
  };
});

vi.mock("../followup/queue.js", () => ({
  getFollowupQueue: () => ({
    add: vi.fn().mockResolvedValue({ id: "job-bull-1" }),
  }),
}));

import {
  calcScheduledFor,
  validateTemplatePayload,
  enrollLead,
} from "../followup/service.js";
import { getPartsInTimezone } from "../services/sendWindow.js";
import { query as mockQuery, getSupabase as mockGetSupabase } from "../followup/db.js";
import { registerFollowupRoutes } from "../followup/routes.js";

describe("Etapa 5 Commit 2 — Follow-up: trigger_type 'fixed_date'", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateTemplatePayload", () => {
    it("rejeita fixed_date sem scheduled_date", () => {
      const r = validateTemplatePayload({ trigger_type: "fixed_date" });
      expect(r.valid).toBe(false);
      expect(r.code).toBe("INVALID_SCHEDULED_DATE");
    });

    it("rejeita fixed_date com scheduled_date em formato inválido", () => {
      const r = validateTemplatePayload({ trigger_type: "fixed_date", scheduled_date: "25/12/2026" });
      expect(r.valid).toBe(false);
      expect(r.code).toBe("INVALID_SCHEDULED_DATE");
    });

    it("aceita fixed_date com scheduled_date YYYY-MM-DD", () => {
      const r = validateTemplatePayload({ trigger_type: "fixed_date", scheduled_date: "2026-12-25" });
      expect(r.valid).toBe(true);
    });
  });

  describe("calcScheduledFor — fixed_date", () => {
    it("com scheduled_time preenchido: agenda no dia exato, na hora exata, em America/Sao_Paulo", () => {
      const template = {
        id: "tpl-fixed-1",
        trigger_type: "fixed_date",
        scheduled_date: "2026-12-25",
        scheduled_time: "10:00",
      };
      const now = new Date("2026-09-15T12:00:00-03:00");

      const sched = calcScheduledFor(template, now, null, {});
      expect(sched).not.toBeNull();

      const parts = getPartsInTimezone(sched, "America/Sao_Paulo");
      expect(parts.year).toBe(2026);
      expect(parts.month).toBe(12);
      expect(parts.day).toBe(25);
      expect(parts.hour).toBe(10);
      expect(parts.minute).toBe(0);
    });

    it("sem scheduled_time: usa resolveSendWindowConfig(tenantSettings).start (padrão real 08:00), não um literal chumbado", () => {
      const template = {
        id: "tpl-fixed-2",
        trigger_type: "fixed_date",
        scheduled_date: "2026-12-25",
        scheduled_time: null,
      };
      const now = new Date("2026-09-15T12:00:00-03:00");

      // tenantSettings ausente -> resolveSendWindowConfig cai no DEFAULT_SEND_WINDOW (start: "08:00")
      const sched = calcScheduledFor(template, now, null, {}, { tenantSettings: null });
      const parts = getPartsInTimezone(sched, "America/Sao_Paulo");
      expect(parts.hour).toBe(8);
      expect(parts.minute).toBe(0);

      // Com sendWindowConfig customizado por tenant, respeita o start daquele tenant (não 08:00 chumbado)
      const schedCustom = calcScheduledFor(template, now, null, {}, {
        sendWindowConfig: { start: "13:30", end: "20:00", days: ["mon","tue","wed","thu","fri","sat","sun"], timezone: "America/Sao_Paulo" },
      });
      const partsCustom = getPartsInTimezone(schedCustom, "America/Sao_Paulo");
      expect(partsCustom.hour).toBe(13);
      expect(partsCustom.minute).toBe(30);
    });

    it("scheduled_date inválido ou ausente retorna null (passo cai em skippedSteps a montante)", () => {
      expect(calcScheduledFor({ trigger_type: "fixed_date", scheduled_date: null }, new Date(), null, {})).toBeNull();
      expect(calcScheduledFor({ trigger_type: "fixed_date", scheduled_date: "data-invalida" }, new Date(), null, {})).toBeNull();
    });

    // BUG #2 do relatório de revisão: node-postgres devolve coluna DATE como Date à
    // meia-noite UTC (sem setTypeParser no projeto). Ler essa Date em
    // getPartsInTimezone("America/Sao_Paulo") jogava pro dia anterior (meia-noite UTC
    // = 21h do dia 24 em SP), e reschedulePendingJobsForTemplate já usa select("*"),
    // que devolve Date de verdade — não string. Reproduz exatamente o caso do relatório.
    it("com scheduled_date vindo do Postgres como Date (meia-noite UTC): preserva o dia de calendário, não vira o dia anterior em SP", () => {
      const template = {
        id: "tpl-fixed-pg-date",
        trigger_type: "fixed_date",
        scheduled_date: new Date("2026-12-25T00:00:00.000Z"),
        scheduled_time: "10:00",
      };
      const now = new Date("2026-09-15T12:00:00-03:00");

      const sched = calcScheduledFor(template, now, null, {});
      expect(sched).not.toBeNull();

      const parts = getPartsInTimezone(sched, "America/Sao_Paulo");
      expect(parts.day).toBe(25);
      expect(parts.month).toBe(12);
      expect(parts.year).toBe(2026);
      expect(parts.hour).toBe(10);
    });
  });

  describe("enrollLead — fixed_date fim a fim (dia certo, e passado cai em skippedSteps)", () => {
    function mockCampaignTenant(tenantId = "geracao-digital") {
      mockQuery.mockImplementation(async (sql) => {
        if (sql.includes("INSERT INTO followup_schedules")) {
          return { rows: [{ id: "sched-fixed-1" }] };
        }
        if (sql.includes("FROM followup_companies")) {
          return { rows: [{ tenant_id: tenantId }] };
        }
        if (sql.includes("INSERT INTO followup_jobs")) {
          return { rows: [{ id: "job-fixed-1" }] };
        }
        if (sql.includes("UPDATE followup_jobs")) {
          return { rows: [] };
        }
        return { rows: [] };
      });
    }

    // BUG #1 do relatório de revisão: o SELECT de enrollLead não trazia scheduled_date.
    // Um mock que injeta scheduled_date direto no objeto resolvido por .order() NÃO pega
    // esse bug (o mock não filtra colunas pelo argumento de .select() — sempre devolve o
    // objeto inteiro que foi programado, com ou sem a coluna na string do select real).
    // Por isso este teste inspeciona o argumento passado a .select() diretamente — é a
    // única forma de fechar a classe inteira desse erro (mesma forma do bug do
    // aniversário na Etapa 2B, que também escapava de testes com template injetado).
    it("enrollLead: o SELECT de templates inclui scheduled_date — sem essa coluna, todo passo fixed_date cai em skippedSteps/no_date em produção mesmo com dado correto no banco", async () => {
      mockCampaignTenant();

      const selectSpy = vi.fn().mockReturnThis();
      const supabase = mockGetSupabase();
      supabase.from.mockReturnValue({
        select: selectSpy,
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      });

      const campaign = { id: "camp-select-check", company_id: "comp-1" };
      await enrollLead(campaign, { lead_name: "Checagem de Select", phone: "5534999990099" });

      expect(selectSpy).toHaveBeenCalled();
      const selectArg = selectSpy.mock.calls[0][0];
      expect(selectArg).toContain("scheduled_date");
    });

    it("data fixa no futuro: enfileira no dia certo e horário certo", async () => {
      mockCampaignTenant();

      const supabase = mockGetSupabase();
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [
            {
              id: "step-fixed-future",
              name: "Promoção de Fim de Ano",
              order_index: 0,
              trigger_type: "fixed_date",
              scheduled_date: "2026-12-25",
              scheduled_time: "10:00",
              is_active: true,
            },
          ],
          error: null,
        }),
      });

      const campaign = { id: "camp-fixed-1", company_id: "comp-1" };
      const result = await enrollLead(campaign, {
        lead_name: "Lead Data Fixa",
        phone: "5534999990000",
      });

      expect(result.enqueued).toBe(1);
      expect(result.skippedSteps).toEqual([]);

      // A data efetivamente gravada no INSERT INTO followup_jobs precisa cair em 25/12/2026 10:00 America/Sao_Paulo
      const insertCall = mockQuery.mock.calls.find(([sql]) => sql.includes("INSERT INTO followup_jobs"));
      expect(insertCall).toBeTruthy();
      const [, params] = insertCall;
      const scheduledForIso = params[2];
      const parts = getPartsInTimezone(new Date(scheduledForIso), "America/Sao_Paulo");
      expect(parts.year).toBe(2026);
      expect(parts.month).toBe(12);
      expect(parts.day).toBe(25);
      expect(parts.hour).toBe(10);
    });

    it("data fixa no passado: cai em skippedSteps com reason 'past_date', e NÃO enfileira", async () => {
      mockCampaignTenant();

      const supabase = mockGetSupabase();
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [
            {
              id: "step-fixed-past",
              name: "Campanha Já Passou",
              order_index: 0,
              trigger_type: "fixed_date",
              scheduled_date: "2020-01-01",
              scheduled_time: "10:00",
              is_active: true,
            },
          ],
          error: null,
        }),
      });

      const campaign = { id: "camp-fixed-2", company_id: "comp-1" };
      const result = await enrollLead(campaign, {
        lead_name: "Lead Data Passada",
        phone: "5534999990001",
      });

      expect(result.enqueued).toBe(0);
      expect(result.skippedSteps).toHaveLength(1);
      expect(result.skippedSteps[0]).toMatchObject({
        stepId: "step-fixed-past",
        reason: "past_date",
      });

      const insertCall = mockQuery.mock.calls.find(([sql]) => sql.includes("INSERT INTO followup_jobs"));
      expect(insertCall).toBeUndefined();
    });

    it("cadência mista (data fixa passada + passo relativo válido): o passado é ignorado, o outro passo continua agendado", async () => {
      mockCampaignTenant();

      const supabase = mockGetSupabase();
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [
            {
              id: "step-past",
              name: "Data Fixa Passada",
              order_index: 0,
              trigger_type: "fixed_date",
              scheduled_date: "2020-01-01",
              scheduled_time: "10:00",
              is_active: true,
            },
            {
              id: "step-valido",
              name: "Lembrete Padrão",
              order_index: 1,
              trigger_type: "after_enrollment",
              trigger_value: 1,
              trigger_unit: "days",
              is_active: true,
            },
          ],
          error: null,
        }),
      });

      const campaign = { id: "camp-fixed-3", company_id: "comp-1" };
      const result = await enrollLead(campaign, {
        lead_name: "Lead Cadência Mista",
        phone: "5534999990002",
      });

      expect(result.enqueued).toBe(1);
      expect(result.skippedSteps).toHaveLength(1);
      expect(result.skippedSteps[0].stepId).toBe("step-past");
      expect(result.skippedSteps[0].reason).toBe("past_date");

      const insertCalls = mockQuery.mock.calls.filter(([sql]) => sql.includes("INSERT INTO followup_jobs"));
      expect(insertCalls).toHaveLength(1);
    });
  });

  // BUG #3 do relatório de revisão: GET /api/followup/templates também não trazia
  // scheduled_date. Consequência em cadeia: o drawer reabre o passo com data vazia e,
  // ao salvar, manda scheduled_date: null — a validação mesclada rejeita com 400
  // INVALID_SCHEDULED_DATE. Editar um passo de data fixa dava erro.
  describe("Rota HTTP — ida e volta: cria com data fixa, relê pelo GET, confere que voltou", () => {
    function getRouteHandler(routePath, method) {
      let followupRouter = null;
      const fakeApp = {
        use: (path, router) => {
          if (path === "/api/followup") followupRouter = router;
        },
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
      };
      const noop = (req, res, next) => next?.();
      registerFollowupRoutes(fakeApp, noop, () => noop, noop);
      expect(followupRouter).toBeDefined();
      const layer = followupRouter.stack.find(
        (l) => l.route && l.route.path === routePath && l.route.methods[method]
      );
      expect(layer, `rota ${method.toUpperCase()} ${routePath} não encontrada`).toBeDefined();
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }

    function fakeRes() {
      return {
        statusCode: 200,
        status(s) { this.statusCode = s; return this; },
        json: vi.fn(),
      };
    }

    it("POST cria passo fixed_date e o GET subsequente devolve scheduled_date preenchido", async () => {
      const postHandler = getRouteHandler("/templates", "post");
      const getHandler = getRouteHandler("/templates", "get");

      const supabase = mockGetSupabase();

      // 1. POST /templates — Supabase confirma o insert devolvendo o registro completo.
      const insertMaybeSingle = vi.fn().mockResolvedValue({
        data: {
          id: "tpl-roundtrip-1",
          campaign_id: "camp-roundtrip",
          trigger_type: "fixed_date",
          scheduled_date: "2026-12-25",
          scheduled_time: "10:00",
        },
        error: null,
      });
      supabase.from.mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: insertMaybeSingle,
      });

      const postReq = {
        body: {
          campaign_id: "camp-roundtrip",
          name: "Promoção de Natal",
          message: "Feliz Natal!",
          trigger_type: "fixed_date",
          scheduled_date: "2026-12-25",
          scheduled_time: "10:00",
        },
      };
      const postRes = fakeRes();
      await postHandler(postReq, postRes);
      expect(postRes.statusCode).toBe(201);
      expect(postRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          template: expect.objectContaining({ scheduled_date: "2026-12-25" }),
        })
      );

      // 2. GET /templates — relê pelo endpoint (não do valor devolvido pelo POST).
      supabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [
            {
              id: "tpl-roundtrip-1",
              campaign_id: "camp-roundtrip",
              trigger_type: "fixed_date",
              scheduled_date: "2026-12-25",
              scheduled_time: "10:00",
            },
          ],
          error: null,
        }),
      });

      const getReq = { query: { campaignId: "camp-roundtrip" } };
      const getRes = fakeRes();
      await getHandler(getReq, getRes);

      expect(getRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          templates: [expect.objectContaining({ id: "tpl-roundtrip-1", scheduled_date: "2026-12-25" })],
        })
      );
    });

    it("GET /templates: o SELECT inclui scheduled_date (sem isso, editar um passo de data fixa reabre com data vazia e o PATCH quebra com 400)", async () => {
      const getHandler = getRouteHandler("/templates", "get");
      const selectSpy = vi.fn().mockReturnThis();
      const supabase = mockGetSupabase();
      supabase.from.mockReturnValue({
        select: selectSpy,
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      });

      await getHandler({ query: { campaignId: "camp-x" } }, fakeRes());

      expect(selectSpy).toHaveBeenCalled();
      expect(selectSpy.mock.calls[0][0]).toContain("scheduled_date");
    });
  });

  // Mesma classe de bug do #1/#3, achada ao investigar: clonar uma cadência remonta
  // os templates campo a campo (não é select("*") -> insert direto), e scheduled_date
  // estava fora dessa lista — clonar uma cadência com passo de data fixa perdia a data
  // silenciosamente (vira NULL, sem violar a CHECK constraint, sem erro visível).
  describe("Clonagem de cadência preserva scheduled_date", () => {
    it("o mapeamento de clonagem (templatesToInsert) inclui scheduled_date", () => {
      const fonte = readFileSync(resolve("src/followup/routes.js"), "utf8");
      const inicio = fonte.indexOf("const templatesToInsert = templates.map((tpl) => ({");
      expect(inicio, "mapeamento de clonagem não encontrado").toBeGreaterThan(-1);
      const fim = fonte.indexOf("}));", inicio);
      const trecho = fonte.slice(inicio, fim);
      expect(trecho).toContain("scheduled_date: tpl.scheduled_date");
    });
  });
});
