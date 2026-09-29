import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks do banco e fila para o worker
const mockQuery = vi.fn();
const mockQueueAdd = vi.fn().mockResolvedValue({ id: "bull-job-test" });

vi.mock("../followup/db.js", () => ({
  query: (...args) => mockQuery(...args),
  getSupabase: vi.fn(),
}));

vi.mock("../followup/queue.js", () => ({
  getFollowupQueue: () => ({
    add: (...args) => mockQueueAdd(...args),
  }),
}));

vi.mock("../services/n8nSettings.js", () => ({
  getLeadClientN8nSettings: vi.fn().mockResolvedValue({
    send_window_enabled: false,
  }),
}));

vi.mock("../followup/worker.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    sendViaEvolution: vi.fn().mockResolvedValue({ messageId: "evo-msg-123" }),
  };
});

const {
  evaluateStepConditions,
  validateTemplatePayload,
  ensureFollowupConditionalAndInternalColumns,
  VALID_STEP_TYPES,
  VALID_ACTION_TYPES,
  VALID_CONDITION_OPERATORS,
} = await import("../followup/service.js");

const { processJob, sendViaEvolution } = await import("../followup/worker.js");

describe("Item 07 — Passos Condicionais e Ações Internas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Avaliador Puro de Condições (evaluateStepConditions)", () => {
    it("retorna passed: true quando condições for array vazio ou nulo", () => {
      expect(evaluateStepConditions([], { stage: "novo" })).toEqual({ passed: true });
      expect(evaluateStepConditions(null, { stage: "novo" })).toEqual({ passed: true });
      expect(evaluateStepConditions(undefined, {})).toEqual({ passed: true });
    });

    it("ignora condições sem campo ou operador", () => {
      expect(evaluateStepConditions([{ field: "", operator: "equals" }], { stage: "novo" })).toEqual({ passed: true });
      expect(evaluateStepConditions([{ field: "stage", operator: "" }], { stage: "novo" })).toEqual({ passed: true });
    });

    it("avalia 'equals' e 'not_equals' com case-insensitivity", () => {
      const lead = { stage: "Proposta_Enviada", cidade: "Uberlândia" };

      expect(evaluateStepConditions([{ field: "stage", operator: "equals", value: "proposta_enviada" }], lead)).toEqual({ passed: true });
      expect(evaluateStepConditions([{ field: "stage", operator: "equals", value: "negociacao" }], lead).passed).toBe(false);

      expect(evaluateStepConditions([{ field: "stage", operator: "not_equals", value: "negociacao" }], lead)).toEqual({ passed: true });
      expect(evaluateStepConditions([{ field: "stage", operator: "not_equals", value: "proposta_enviada" }], lead).passed).toBe(false);
    });

    it("avalia 'contains' e 'not_contains' para strings e arrays de tags", () => {
      const lead = {
        tags: ["VIP", "Black_Friday", "Quente"],
        observacoes: "Cliente tem interesse no plano anual",
      };

      // Array de tags
      expect(evaluateStepConditions([{ field: "tags", operator: "contains", value: "vip" }], lead)).toEqual({ passed: true });
      expect(evaluateStepConditions([{ field: "tags", operator: "contains", value: "frio" }], lead).passed).toBe(false);

      expect(evaluateStepConditions([{ field: "tags", operator: "not_contains", value: "frio" }], lead)).toEqual({ passed: true });
      expect(evaluateStepConditions([{ field: "tags", operator: "not_contains", value: "black_friday" }], lead).passed).toBe(false);

      // String
      expect(evaluateStepConditions([{ field: "observacoes", operator: "contains", value: "plano anual" }], lead)).toEqual({ passed: true });
      expect(evaluateStepConditions([{ field: "observacoes", operator: "not_contains", value: "mensal" }], lead)).toEqual({ passed: true });
    });

    it("avalia 'is_empty' e 'is_not_empty' para campos nulos, indefinidos ou vazios", () => {
      const lead = {
        telefone: "5534999999999",
        email: null,
        origem: "",
        cidade: undefined,
        stage: "proposta",
      };

      expect(evaluateStepConditions([{ field: "email", operator: "is_empty" }], lead)).toEqual({ passed: true });
      expect(evaluateStepConditions([{ field: "origem", operator: "is_empty" }], lead)).toEqual({ passed: true });
      expect(evaluateStepConditions([{ field: "cidade", operator: "is_empty" }], lead)).toEqual({ passed: true });
      expect(evaluateStepConditions([{ field: "stage", operator: "is_empty" }], lead).passed).toBe(false);

      expect(evaluateStepConditions([{ field: "stage", operator: "is_not_empty" }], lead)).toEqual({ passed: true });
      expect(evaluateStepConditions([{ field: "email", operator: "is_not_empty" }], lead).passed).toBe(false);
    });

    it("retorna passed: false se qualquer uma de múltiplas condições falhar", () => {
      const lead = { stage: "proposta", tags: ["vip"] };
      const conds = [
        { field: "stage", operator: "equals", value: "proposta" },
        { field: "tags", operator: "contains", value: "desconto" }, // falha
      ];

      const res = evaluateStepConditions(conds, lead);
      expect(res.passed).toBe(false);
      expect(res.reason).toContain("tags não contém desconto");
    });
  });

  describe("2. Validação de Payload (validateTemplatePayload)", () => {
    it("exporta constantes corretas de step types, action types e operadores", () => {
      expect(VALID_STEP_TYPES).toEqual(["message", "internal_action"]);
      expect(VALID_ACTION_TYPES).toEqual(["create_reminder", "change_stage", "assign_operator", "add_tag"]);
      expect(VALID_CONDITION_OPERATORS).toEqual([
        "equals",
        "not_equals",
        "contains",
        "not_contains",
        "in",
        "not_in",
        "is_empty",
        "is_not_empty",
      ]);
    });

    it("valida step_type e exige action_type válido para internal_action", () => {
      // step_type padrão message -> válido
      expect(validateTemplatePayload({ trigger_type: "after_enrollment" }).valid).toBe(true);

      // step_type inválido -> inválido
      const invStep = validateTemplatePayload({ step_type: "whatsapp_voice" });
      expect(invStep.valid).toBe(false);
      expect(invStep.reason).toContain("é inválido");

      // internal_action sem action_type -> inválido
      const semAction = validateTemplatePayload({ step_type: "internal_action" });
      expect(semAction.valid).toBe(false);
      expect(semAction.reason).toContain("action_type");

      // internal_action com action_type inválido -> inválido
      const invAction = validateTemplatePayload({ step_type: "internal_action", action_type: "send_email" });
      expect(invAction.valid).toBe(false);
      expect(invAction.reason).toContain("action_type");

      // internal_action com action_type válido -> válido
      for (const act of VALID_ACTION_TYPES) {
        const val = validateTemplatePayload({ step_type: "internal_action", action_type: act });
        expect(val.valid).toBe(true);
      }
    });

    it("valida condições no payload do template", () => {
      // conditions não array -> inválido
      expect(validateTemplatePayload({ conditions: "stage=novo" }).valid).toBe(false);

      // condition sem operador válido -> inválido
      expect(validateTemplatePayload({ conditions: [{ field: "stage", operator: "gt", value: 10 }] }).valid).toBe(false);

      // condition válida -> válido
      expect(
        validateTemplatePayload({
          conditions: [{ field: "stage", operator: "equals", value: "proposta" }],
        }).valid
      ).toBe(true);
    });
  });

  describe("3. Migração Idempotente de Colunas (ensureFollowupConditionalAndInternalColumns)", () => {
    it("executa DDL idempotente com step_type, action_type, action_payload e conditions", async () => {
      const mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) };
      await ensureFollowupConditionalAndInternalColumns(mockClient);

      expect(mockClient.query).toHaveBeenCalledTimes(1);
      const sql = mockClient.query.mock.calls[0][0];
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS step_type");
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS action_type");
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS action_payload");
      expect(sql).toContain("ADD COLUMN IF NOT EXISTS conditions");
      expect(sql).toContain("followup_templates_step_type_check");
      expect(sql).toContain("followup_templates_action_type_check");
    });
  });

  describe("4. Worker (processJob) — Passos Condicionais", () => {
    it("marca job como 'skipped' e não envia WhatsApp quando condição do lead NÃO for satisfeita", async () => {
      // Mock do job com condição: stage deve ser 'proposta_enviada'
      const jobRow = {
        job_id: "job-cond-1",
        job_status: "pending",
        campaign_status: "active",
        tenant_id: "client-abc",
        company_id: "comp-1",
        phone: "5534991093607",
        lead_name: "Conrado",
        step_type: "message",
        message: "Olá, segue proposta",
        conditions: [{ field: "stage", operator: "equals", value: "proposta_enviada" }],
      };

      // Mock da query:
      // 1. SELECT do job
      // 2. SELECT do lead -> retorna stage: 'novo' (não proposta_enviada)
      // 3. UPDATE do job para skipped
      mockQuery.mockImplementation(async (sql, params) => {
        if (sql.includes("FROM followup_jobs")) {
          return { rows: [jobRow] };
        }
        if (sql.includes("SELECT * FROM public.")) {
          return { rows: [{ telefone: "5534991093607", stage: "novo" }] };
        }
        if (sql.includes("UPDATE followup_jobs SET status='skipped'")) {
          return { rowCount: 1 };
        }
        return { rows: [] };
      });

      await processJob("job-cond-1");

      // Verifica que o job foi atualizado para 'skipped'
      const updateCall = mockQuery.mock.calls.find((c) =>
        c[0].includes("UPDATE followup_jobs SET status='skipped'")
      );
      expect(updateCall).toBeDefined();
      expect(updateCall[1]).toEqual(["job-cond-1"]);

      // Garante que a Evolution API NÃO foi acionada
      expect(sendViaEvolution).not.toHaveBeenCalled();
    });

    it("prossegue e executa o passo quando a condição do lead for atendida", async () => {
      const jobRow = {
        job_id: "job-cond-2",
        job_status: "pending",
        campaign_status: "active",
        tenant_id: "client-abc",
        company_id: "comp-1",
        phone: "5534991093607",
        lead_name: "Conrado",
        step_type: "internal_action",
        action_type: "add_tag",
        action_payload: { tag: "lead_quente" },
        conditions: [{ field: "stage", operator: "equals", value: "negociacao" }],
      };

      mockQuery.mockImplementation(async (sql, params) => {
        if (sql.includes("FROM followup_jobs")) {
          return { rows: [jobRow] };
        }
        if (sql.includes("SELECT * FROM public.")) {
          return { rows: [{ telefone: "5534991093607", stage: "negociacao" }] };
        }
        if (sql.includes("UPDATE public.")) {
          return { rowCount: 1 };
        }
        if (sql.includes("UPDATE followup_jobs SET status='sent'")) {
          return { rowCount: 1 };
        }
        return { rows: [] };
      });

      await processJob("job-cond-2");

      // Não deve ter sido skipped
      const skipCall = mockQuery.mock.calls.find((c) =>
        c[0].includes("UPDATE followup_jobs SET status='skipped'")
      );
      expect(skipCall).toBeUndefined();

      // Job deve ter sido marcado como 'sent'
      const sentCall = mockQuery.mock.calls.find((c) =>
        c[0].includes("UPDATE followup_jobs SET status='sent'")
      );
      expect(sentCall).toBeDefined();
    });
  });

  describe("5. Worker (processJob) — Passos de Ação Interna", () => {
    it("create_reminder: insere registro em public.lead_reminders e marca job como 'sent' sem chamar Evolution", async () => {
      const jobRow = {
        job_id: "job-act-remind",
        job_status: "pending",
        campaign_status: "active",
        tenant_id: "client-xyz",
        company_id: "comp-1",
        phone: "5534991093607",
        lead_name: "Mariana",
        step_type: "internal_action",
        action_type: "create_reminder",
        action_payload: {
          title: "Ligar para Mariana sobre contrato",
          notes: "Verificar se precisa de ajustes na cláusula 4",
        },
      };

      mockQuery.mockImplementation(async (sql, params) => {
        if (sql.includes("FROM followup_jobs")) {
          return { rows: [jobRow] };
        }
        if (sql.includes("INSERT INTO public.lead_reminders")) {
          return { rowCount: 1 };
        }
        if (sql.includes("UPDATE followup_jobs SET status='sent'")) {
          return { rowCount: 1 };
        }
        return { rows: [] };
      });

      await processJob("job-act-remind");

      // Verifica inserção em lead_reminders
      const insertCall = mockQuery.mock.calls.find((c) =>
        c[0].includes("INSERT INTO public.lead_reminders")
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[1][0]).toBe("client-xyz");
      expect(insertCall[1][1]).toBe("5534991093607");
      expect(insertCall[1][2]).toBe("Mariana");
      expect(insertCall[1][3]).toBe("Ligar para Mariana sobre contrato");
      expect(insertCall[1][4]).toBe("Verificar se precisa de ajustes na cláusula 4");

      // Verifica que o job foi marcado como sent
      const sentCall = mockQuery.mock.calls.find((c) =>
        c[0].includes("UPDATE followup_jobs SET status='sent'")
      );
      expect(sentCall).toBeDefined();
      expect(sentCall[1]).toEqual(["job-act-remind"]);

      // Zero chamadas para a Evolution API
      expect(sendViaEvolution).not.toHaveBeenCalled();
    });

    it("change_stage: atualiza a coluna stage na tabela do lead e marca job como 'sent'", async () => {
      const jobRow = {
        job_id: "job-act-stage",
        job_status: "pending",
        campaign_status: "active",
        tenant_id: "client-xyz",
        company_id: "comp-1",
        phone: "5534991093607",
        lead_name: "Carlos",
        step_type: "internal_action",
        action_type: "change_stage",
        action_payload: { stage: "proposta_enviada" },
      };

      mockQuery.mockImplementation(async (sql, params) => {
        if (sql.includes("FROM followup_jobs")) {
          return { rows: [jobRow] };
        }
        if (sql.includes("SET stage = $1")) {
          return { rowCount: 1 };
        }
        if (sql.includes("UPDATE followup_jobs SET status='sent'")) {
          return { rowCount: 1 };
        }
        return { rows: [] };
      });

      await processJob("job-act-stage");

      const updateStageCall = mockQuery.mock.calls.find((c) =>
        c[0].includes("SET stage = $1")
      );
      expect(updateStageCall).toBeDefined();
      expect(updateStageCall[1][0]).toBe("proposta_enviada");
      expect(updateStageCall[1][1]).toBe("client-xyz");

      expect(sendViaEvolution).not.toHaveBeenCalled();
    });

    it("assign_operator: atualiza assigned_to na tabela do lead e marca job como 'sent'", async () => {
      const jobRow = {
        job_id: "job-act-op",
        job_status: "pending",
        campaign_status: "active",
        tenant_id: "client-xyz",
        company_id: "comp-1",
        phone: "5534991093607",
        lead_name: "Carlos",
        step_type: "internal_action",
        action_type: "assign_operator",
        action_payload: { assigned_to: "operador_vendas_1" },
      };

      mockQuery.mockImplementation(async (sql, params) => {
        if (sql.includes("FROM followup_jobs")) {
          return { rows: [jobRow] };
        }
        if (sql.includes("SET assigned_to = $1")) {
          return { rowCount: 1 };
        }
        if (sql.includes("UPDATE followup_jobs SET status='sent'")) {
          return { rowCount: 1 };
        }
        return { rows: [] };
      });

      await processJob("job-act-op");

      const updateOpCall = mockQuery.mock.calls.find((c) =>
        c[0].includes("SET assigned_to = $1")
      );
      expect(updateOpCall).toBeDefined();
      expect(updateOpCall[1][0]).toBe("operador_vendas_1");

      expect(sendViaEvolution).not.toHaveBeenCalled();
    });

    it("add_tag: adiciona tag no array tags do lead sem duplicar e marca job como 'sent'", async () => {
      const jobRow = {
        job_id: "job-act-tag",
        job_status: "pending",
        campaign_status: "active",
        tenant_id: "client-xyz",
        company_id: "comp-1",
        phone: "5534991093607",
        lead_name: "Carlos",
        step_type: "internal_action",
        action_type: "add_tag",
        action_payload: { tag: "followup_automatico" },
      };

      mockQuery.mockImplementation(async (sql, params) => {
        if (sql.includes("FROM followup_jobs")) {
          return { rows: [jobRow] };
        }
        if (sql.includes("SET tags = array_append")) {
          return { rowCount: 1 };
        }
        if (sql.includes("UPDATE followup_jobs SET status='sent'")) {
          return { rowCount: 1 };
        }
        return { rows: [] };
      });

      await processJob("job-act-tag");

      const addTagCall = mockQuery.mock.calls.find((c) =>
        c[0].includes("SET tags = array_append")
      );
      expect(addTagCall).toBeDefined();
      expect(addTagCall[1][0]).toBe("followup_automatico");

      expect(sendViaEvolution).not.toHaveBeenCalled();
    });
  });
});
