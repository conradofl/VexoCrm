import { describe, expect, it, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
const mockGetSupabase = vi.fn();

vi.mock("../followup/db.js", () => ({
  query: (...args) => mockQuery(...args),
  getSupabase: () => mockGetSupabase(),
}));

vi.mock("../followup/queue.js", () => ({
  getFollowupQueue: () => ({
    add: vi.fn().mockResolvedValue({ id: "bull-new-anchor-1" }),
  }),
}));

vi.mock("../services/n8nSettings.js", () => ({
  getLeadClientN8nSettings: vi.fn().mockResolvedValue({
    send_window_start: "08:00",
    send_window_end: "18:00",
    send_window_days: "seg_sex",
  }),
}));

const {
  ANCHOR_FIELDS,
  ANCHOR_FIELD_METADATA,
  isValidAnchorField,
  getAnchorFieldsMetadata,
  validateTemplatePayload,
  calcScheduledFor,
  resolveAnchorDate,
  enrollLead,
} = await import("../followup/service.js");

const { ensureLeadAnchorColumns } = await import("../lead-client-tables.js");

describe("Item 05 — As Três Novas Âncoras no Follow-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Exportação e Metadados", () => {
    it("ANCHOR_FIELDS contém exatamente as 5 âncoras com seus respectivos source e recurring", () => {
      expect(ANCHOR_FIELDS).toEqual({
        meeting_datetime: { source: "schedule", recurring: false },
        data_nascimento: { source: "lead", recurring: true },
        aniversario_casamento: { source: "lead", recurring: true },
        epoca_ferias: { source: "lead", recurring: true },
        data_retorno: { source: "lead", recurring: false },
        prazo_acordo: { source: "lead", recurring: false },
      });
    });

    it("isValidAnchorField retorna true para as três novas âncoras e false para desconhecidas", () => {
      expect(isValidAnchorField("aniversario_casamento")).toBe(true);
      expect(isValidAnchorField("epoca_ferias")).toBe(true);
      expect(isValidAnchorField("data_retorno")).toBe(true);
      expect(isValidAnchorField("data_nascimento")).toBe(true);
      expect(isValidAnchorField("meeting_datetime")).toBe(true);
      expect(isValidAnchorField("ancora_fantasma")).toBe(false);
    });

    it("getAnchorFieldsMetadata() retorna a lista de 6 elementos com chaves, rótulos e flags corretas", () => {
      const meta = getAnchorFieldsMetadata();
      expect(meta).toHaveLength(6);

      const casamento = meta.find((m) => m.key === "aniversario_casamento");
      expect(casamento).toBeDefined();
      expect(casamento.label).toBe("Aniversário de Casamento");
      expect(casamento.source).toBe("lead");
      expect(casamento.recurring).toBe(true);

      const ferias = meta.find((m) => m.key === "epoca_ferias");
      expect(ferias).toBeDefined();
      expect(ferias.label).toBe("Época de Férias");
      expect(ferias.source).toBe("lead");
      expect(ferias.recurring).toBe(true);

      const retorno = meta.find((m) => m.key === "data_retorno");
      expect(retorno).toBeDefined();
      expect(retorno.label).toBe("Data de Retorno");
      expect(retorno.source).toBe("lead");
      expect(retorno.recurring).toBe(false);
    });
  });

  describe("2. Validação de Templates", () => {
    it("validateTemplatePayload aceita as novas âncoras em before_anchor e after_anchor", () => {
      const resCasamento = validateTemplatePayload({
        trigger_type: "before_anchor",
        anchor_field: "aniversario_casamento",
      });
      expect(resCasamento.valid).toBe(true);

      const resFerias = validateTemplatePayload({
        trigger_type: "before_anchor",
        anchor_field: "epoca_ferias",
      });
      expect(resFerias.valid).toBe(true);

      const resRetorno = validateTemplatePayload({
        trigger_type: "after_anchor",
        anchor_field: "data_retorno",
      });
      expect(resRetorno.valid).toBe(true);
    });
  });

  describe("3. Cálculo de Agendamento (calcScheduledFor & resolveAnchorDate)", () => {
    it("aniversario_casamento (recorrente): com data em 2015-10-15, agendado com 30 dias de antecedência, calcula no ciclo futuro correto", () => {
      const template = {
        trigger_type: "before_anchor",
        anchor_field: "aniversario_casamento",
        trigger_value: 30,
        trigger_unit: "days",
      };

      // Se a data de referência é junho de 2026, a próxima ocorrência é 15/10/2026
      const refDate = new Date("2026-06-01T12:00:00.000Z");
      const scheduled = calcScheduledFor(template, refDate, null, {
        aniversario_casamento: "2015-10-15",
      });

      expect(scheduled).toBeInstanceOf(Date);
      // 15 de outubro menos 30 dias cai em 15 de setembro de 2026
      expect(scheduled.toISOString()).toContain("2026-09-15");

      // Suporte a sinônimo no contexto: context.wedding_anniversary ou context.casamento
      const scheduledAlias = calcScheduledFor(template, refDate, null, {
        casamento: "2015-10-15",
      });
      expect(scheduledAlias).toBeInstanceOf(Date);
      expect(scheduledAlias.toISOString()).toContain("2026-09-15");
    });

    it("epoca_ferias (recorrente): com data em 2020-07-01, agendado com 60 dias de antecedência, projeta a ocorrência futura corretamente", () => {
      const template = {
        trigger_type: "before_anchor",
        anchor_field: "epoca_ferias",
        trigger_value: 60,
        trigger_unit: "days",
      };

      // Se a data de referência é janeiro de 2026, a próxima ocorrência é 01/07/2026
      const refDate = new Date("2026-01-15T12:00:00.000Z");
      const scheduled = calcScheduledFor(template, refDate, null, {
        epoca_ferias: "2020-07-01",
      });

      expect(scheduled).toBeInstanceOf(Date);
      // 1º de julho menos 60 dias cai em 2 de maio de 2026
      expect(scheduled.toISOString()).toContain("2026-05-02");

      // Suporte a sinônimo: context.ferias ou context.vacation
      const scheduledAlias = calcScheduledFor(template, refDate, null, {
        vacation: "2020-07-01",
      });
      expect(scheduledAlias).toBeInstanceOf(Date);
      expect(scheduledAlias.toISOString()).toContain("2026-05-02");
    });

    it("data_retorno (não-recorrente): com retorno em 2026-12-10T18:00:00Z, disparando 2 dias depois (after_anchor), calcula para exatamente 2 dias após a data pontual", () => {
      const template = {
        trigger_type: "after_anchor",
        anchor_field: "data_retorno",
        trigger_value: 2,
        trigger_unit: "days",
      };

      const refDate = new Date("2026-08-01T10:00:00.000Z");
      const retornoDate = "2026-12-10T18:00:00.000Z";
      const scheduled = calcScheduledFor(template, refDate, null, {
        data_retorno: retornoDate,
      });

      expect(scheduled).toBeInstanceOf(Date);
      // Exatamente 2 dias (48 horas) após 10/12/2026 18:00 -> 12/12/2026 18:00
      expect(scheduled.toISOString()).toBe("2026-12-12T18:00:00.000Z");

      // Suporte a sinônimo: context.return_date ou context.retorno
      const scheduledAlias = calcScheduledFor(template, refDate, null, {
        retorno: retornoDate,
      });
      expect(scheduledAlias).toBeInstanceOf(Date);
      expect(scheduledAlias.toISOString()).toBe("2026-12-12T18:00:00.000Z");
    });
  });

  describe("4. Resolução Dinâmica Integrada em enrollLead", () => {
    it("Lead cadastrado com aniversario_casamento e data_retorno no banco tem os valores recuperados e os jobs agendados sem envio no payload", async () => {
      mockQuery.mockImplementation(async (sql, params) => {
        if (sql.includes("INSERT INTO followup_schedules")) {
          return { rows: [{ id: "sched-novas-ancoras" }] };
        }
        if (sql.includes("FROM followup_companies")) {
          return { rows: [{ tenant_id: "geracao-digital" }] };
        }
        // Resolução dinâmica de aniversario_casamento
        if (sql.includes("aniversario_casamento")) {
          return { rows: [{ aniversario_casamento: "2016-11-20" }] };
        }
        // Resolução dinâmica de data_retorno
        if (sql.includes("data_retorno")) {
          return { rows: [{ data_retorno: "2027-02-10T14:00:00.000Z" }] };
        }
        if (sql.includes("INSERT INTO followup_jobs")) {
          return { rows: [{ id: `job-${Math.random()}` }] };
        }
        return { rows: [] };
      });

      const supabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: "step-1",
                name: "Casamento Parabéns",
                order_index: 0,
                trigger_type: "before_anchor",
                anchor_field: "aniversario_casamento",
                trigger_value: 1,
                trigger_unit: "days",
                is_active: true,
              },
              {
                id: "step-2",
                name: "Pós Retorno",
                order_index: 1,
                trigger_type: "after_anchor",
                anchor_field: "data_retorno",
                trigger_value: 3,
                trigger_unit: "days",
                is_active: true,
              },
            ],
            error: null,
          }),
        }),
      };
      mockGetSupabase.mockReturnValue(supabase);

      const campaign = { id: "camp-full-anchors", company_id: "comp-1" };
      const enrollResult = await enrollLead(campaign, {
        lead_name: "Renata e Bruno",
        phone: "34988776655",
      });

      expect(enrollResult.enqueued).toBe(2);
      expect(enrollResult.skippedSteps).toHaveLength(0);

      // Confirma que ambas as colunas foram buscadas na tabela do lead
      const casamentoQuery = mockQuery.mock.calls.find((c) => c[0].includes("aniversario_casamento"));
      expect(casamentoQuery).toBeDefined();

      const retornoQuery = mockQuery.mock.calls.find((c) => c[0].includes("data_retorno"));
      expect(retornoQuery).toBeDefined();
    });
  });

  describe("5. Migração Idempotente de Banco (ensureLeadAnchorColumns)", () => {
    it("ensureLeadAnchorColumns executa ALTER TABLE ADD COLUMN IF NOT EXISTS para as 3 colunas", async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };

      await ensureLeadAnchorColumns(mockPool);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const alterSql = mockPool.query.mock.calls[0][0];
      expect(alterSql).toContain("ADD COLUMN IF NOT EXISTS aniversario_casamento DATE");
      expect(alterSql).toContain("ADD COLUMN IF NOT EXISTS epoca_ferias DATE");
      expect(alterSql).toContain("ADD COLUMN IF NOT EXISTS data_retorno TIMESTAMPTZ");
    });
  });
});
