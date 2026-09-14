import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks para followup/db.js e followup/queue.js para testar enrollLead e rotas de templates
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
  ANCHOR_FIELDS,
  calcScheduledFor,
  isValidAnchorField,
  projectNextRecurringDate,
  resolveAnchorDate,
  validateTemplatePayload,
  enrollLead,
} from "../followup/service.js";
import { createDateInTimezone, getPartsInTimezone, adjustDateToSendWindow } from "../services/sendWindow.js";
import { query as mockQuery, getSupabase as mockGetSupabase } from "../followup/db.js";
import { registerFollowupRoutes } from "../followup/routes.js";

describe("PARTE 2B — Follow-up: Timing Fixo (scheduled_time) e Campos Âncora", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Whitelist de Âncoras e Validação", () => {
    it("exporta ANCHOR_FIELDS com meeting_datetime e data_nascimento", () => {
      expect(ANCHOR_FIELDS).toBeDefined();
      expect(ANCHOR_FIELDS.meeting_datetime).toEqual({ source: "schedule", recurring: false });
      expect(ANCHOR_FIELDS.data_nascimento).toEqual({ source: "lead", recurring: true });
    });

    it("valida corretamente isValidAnchorField", () => {
      expect(isValidAnchorField("meeting_datetime")).toBe(true);
      expect(isValidAnchorField("data_nascimento")).toBe(true);
      expect(isValidAnchorField("outro_campo")).toBe(false);
      expect(isValidAnchorField(null)).toBe(false);
    });

    it("rejeita template com âncora inválida ou ausente em before_anchor e after_anchor", () => {
      // before_anchor sem anchor_field
      const r1 = validateTemplatePayload({ trigger_type: "before_anchor" });
      expect(r1.valid).toBe(false);
      expect(r1.code).toBe("INVALID_ANCHOR_FIELD");

      // after_anchor com anchor_field inexistente na whitelist
      const r2 = validateTemplatePayload({ trigger_type: "after_anchor", anchor_field: "campo_fantasma" });
      expect(r2.valid).toBe(false);
      expect(r2.code).toBe("INVALID_ANCHOR_FIELD");

      // anchor_field inválido mesmo com trigger comum
      const r3 = validateTemplatePayload({ trigger_type: "on_schedule", anchor_field: "invalido" });
      expect(r3.valid).toBe(false);
      expect(r3.code).toBe("INVALID_ANCHOR_FIELD");

      // templates válidos
      expect(validateTemplatePayload({ trigger_type: "before_anchor", anchor_field: "data_nascimento" }).valid).toBe(true);
      expect(validateTemplatePayload({ trigger_type: "after_anchor", anchor_field: "meeting_datetime" }).valid).toBe(true);
      expect(validateTemplatePayload({ trigger_type: "after_enrollment" }).valid).toBe(true);
    });

    it("PATCH: validação mesclada impede limpar anchor_field em before_anchor e permite atualizar trigger se já houver âncora", () => {
      // Cenário 1: passo já é before_anchor e PATCH tenta limpar anchor_field: null
      const existingStep1 = {
        id: "tpl-1",
        trigger_type: "before_anchor",
        anchor_field: "data_nascimento",
      };
      const patchBody1 = { anchor_field: null };
      const merged1 = { ...existingStep1, ...patchBody1 };
      const val1 = validateTemplatePayload(merged1);
      expect(val1.valid).toBe(false);
      expect(val1.code).toBe("INVALID_ANCHOR_FIELD");

      // Cenário 2: passo tem anchor_field gravado e PATCH atualiza trigger_type para before_anchor sem reenviar anchor_field
      const existingStep2 = {
        id: "tpl-2",
        trigger_type: "on_schedule",
        anchor_field: "meeting_datetime",
      };
      const patchBody2 = { trigger_type: "before_anchor" };
      const merged2 = { ...existingStep2, ...patchBody2 };
      const val2 = validateTemplatePayload(merged2);
      expect(val2.valid).toBe(true);

      // Cenário 3: PATCH apenas renomeia o template em passo before_anchor
      const patchBody3 = { name: "Novo Nome Lembrete" };
      const merged3 = { ...existingStep1, ...patchBody3 };
      const val3 = validateTemplatePayload(merged3);
      expect(val3.valid).toBe(true);
    });

    it("PATCH rota /api/followup/templates/:id: devolve 400 ao limpar anchor_field de passo before_anchor", async () => {
      let followupRouter = null;
      const fakeApp = {
        use: (path, router) => {
          if (path === "/api/followup") {
            followupRouter = router;
          }
        },
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
      };

      const noop = (req, res, next) => next?.();
      registerFollowupRoutes(fakeApp, noop, () => noop, noop);

      expect(followupRouter).toBeDefined();
      const patchLayer = followupRouter.stack.find(
        (l) => l.route && l.route.path === "/templates/:id" && l.route.methods.patch
      );
      expect(patchLayer).toBeDefined();
      const patchHandler = patchLayer.route.stack[patchLayer.route.stack.length - 1].handle;

      // Simula Supabase retornando passo existente before_anchor
      const supabase = mockGetSupabase();
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: "tpl-123",
            trigger_type: "before_anchor",
            anchor_field: "data_nascimento",
          },
          error: null,
        }),
      });

      // Simula request enviando { anchor_field: null }
      const req = {
        params: { id: "tpl-123" },
        body: { anchor_field: null },
      };
      const res = {
        statusCode: 200,
        status(s) {
          this.statusCode = s;
          return this;
        },
        json: vi.fn(),
      };

      await patchHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ code: "INVALID_ANCHOR_FIELD" }),
        })
      );
    });
  });

  describe("Projeção de Datas Recorrentes (data_nascimento)", () => {
    it("projeta data_nascimento 1987 para o próximo aniversário futuro", () => {
      // Se o lead nasceu em 15/03/1987 e hoje é 14/09/2026, a âncora é 15/03/2027
      const refSetembro = new Date("2026-09-14T12:00:00-03:00");
      const projSetembro = projectNextRecurringDate("1987-03-15", refSetembro);
      const partsSetembro = getPartsInTimezone(projSetembro, "America/Sao_Paulo");
      expect(partsSetembro.year).toBe(2027);
      expect(partsSetembro.month).toBe(3);
      expect(partsSetembro.day).toBe(15);

      // Se hoje fosse 10/01/2026, a âncora seria 15/03/2026
      const refJaneiro = new Date("2026-01-10T12:00:00-03:00");
      const projJaneiro = projectNextRecurringDate("1987-03-15", refJaneiro);
      const partsJaneiro = getPartsInTimezone(projJaneiro, "America/Sao_Paulo");
      expect(partsJaneiro.year).toBe(2026);
      expect(partsJaneiro.month).toBe(3);
      expect(partsJaneiro.day).toBe(15);
    });

    it("suporta formatos de data DD/MM/YYYY e Date object", () => {
      const ref = new Date("2026-09-14T12:00:00-03:00");
      const projBr = projectNextRecurringDate("15/03/1987", ref);
      const partsBr = getPartsInTimezone(projBr, "America/Sao_Paulo");
      expect(partsBr.year).toBe(2027);
      expect(partsBr.month).toBe(3);
      expect(partsBr.day).toBe(15);
    });
  });

  describe("Cálculo e Ordem de Execução (calcScheduledFor + scheduled_time + adjustDateToSendWindow)", () => {
    it("calcScheduledFor resolve before_anchor e after_anchor", () => {
      const now = new Date("2026-09-14T10:00:00-03:00");
      const templateBefore = {
        trigger_type: "before_anchor",
        anchor_field: "meeting_datetime",
        trigger_value: 2,
        trigger_unit: "hours",
      };
      const meeting = "2026-09-16T15:00:00-03:00";
      const sched = calcScheduledFor(templateBefore, now, meeting);
      expect(sched).toBeInstanceOf(Date);
      const parts = getPartsInTimezone(sched, "America/Sao_Paulo");
      expect(parts.year).toBe(2026);
      expect(parts.month).toBe(9);
      expect(parts.day).toBe(16);
      expect(parts.hour).toBe(13); // 15:00 - 2 horas = 13:00
    });

    it("retorna null se o campo âncora não existir no contexto", () => {
      const now = new Date("2026-09-14T10:00:00-03:00");
      const template = {
        trigger_type: "before_anchor",
        anchor_field: "data_nascimento",
        trigger_value: 1,
        trigger_unit: "days",
      };
      const sched = calcScheduledFor(template, now, null, {});
      expect(sched).toBeNull();
    });

    it("quando scheduled_time empurra a data para trás do agora (ex.: inscrito às 15h para 09:00), soma 1 dia antes da janela", () => {
      // Inscrito às 15:00 em uma segunda-feira (14/09/2026)
      const now = new Date("2026-09-14T15:00:00-03:00");
      const template = {
        id: "tpl-delay-time",
        trigger_type: "after_enrollment",
        trigger_value: 2,
        trigger_unit: "hours",
        scheduled_time: "09:00",
      };

      // 1. calcScheduledFor -> 15:00 + 2h = 17:00 hoje
      let scheduledFor = calcScheduledFor(template, now, null);
      expect(scheduledFor.toISOString()).toContain("T20:00:00"); // 17:00 SP = 20:00 UTC

      // 2. scheduled_time fixa às 09:00 SP naquele dia
      const parts = getPartsInTimezone(scheduledFor, "America/Sao_Paulo");
      scheduledFor = createDateInTimezone(parts.year, parts.month, parts.day, 9, 0, 0, "America/Sao_Paulo");
      // Como 09:00 <= 15:00 (passado), o motor soma 1 dia
      if (
        scheduledFor.getTime() <= now.getTime() &&
        (template.trigger_type === "after_enrollment" || template.trigger_type === "on_schedule")
      ) {
        scheduledFor = new Date(scheduledFor.getTime() + 24 * 60 * 60 * 1000);
      }

      // 3. adjustDateToSendWindow roda por último
      const finalSched = adjustDateToSendWindow(scheduledFor, {
        start: "08:00",
        end: "18:00",
        days: ["mon", "tue", "wed", "thu", "fri"],
        timezone: "America/Sao_Paulo",
      });

      const finalParts = getPartsInTimezone(finalSched, "America/Sao_Paulo");
      // Deve sair na terça-feira (15/09) às 09:00, e NÃO sair imediatamente na segunda às 15:00 com delay zero!
      expect(finalParts.day).toBe(15);
      expect(finalParts.hour).toBe(9);
      expect(finalParts.minute).toBe(0);
      expect(finalSched.getTime()).toBeGreaterThan(now.getTime());
    });
  });

  describe("Fluxo de Enroll com Janela, Timezone e Busca Canônica no Banco", () => {
    it("scheduled_time 09:00 com janela 08:00-18:00 sai às 09:00 no timezone America/Sao_Paulo", async () => {
      const now = new Date("2026-09-15T08:00:00-03:00"); // Terça-feira
      const template = {
        id: "tpl-1",
        trigger_type: "after_enrollment",
        trigger_value: 1,
        trigger_unit: "days",
        scheduled_time: "09:00",
      };

      const baseSched = calcScheduledFor(template, now, null);
      const parts = getPartsInTimezone(baseSched, "America/Sao_Paulo");
      const fixedTime = createDateInTimezone(parts.year, parts.month, parts.day, 9, 0, 0, "America/Sao_Paulo");
      const finalSched = adjustDateToSendWindow(fixedTime, {
        start: "08:00",
        end: "18:00",
        days: ["mon", "tue", "wed", "thu", "fri"],
        timezone: "America/Sao_Paulo",
      });

      const finalParts = getPartsInTimezone(finalSched, "America/Sao_Paulo");
      expect(finalParts.hour).toBe(9);
      expect(finalParts.minute).toBe(0);
      expect(finalParts.day).toBe(16); // Quarta-feira
      expect(finalSched.toISOString()).toContain("T12:00:00");
    });

    it("scheduled_time 07:00 com janela 08:00-18:00 é ajustado para 08:00", async () => {
      const now = new Date("2026-09-15T08:00:00-03:00"); // Terça-feira
      const template = {
        id: "tpl-2",
        trigger_type: "after_enrollment",
        trigger_value: 1,
        trigger_unit: "days",
        scheduled_time: "07:00",
      };

      const baseSched = calcScheduledFor(template, now, null);
      const parts = getPartsInTimezone(baseSched, "America/Sao_Paulo");
      const fixedTime = createDateInTimezone(parts.year, parts.month, parts.day, 7, 0, 0, "America/Sao_Paulo");
      
      const finalSched = adjustDateToSendWindow(fixedTime, {
        start: "08:00",
        end: "18:00",
        days: ["mon", "tue", "wed", "thu", "fri"],
        timezone: "America/Sao_Paulo",
      });

      const finalParts = getPartsInTimezone(finalSched, "America/Sao_Paulo");
      expect(finalParts.hour).toBe(8);
      expect(finalParts.minute).toBe(0);
      expect(finalParts.day).toBe(16);
    });

    it("lead sem data_nascimento pula o step e agenda os demais", async () => {
      const templates = [
        {
          id: "step-1",
          name: "Boas-vindas",
          order_index: 0,
          trigger_type: "after_enrollment",
          trigger_value: 1,
          trigger_unit: "hours",
        },
        {
          id: "step-2",
          name: "Aniversário",
          order_index: 1,
          trigger_type: "before_anchor",
          anchor_field: "data_nascimento",
          trigger_value: 0,
          trigger_unit: "days",
          scheduled_time: "09:00",
        },
        {
          id: "step-3",
          name: "Follow-up",
          order_index: 2,
          trigger_type: "after_enrollment",
          trigger_value: 2,
          trigger_unit: "days",
        },
      ];

      const now = new Date("2026-09-14T10:00:00-03:00");
      const leadWithoutBirthDate = { data_nascimento: null };

      let enqueuedCount = 0;
      const skippedSteps = [];

      for (const tpl of templates) {
        const sched = calcScheduledFor(tpl, now, null, leadWithoutBirthDate);
        if (!sched) {
          skippedSteps.push({
            stepId: tpl.id,
            reason: "no_date",
          });
          continue;
        }
        enqueuedCount++;
      }

      expect(skippedSteps).toHaveLength(1);
      expect(skippedSteps[0]).toEqual({ stepId: "step-2", reason: "no_date" });
      expect(enqueuedCount).toBe(2);
    });

    it("lead gravado no banco com data_nascimento e enroll sem o campo no payload: busca via SQL_CANONICAL_PHONE e agenda a próxima ocorrência", async () => {
      // Mock das respostas de banco para o enrollLead:
      mockQuery.mockImplementation(async (sql, params) => {
        // 1. Inserir schedule
        if (sql.includes("INSERT INTO followup_schedules")) {
          return { rows: [{ id: "sched-100" }] };
        }
        // 2. Buscar company tenant_id
        if (sql.includes("FROM followup_companies")) {
          return { rows: [{ tenant_id: "geracao-digital" }] };
        }
        // 3. Buscar data_nascimento na tabela de leads via SQL_CANONICAL_PHONE
        if (sql.includes("SELECT data_nascimento FROM public.")) {
          // Garante que a query usa SQL_CANONICAL_PHONE
          expect(sql).toContain("client_id = $1");
          expect(sql).toContain("data_nascimento IS NOT NULL");
          return { rows: [{ data_nascimento: "1987-03-15" }] };
        }
        // 4. Inserir job
        if (sql.includes("INSERT INTO followup_jobs")) {
          return { rows: [{ id: "job-200" }] };
        }
        return { rows: [] };
      });

      // Mock dos templates do Supabase
      const supabase = mockGetSupabase();
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [
            {
              id: "step-bday",
              name: "Mensagem de Aniversário",
              order_index: 0,
              trigger_type: "before_anchor",
              anchor_field: "data_nascimento",
              trigger_value: 0,
              trigger_unit: "days",
              scheduled_time: "09:00",
              is_active: true,
            },
          ],
          error: null,
        }),
      });

      // Chamada do enroll sem data_nascimento no payload (como vem do ApplyFollowupModal)
      const campaign = { id: "camp-1", company_id: "comp-1" };
      const enrollResult = await enrollLead(campaign, {
        lead_name: "Conrado",
        phone: "3491093607", // formato sem 9 dígito que testa canonicalização
      });

      // O passo deve ter sido agendado com sucesso puxando a data_nascimento do banco!
      expect(enrollResult.enqueued).toBe(1);
      expect(enrollResult.skippedSteps).toHaveLength(0);

      // Verifica se o job foi inserido com a data projetada para o futuro
      const jobInsertCall = mockQuery.mock.calls.find((c) => c[0].includes("INSERT INTO followup_jobs"));
      expect(jobInsertCall).toBeDefined();
      const scheduledForStr = jobInsertCall[1][2]; // scheduled_for param
      // Deve ter agendado para o próximo 15 de março (2027 se hoje for pós-março 2026) às 09:00 SP (12:00 UTC)
      expect(scheduledForStr).toContain("-03-15T12:00:00");
    });

    it("lead gravado no banco com data_nascimento e payload trazendo data_nascimento: null: a ordem do spread preserva a data do banco e agenda com sucesso", async () => {
      mockQuery.mockImplementation(async (sql, params) => {
        if (sql.includes("INSERT INTO followup_schedules")) {
          return { rows: [{ id: "sched-101" }] };
        }
        if (sql.includes("FROM followup_companies")) {
          return { rows: [{ tenant_id: "geracao-digital" }] };
        }
        if (sql.includes("SELECT data_nascimento FROM public.")) {
          return { rows: [{ data_nascimento: "1995-04-10" }] };
        }
        if (sql.includes("INSERT INTO followup_jobs")) {
          return { rows: [{ id: "job-201" }] };
        }
        return { rows: [] };
      });

      const supabase = mockGetSupabase();
      supabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: [
            {
              id: "step-bday-2",
              name: "Mensagem Aniversário 2",
              order_index: 0,
              trigger_type: "before_anchor",
              anchor_field: "data_nascimento",
              trigger_value: 0,
              trigger_unit: "days",
              scheduled_time: "09:00",
              is_active: true,
            },
          ],
          error: null,
        }),
      });

      // Payload cru com data_nascimento: null explícito (ex.: de outro chamador que manda o objeto lead inteiro)
      const campaign = { id: "camp-1", company_id: "comp-1" };
      const enrollResult = await enrollLead(campaign, {
        lead_name: "Larissa",
        phone: "5534991093607",
        data_nascimento: null, // não deve sobrescrever o "1995-04-10" do banco!
      });

      expect(enrollResult.enqueued).toBe(1);
      expect(enrollResult.skippedSteps).toHaveLength(0);

      const jobInsertCall = mockQuery.mock.calls.find((c) => c[0].includes("INSERT INTO followup_jobs") && c[1][0] === "sched-101");
      expect(jobInsertCall).toBeDefined();
      // 10 de abril de 2027 é sábado, janela de dias úteis joga para segunda 12 de abril
      expect(jobInsertCall[1][2]).toContain("2027-04-12");
    });
  });
});
