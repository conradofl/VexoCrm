import { describe, expect, it, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
const mockGetSupabase = vi.fn();

vi.mock("../followup/db.js", () => ({
  query: (...args) => mockQuery(...args),
  getSupabase: () => mockGetSupabase(),
}));

vi.mock("../followup/queue.js", () => ({
  getFollowupQueue: () => ({
    add: vi.fn().mockResolvedValue({ id: "bull-job-1" }),
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
  resolveLeadAnchorValue,
  resolveLeadBirthDate,
  enrollLead,
} = await import("../followup/service.js");

describe("Item 04 — Generalização de Âncoras no Módulo de Follow-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[TESTE OBRIGATÓRIO] Âncoras com source: 'lead' buscam dinamicamente o campo respectivo na tabela do lead caso não seja informado na chamada", async () => {
    // 1. Cadastra âncora arbitrária com source: 'lead'
    ANCHOR_FIELDS.aniversario_casamento = { source: "lead", recurring: true };

    mockQuery.mockImplementation(async (sql, params) => {
      if (sql.includes("aniversario_casamento")) {
        expect(sql).toContain('FROM public."leads"');
        expect(sql).toContain("client_id = $1");
        expect(sql).toContain("aniversario_casamento IS NOT NULL");
        return { rows: [{ aniversario_casamento: "2018-09-20" }] };
      }
      return { rows: [] };
    });

    const result = await resolveLeadAnchorValue({
      phone: "5534991093607",
      tenantId: "geracao-digital",
      anchorField: "aniversario_casamento",
    });

    expect(result).toBe("2018-09-20");
    expect(mockQuery).toHaveBeenCalledTimes(1);

    // 2. Valida compatibilidade: resolveLeadBirthDate delega para resolveLeadAnchorValue
    mockQuery.mockImplementation(async (sql, params) => {
      if (sql.includes("data_nascimento")) {
        return { rows: [{ data_nascimento: "1992-06-15" }] };
      }
      return { rows: [] };
    });

    const bdayResult = await resolveLeadBirthDate({
      phone: "5534991093607",
      tenantId: "geracao-digital",
    });

    expect(bdayResult).toBe("1992-06-15");
  });

  it("[TESTE OBRIGATÓRIO] O agendador (enrollLead) resolve valores de âncoras arbitrárias cadastradas em ANCHOR_FIELDS sem ficar preso na string literal 'data_nascimento'", async () => {
    // Cadastra âncora arbitrária
    ANCHOR_FIELDS.data_retorno = { source: "lead", recurring: false };

    mockQuery.mockImplementation(async (sql, params) => {
      if (sql.includes("INSERT INTO followup_schedules")) {
        return { rows: [{ id: "sched-anchor-1" }] };
      }
      if (sql.includes("FROM followup_companies")) {
        return { rows: [{ tenant_id: "geracao-digital" }] };
      }
      // Busca dinâmica da âncora data_retorno no banco
      if (sql.includes("data_retorno")) {
        return { rows: [{ data_retorno: "2027-05-15T10:00:00.000Z" }] };
      }
      if (sql.includes("INSERT INTO followup_jobs")) {
        return { rows: [{ id: "job-anchor-1" }] };
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
              id: "step-retorno",
              name: "Lembrete Data de Retorno",
              order_index: 0,
              trigger_type: "before_anchor",
              anchor_field: "data_retorno",
              trigger_value: 2,
              trigger_unit: "days",
              scheduled_time: "09:00",
              is_active: true,
            },
          ],
          error: null,
        }),
      }),
    };
    mockGetSupabase.mockReturnValue(supabase);

    const campaign = { id: "camp-anchor-1", company_id: "comp-1" };
    const enrollResult = await enrollLead(campaign, {
      lead_name: "Eduardo Silva",
      phone: "34999998888",
    });

    expect(enrollResult.enqueued).toBe(1);
    expect(enrollResult.skippedSteps).toHaveLength(0);

    // Garante que o banco foi consultado para a coluna 'data_retorno'
    const leadQueryCall = mockQuery.mock.calls.find((c) => c[0].includes("data_retorno"));
    expect(leadQueryCall).toBeDefined();

    // Garante que o job foi inserido com a data calculada a partir de data_retorno
    const jobInsertCall = mockQuery.mock.calls.find((c) => c[0].includes("INSERT INTO followup_jobs"));
    expect(jobInsertCall).toBeDefined();
    expect(jobInsertCall[1][2]).toBeDefined(); // scheduled_for
  });

  it("[TESTE OBRIGATÓRIO] Colunas inexistentes ou âncoras com source: 'schedule' (como meeting_datetime) não tentam disparar query de lead", async () => {
    // 1. Âncora 'meeting_datetime' tem source: 'schedule'
    const resultMeeting = await resolveLeadAnchorValue({
      phone: "34999998888",
      tenantId: "geracao-digital",
      anchorField: "meeting_datetime",
    });
    expect(resultMeeting).toBeNull();

    // 2. Coluna que não existe em ANCHOR_FIELDS
    const resultInexistente = await resolveLeadAnchorValue({
      phone: "34999998888",
      tenantId: "geracao-digital",
      anchorField: "campo_inexistente_qualquer",
    });
    expect(resultInexistente).toBeNull();

    // 3. Nenhuma consulta ao banco de leads pode ter sido disparada
    expect(mockQuery).not.toHaveBeenCalled();

    // 4. No enrollLead, passo com meeting_datetime não consulta tabela de leads
    mockQuery.mockImplementation(async (sql, params) => {
      if (sql.includes("INSERT INTO followup_schedules")) {
        return { rows: [{ id: "sched-sched-1" }] };
      }
      if (sql.includes("FROM followup_companies")) {
        return { rows: [{ tenant_id: "geracao-digital" }] };
      }
      if (sql.includes("INSERT INTO followup_jobs")) {
        return { rows: [{ id: "job-sched-1" }] };
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
              id: "step-meeting",
              name: "Confirmação de Reunião",
              order_index: 0,
              trigger_type: "before_anchor",
              anchor_field: "meeting_datetime",
              trigger_value: 1,
              trigger_unit: "days",
              scheduled_time: "09:00",
              is_active: true,
            },
          ],
          error: null,
        }),
      }),
    };
    mockGetSupabase.mockReturnValue(supabase);

    const campaign = { id: "camp-meeting-1", company_id: "comp-1" };
    await enrollLead(campaign, {
      lead_name: "Carla Reunião",
      phone: "34999997777",
      meeting_datetime: "2026-11-20T14:00:00.000Z",
    });

    // Garante que NUNCA houve SELECT de lead para meeting_datetime
    const selectLeadCalls = mockQuery.mock.calls.filter((c) => c[0].includes('FROM public."leads"'));
    expect(selectLeadCalls).toHaveLength(0);
  });
});
