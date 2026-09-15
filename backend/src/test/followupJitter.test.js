import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Mesmo padrão de mocks de followupFixedDate.test.js
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
    getJob: vi.fn().mockResolvedValue(null),
  }),
}));

import { applyDispatchJitter, enrollLead, reschedulePendingJobsForTemplate } from "../followup/service.js";
import { adjustDateToSendWindow, createDateInTimezone, getPartsInTimezone } from "../services/sendWindow.js";
import { query as mockQuery, getSupabase as mockGetSupabase } from "../followup/db.js";
import { registerFollowupRoutes } from "../followup/routes.js";

// Janela custom só pra este teste de composição pura (não é a janela padrão real do
// tenant, que é 08:00-20:00 — ver DEFAULT_SEND_WINDOW em services/sendWindow.js).
// Usar 18:00 aqui deixa a prova de borda mais curta de configurar.
const JANELA_TESTE_18H = {
  start: "08:00",
  end: "18:00",
  days: ["mon", "tue", "wed", "thu", "fri"],
  timezone: "America/Sao_Paulo",
};

describe("Etapa 5 Commit 3 — Jitter anti-ban (dispatch_jitter_minutes)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("applyDispatchJitter — função pura", () => {
    it("jitterMinutes 0 (ou ausente) não muda a data — mesmo timestamp", () => {
      const base = new Date("2026-09-15T14:00:00.000Z");
      expect(applyDispatchJitter(base, 0).getTime()).toBe(base.getTime());
      expect(applyDispatchJitter(base, null).getTime()).toBe(base.getTime());
      expect(applyDispatchJitter(base, undefined).getTime()).toBe(base.getTime());
      expect(applyDispatchJitter(base, -5).getTime()).toBe(base.getTime());
    });

    it("desloca SEMPRE para frente, nunca para trás, dentro de [0, jitterMinutes]", () => {
      const base = new Date("2026-09-15T14:00:00.000Z");
      // rng no piso: deslocamento 0 -> igual à base
      expect(applyDispatchJitter(base, 30, () => 0).getTime()).toBe(base.getTime());
      // rng no teto: deslocamento ~30min pra frente, nunca além
      const noTeto = applyDispatchJitter(base, 30, () => 0.999999);
      expect(noTeto.getTime()).toBeGreaterThan(base.getTime());
      expect(noTeto.getTime()).toBeLessThanOrEqual(base.getTime() + 30 * 60 * 1000);
    });

    it("com rng real (Math.random): 50 chamadas nunca produzem timestamp igual à base nem ultrapassam o teto", () => {
      const base = new Date("2026-09-15T14:00:00.000Z");
      for (let i = 0; i < 50; i++) {
        const j = applyDispatchJitter(base, 30);
        expect(j.getTime()).toBeGreaterThanOrEqual(base.getTime());
        expect(j.getTime()).toBeLessThanOrEqual(base.getTime() + 30 * 60 * 1000);
      }
    });

    // Prova de ORDEM: jitter tem que rodar ANTES de adjustDateToSendWindow. Se
    // rodasse depois, um horário jitterado pra fora da janela nunca seria corrigido
    // — cairia às 18:20 de terça em vez de pular pra abertura de quarta 08:00.
    it("composição jitter -> adjustDateToSendWindow: joga pra fora da janela, e é a janela que corrige (não o inverso)", () => {
      // Terça 17:50 em SP: dentro da janela (08:00-18:00), mas a poucos minutos do fim.
      const base = createDateInTimezone(2026, 9, 15, 17, 50, 0, "America/Sao_Paulo");
      const rngNoTeto = () => 0.999999; // deslocamento ~30min -> ~18:20, fora da janela
      const jittered = applyDispatchJitter(base, 30, rngNoTeto);
      const adjusted = adjustDateToSendWindow(jittered, JANELA_TESTE_18H);
      const parts = getPartsInTimezone(adjusted, "America/Sao_Paulo");

      // Empurrado pra abertura do PRÓXIMO dia útil (quarta 08:00), não pra 18:20 de terça.
      expect(parts.day).toBe(16);
      expect(parts.hour).toBe(8);
      expect(parts.minute).toBe(0);
    });
  });

  describe("enrollLead — jitter aplicado na inscrição em lote, inclusive no passo imediato (on_schedule)", () => {
    function mockCampaignTenant() {
      mockQuery.mockImplementation(async (sql) => {
        if (sql.includes("INSERT INTO followup_schedules")) return { rows: [{ id: "sched-jitter" }] };
        if (sql.includes("FROM followup_companies")) return { rows: [{ tenant_id: "geracao-digital" }] };
        if (sql.includes("INSERT INTO followup_jobs")) return { rows: [{ id: `job-${Math.random()}` }] };
        if (sql.includes("UPDATE followup_jobs")) return { rows: [] };
        return { rows: [] };
      });
    }

    function mockOnScheduleTemplate() {
      const supabase = mockGetSupabase();
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [
            {
              id: "step-imediato",
              name: "Boas-vindas",
              order_index: 0,
              trigger_type: "on_schedule",
              trigger_value: 0,
              trigger_unit: "days",
              is_active: true,
            },
          ],
          error: null,
        }),
      });
    }

    beforeEach(() => {
      // Terça 11:00 em SP — bem dentro da janela padrão 08:00-20:00, longe das bordas,
      // pra um jitter de até 30min nunca escapar da janela e confundir a asserção
      // de "diferença máxima" com um pulo pro dia seguinte.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-15T14:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("jitter 30min, 20 leads: scheduled_for não são idênticos, diferença máxima é 30min, e todos caem dentro da janela", async () => {
      mockCampaignTenant();
      mockOnScheduleTemplate();

      const campaign = { id: "camp-jitter-30", company_id: "comp-1", dispatch_jitter_minutes: 30 };

      const scheduledTimes = [];
      for (let i = 0; i < 20; i++) {
        await enrollLead(campaign, { lead_name: `Lead ${i}`, phone: `553499990${String(i).padStart(3, "0")}` });
        const insertCall = mockQuery.mock.calls
          .filter(([sql]) => sql.includes("INSERT INTO followup_jobs"))
          .at(-1);
        scheduledTimes.push(new Date(insertCall[1][2]));
      }

      // 1. Não são todos idênticos.
      const uniqueIso = new Set(scheduledTimes.map((d) => d.toISOString()));
      expect(uniqueIso.size).toBeGreaterThan(1);

      // 2. Diferença máxima entre o mais cedo e o mais tarde é <= 30min.
      const times = scheduledTimes.map((d) => d.getTime());
      const maxDiffMs = Math.max(...times) - Math.min(...times);
      expect(maxDiffMs).toBeLessThanOrEqual(30 * 60 * 1000);

      // 3. Todos caem dentro da janela padrão do tenant (08:00-20:00, dia útil).
      for (const d of scheduledTimes) {
        const parts = getPartsInTimezone(d, "America/Sao_Paulo");
        expect(parts.hour).toBeGreaterThanOrEqual(8);
        expect(parts.hour).toBeLessThan(20);
      }
    });

    // Prova de ORDEM dentro do próprio enrollLead (não só das funções puras isoladas):
    // inscrição às 19:50 de terça (dentro da janela padrão 08:00-20:00, a 10min do
    // fechamento) com jitter forçado pro teto (~30min) tem que resultar em ~20:19 ->
    // fora da janela -> a janela empurra pra abertura de quarta 08:00. Se a ordem
    // estivesse invertida (window antes do jitter), o adjustDateToSendWindow veria
    // 19:50 (dentro, no-op) e o jitter seria somado DEPOIS, sem correção — resultado
    // ficaria às ~20:19 de terça, fora do expediente. É o defeito que o revisor descreveu.
    it("inscrição a 10min do fechamento da janela + jitter no teto: resultado pula pra abertura do dia seguinte, não escapa da janela", async () => {
      vi.setSystemTime(new Date("2026-09-15T22:50:00Z")); // 19:50 em SP, terça
      const rngSpy = vi.spyOn(Math, "random").mockReturnValue(0.999999);
      try {
        mockCampaignTenant();
        mockOnScheduleTemplate();

        const campaign = { id: "camp-jitter-borda", company_id: "comp-1", dispatch_jitter_minutes: 30 };
        await enrollLead(campaign, { lead_name: "Lead Borda", phone: "5534999993000" });

        const insertCall = mockQuery.mock.calls.find(([sql]) => sql.includes("INSERT INTO followup_jobs"));
        const scheduledFor = new Date(insertCall[1][2]);
        const parts = getPartsInTimezone(scheduledFor, "America/Sao_Paulo");

        expect(parts.day).toBe(16); // quarta — empurrado pro dia seguinte
        expect(parts.hour).toBe(8); // abertura da janela, não 20:19 de terça
        expect(parts.minute).toBe(0);
      } finally {
        rngSpy.mockRestore();
      }
    });

    it("jitter 0 (campanha sem dispatch_jitter_minutes): não muda nada — todos os scheduled_for idênticos", async () => {
      mockCampaignTenant();
      mockOnScheduleTemplate();

      const campaign = { id: "camp-jitter-0", company_id: "comp-1" }; // sem dispatch_jitter_minutes

      const scheduledTimes = [];
      for (let i = 0; i < 5; i++) {
        await enrollLead(campaign, { lead_name: `Lead ${i}`, phone: `553499991${String(i).padStart(3, "0")}` });
        const insertCall = mockQuery.mock.calls
          .filter(([sql]) => sql.includes("INSERT INTO followup_jobs"))
          .at(-1);
        scheduledTimes.push(insertCall[1][2]);
      }

      const uniqueIso = new Set(scheduledTimes);
      expect(uniqueIso.size).toBe(1);
    });
  });

  describe("reschedulePendingJobsForTemplate — jitter também vale para reagendamento em massa", () => {
    it("busca dispatch_jitter_minutes da campanha do template e aplica no recálculo", async () => {
      mockQuery.mockImplementation(async (sql) => {
        if (sql.includes("SELECT fj.id, fj.schedule_id")) {
          return {
            rows: [
              {
                id: "job-resched-1",
                schedule_id: "sched-1",
                bull_job_id: null,
                scheduled_for: new Date("2026-09-10T14:00:00.000Z").toISOString(),
                custom_message: null,
                lead_name: "Lead Reagendado",
                phone: "5534999992000",
                meeting_datetime: null,
                schedule_created_at: new Date("2026-09-15T14:00:00.000Z").toISOString(),
                company_id: "comp-1",
                tenant_id: "geracao-digital",
              },
            ],
          };
        }
        if (sql.includes("UPDATE followup_jobs")) return { rows: [] };
        return { rows: [] };
      });

      const supabase = mockGetSupabase();
      supabase.from.mockImplementation((table) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(
          table === "followup_templates"
            ? {
                data: {
                  id: "tpl-resched",
                  campaign_id: "camp-resched",
                  trigger_type: "after_enrollment",
                  trigger_value: 1,
                  trigger_unit: "days",
                },
                error: null,
              }
            : table === "followup_campaigns"
            ? { data: { dispatch_jitter_minutes: 30 }, error: null }
            : { data: null, error: null }
        ),
      }));

      const res = await reschedulePendingJobsForTemplate("tpl-resched");
      expect(res.success).toBe(true);
      expect(res.rescheduledCount).toBe(1);

      // Confirma que a campanha foi consultada especificamente por dispatch_jitter_minutes
      const campaignSelectCall = supabase.from.mock.calls.find(([table]) => table === "followup_campaigns");
      expect(campaignSelectCall, "reschedulePendingJobsForTemplate não consultou followup_campaigns").toBeTruthy();

      // Prova de verdade: o scheduled_for gravado tem que estar DESLOCADO do alvo
      // sem jitter (triggerAt + 1 dia = 2026-09-16T14:00:00Z, quarta 11:00 SP,
      // dentro da janela -> adjustDateToSendWindow não mexe), e dentro de [0, 30min]
      // à frente dele. Só checar que a tabela foi consultada não prova que o valor
      // usado mudou o resultado — é exatamente o tipo de mutação que passaria batido.
      const updateCall = mockQuery.mock.calls.find(([sql]) => sql.includes("UPDATE followup_jobs SET scheduled_for"));
      expect(updateCall, "UPDATE followup_jobs com scheduled_for não foi chamado").toBeTruthy();
      const actual = new Date(updateCall[1][0]);
      const expectedSemJitter = new Date("2026-09-16T14:00:00.000Z");

      expect(actual.getTime()).not.toBe(expectedSemJitter.getTime());
      expect(actual.getTime()).toBeGreaterThan(expectedSemJitter.getTime());
      expect(actual.getTime()).toBeLessThanOrEqual(expectedSemJitter.getTime() + 30 * 60 * 1000);
    });
  });

  describe("lembrete avulso NÃO recebe jitter (hora marcada é promessa)", () => {
    it("queueRoutes.js (PATCH /api/followup-queue/:scheduleId/reschedule) não referencia applyDispatchJitter", () => {
      const fonte = readFileSync(resolve("src/followup/queueRoutes.js"), "utf8");
      expect(fonte).not.toContain("applyDispatchJitter");
    });
  });

  // Achado do revisor: GET /api/followup/campaigns não trazia dispatch_jitter_minutes.
  // O input do CadenceEditor lê o valor da cadência carregada por ESSA rota (não pela
  // de enroll) — sem a coluna, a tela sempre abria em 0 mesmo com 30 gravado no banco,
  // e salvar de novo sobrescrevia o valor real com 0. O enroll (:799) já usava o select
  // certo, o que tornava o bug silencioso: o disparo funcionava, só a tela mentia.
  describe("GET /api/followup/campaigns traz dispatch_jitter_minutes (rota que alimenta o input do CadenceEditor)", () => {
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

    it("o SELECT de GET /campaigns inclui dispatch_jitter_minutes (técnica: inspeciona o argumento de .select(), não o objeto injetado no mock)", async () => {
      const getHandler = getRouteHandler("/campaigns", "get");
      const selectSpy = vi.fn().mockReturnThis();
      const supabase = mockGetSupabase();
      supabase.from.mockReturnValue({
        select: selectSpy,
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      });

      await getHandler({ query: { companyId: "comp-jitter-get" } }, fakeRes());

      expect(selectSpy).toHaveBeenCalled();
      expect(selectSpy.mock.calls[0][0]).toContain("dispatch_jitter_minutes");
    });

    it("ida e volta: PATCH grava jitter=30 -> GET relê pelo endpoint -> volta 30", async () => {
      const supabase = mockGetSupabase();

      // 1. PATCH /campaigns/:id — grava dispatch_jitter_minutes: 30
      const patchHandler = getRouteHandler("/campaigns/:id", "patch");
      supabase.from.mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: "camp-roundtrip-jitter", company_id: "comp-1", dispatch_jitter_minutes: 30 },
          error: null,
        }),
      });
      const patchRes = fakeRes();
      await patchHandler(
        { params: { id: "camp-roundtrip-jitter" }, body: { dispatch_jitter_minutes: 30 } },
        patchRes
      );
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          campaign: expect.objectContaining({ dispatch_jitter_minutes: 30 }),
        })
      );

      // 2. GET /campaigns — relê pelo endpoint (não do valor devolvido pelo PATCH)
      const getHandler = getRouteHandler("/campaigns", "get");
      supabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [{ id: "camp-roundtrip-jitter", company_id: "comp-1", dispatch_jitter_minutes: 30 }],
          error: null,
        }),
      });
      // GET /campaigns enriquece com métricas via query() bruto (pg) quando há
      // campanhas retornadas — sem isso o handler quebra tentando desestruturar
      // `rows` de um mock não configurado.
      mockQuery.mockResolvedValue({ rows: [] });
      const getRes = fakeRes();
      await getHandler({ query: { companyId: "comp-1" } }, getRes);

      expect(getRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          campaigns: [expect.objectContaining({ id: "camp-roundtrip-jitter", dispatch_jitter_minutes: 30 })],
        })
      );
    });
  });
});
