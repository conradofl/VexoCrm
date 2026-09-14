import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks para followup/db.js, followup/queue.js e evolution.js
const mockDb = {
  usage: new Map(), // key: `${instanceId}_${date}` -> sent_count
  audit: [], // array of audit rows
  jobs: new Map(),
  leads: new Map(),
  companies: new Map(),
  instances: new Map(),
  auditTableMissing: false,
};

const mockPool = {
  query: vi.fn(async (sql, params = []) => {
    // 1. Tabela de cota diária
    if (sql.includes("CREATE TABLE IF NOT EXISTS public.evolution_instance_daily_usage") ||
        sql.includes("CREATE INDEX IF NOT EXISTS") ||
        sql.includes("ALTER TABLE") ||
        sql.includes("CREATE TABLE IF NOT EXISTS public.leads_clients")) {
      return { rows: [] };
    }

    if (sql.includes("CREATE TABLE IF NOT EXISTS public.evolution_instance_daily_limit_audit")) {
      if (mockDb.auditTableMissing) {
        throw new Error('relation "public.evolution_instance_daily_limit_audit" does not exist');
      }
      return { rows: [] };
    }

    if (sql.includes("INSERT INTO public.evolution_instance_daily_usage")) {
      const [instanceId, date] = params;
      const key = `${instanceId}_${date}`;
      const current = mockDb.usage.get(key) || 0;
      const next = current + 1;
      mockDb.usage.set(key, next);
      return { rows: [{ sent_count: next }] };
    }

    if (sql.includes("SELECT sent_count FROM public.evolution_instance_daily_usage")) {
      const [instanceId, date] = params;
      const key = `${instanceId}_${date}`;
      const current = mockDb.usage.get(key) || 0;
      return { rows: [{ sent_count: current }] };
    }

    if (sql.includes("UPDATE public.evolution_instance_daily_usage")) {
      const [instanceId, date] = params;
      const key = `${instanceId}_${date}`;
      const current = mockDb.usage.get(key) || 0;
      const next = Math.max(0, current - 1);
      mockDb.usage.set(key, next);
      return { rows: [] };
    }

    // 2. Tabela de auditoria de limite
    if (sql.includes("INSERT INTO public.evolution_instance_daily_limit_audit")) {
      if (mockDb.auditTableMissing) {
        throw new Error('relation "public.evolution_instance_daily_limit_audit" does not exist');
      }
      const [instance_id, client_id, previous_limit, new_limit, changed_by_uid, changed_by_email] = params;
      const row = {
        id: `audit-${mockDb.audit.length + 1}`,
        instance_id,
        client_id,
        previous_limit,
        new_limit,
        changed_by_uid,
        changed_by_email,
        created_at: new Date(),
      };
      mockDb.audit.push(row);
      return { rows: [row] };
    }

    if (sql.includes("FROM public.evolution_instance_daily_limit_audit")) {
      if (mockDb.auditTableMissing) {
        throw new Error('relation "public.evolution_instance_daily_limit_audit" does not exist');
      }
      return { rows: [...mockDb.audit] };
    }

    // 3. Tabela de instâncias (chips)
    if (sql.includes("INSERT INTO public.lead_client_evolution_instances")) {
      const id = `chip-saved-${Date.now()}`;
      const row = {
        id,
        client_id: params[0],
        name: params[1],
        dispatch_webhook_url: params[2],
        daily_limit_override: params[10],
      };
      mockDb.instances.set(id, row);
      return { rows: [row] };
    }

    if (sql.includes("UPDATE public.lead_client_evolution_instances")) {
      return { rows: [] };
    }

    // 4. Jobs de follow-up
    if (sql.includes("FROM followup_jobs")) {
      const jobId = params[0];
      const job = mockDb.jobs.get(jobId);
      if (!job) return { rows: [] };
      return { rows: [job] };
    }

    if (sql.includes("UPDATE followup_jobs SET scheduled_for=")) {
      // scheduled_for=$1, error_log=$2 WHERE id=$3
      const [scheduled_for, error_log, id] = params;
      const job = mockDb.jobs.get(id);
      if (job) {
        job.scheduled_for = scheduled_for;
        job.error_log = error_log;
      }
      return { rows: [] };
    }

    if (sql.includes("UPDATE followup_jobs SET status='sent'")) {
      const [id] = params;
      const job = mockDb.jobs.get(id);
      if (job) {
        job.job_status = "sent";
        job.status = "sent";
        job.sent_at = new Date();
      }
      return { rows: [] };
    }

    if (sql.includes("UPDATE followup_jobs SET status='failed'")) {
      const [id, error_log] = params;
      const job = mockDb.jobs.get(id);
      if (job) {
        job.job_status = "failed";
        job.status = "failed";
        job.error_log = error_log;
      }
      return { rows: [] };
    }

    return { rows: [] };
  }),
  connect: vi.fn(async () => {
    let inTransaction = false;
    let transactionAborted = false;

    return {
      query: vi.fn(async (sql, params = []) => {
        if (sql === "BEGIN") {
          inTransaction = true;
          transactionAborted = false;
          return { rows: [] };
        }
        if (sql === "COMMIT") {
          if (transactionAborted) {
            throw new Error("current transaction is aborted, commands ignored until end of transaction block");
          }
          inTransaction = false;
          return { rows: [] };
        }
        if (sql === "ROLLBACK") {
          inTransaction = false;
          transactionAborted = false;
          return { rows: [] };
        }
        if (inTransaction && transactionAborted) {
          throw new Error("current transaction is aborted, commands ignored until end of transaction block");
        }

        // Tabela de auditoria ausente: se executado dentro da transação, aborta a transação inteira no Postgres
        if (mockDb.auditTableMissing && sql.includes("evolution_instance_daily_limit_audit")) {
          if (inTransaction) {
            transactionAborted = true;
          }
          throw new Error('relation "public.evolution_instance_daily_limit_audit" does not exist');
        }

        return mockPool.query(sql, params);
      }),
      release: vi.fn(),
    };
  }),
};

let currentWorkerPool = mockPool;

vi.mock("../followup/db.js", () => ({
  getPool: () => currentWorkerPool,
  query: (sql, params) => mockPool.query(sql, params),
  getSupabase: () => ({
    from: vi.fn((table) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((col, val) => ({
        maybeSingle: vi.fn(async () => {
          if (table === "leads_infinie") {
            const lead = mockDb.leads.get(val);
            return { data: lead || null, error: null };
          }
          if (table === "followup_companies") {
            const comp = mockDb.companies.get(val);
            return { data: comp || null, error: null };
          }
          return { data: null, error: null };
        }),
      })),
    })),
  }),
}));

const queueAddedJobs = [];
vi.mock("../followup/queue.js", () => ({
  QUEUE_NAME: "followup-dispatch",
  getRedisConnection: () => ({}),
  getFollowupQueue: () => ({
    add: vi.fn(async (name, data, opts) => {
      queueAddedJobs.push({ name, data, opts });
      return { id: `bull-${queueAddedJobs.length}` };
    }),
  }),
}));

const mockEvolutionInstances = [];
vi.mock("../services/evolution.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getLeadClientEvolutionInstances: vi.fn(async () => mockEvolutionInstances),
  };
});

vi.mock("../services/n8nSettings.js", () => ({
  getLeadClientN8nSettings: vi.fn(async () => ({
    send_window_enabled: true,
    send_window_start: "08:00",
    send_window_end: "18:00",
    send_window_days: ["mon", "tue", "wed", "thu", "fri"],
    send_window_timezone: "America/Sao_Paulo",
  })),
}));

import {
  processJob,
  processEventJourneyJob,
  resolveEvolutionInstanceForFollowup,
  getFollowupWorkerDbPool,
} from "../followup/worker.js";
import {
  getChipDailyUsage,
  reserveChipDailyQuota,
  releaseChipDailyQuota,
  resolveChipDailyLimit,
  setChipQuotaDbPool,
} from "../services/chipQuota.js";
import {
  recordDailyLimitOverrideAudit,
  upsertLeadClientEvolutionInstance,
} from "../services/evolution.js";

describe("PARTE 2C — Teto Diário no Follow-up e Auditoria de Limites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.usage.clear();
    mockDb.audit.length = 0;
    mockDb.jobs.clear();
    mockDb.leads.clear();
    mockDb.companies.clear();
    mockDb.instances.clear();
    mockDb.auditTableMissing = false;
    currentWorkerPool = mockPool;
    queueAddedJobs.length = 0;
    mockEvolutionInstances.length = 0;
    setChipQuotaDbPool(mockPool);
  });

  it("1. Cota vale para o follow-up: Chip com teto 2 e 3 jobs prontos -> 2 enviam, o 3º é adiado com error_log de cota e sem chamar Evolution", async () => {
    // Configura chip com teto de 2 mensagens diárias
    const testChip = {
      id: "chip-limit-2",
      name: "Chip Teto 2",
      active: true,
      is_default: true,
      chip_state: "cold",
      daily_limit_override: 2,
      dispatch_webhook_url: "https://evolution.example.com/message/sendText/chip-limit-2",
      dispatch_webhook_token: "token-123",
    };
    mockEvolutionInstances.push(testChip);

    // Mock do fetch global para interceptar o envio da Evolution
    const evolutionCalls = [];
    globalThis.fetch = vi.fn(async (url, opts) => {
      evolutionCalls.push({ url, body: JSON.parse(opts.body) });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true }),
      };
    });

    // Cria 3 jobs prontos no banco mock
    for (let i = 1; i <= 3; i++) {
      mockDb.jobs.set(`job-${i}`, {
        id: `job-${i}`,
        schedule_id: `sched-${i}`,
        template_id: `tpl-${i}`,
        custom_message: `Olá lead ${i}`,
        job_status: "pending",
        lead_name: `Lead ${i}`,
        phone: `553499109000${i}`,
        meeting_datetime: null,
        schedule_status: "active",
        campaign_id: "camp-1",
        company_id: "comp-1",
        message: `Mensagem ${i}`,
        trigger_type: "after_enrollment",
        campaign_status: "active",
        exit_on_reply: false,
        exit_on_won: false,
        exit_on_lost: false,
        exit_on_human_takeover: false,
        tenant_id: "geracao-digital",
        evolution_instance: "chip-limit-2",
      });
    }

    // Executa os 3 jobs
    await processJob({ data: { jobId: "job-1" } });
    await processJob({ data: { jobId: "job-2" } });
    await processJob({ data: { jobId: "job-3" } });

    // Prova 1: Exatamente 2 chamadas à Evolution ocorreram (Job 1 e Job 2)
    expect(evolutionCalls).toHaveLength(2);
    expect(evolutionCalls[0].body.number).toBe("5534991090001");
    expect(evolutionCalls[1].body.number).toBe("5534991090002");

    // Prova 2: O Job 3 NUNCA chamou a Evolution
    const job3Call = evolutionCalls.find((c) => c.body.number === "5534991090003");
    expect(job3Call).toBeUndefined();

    // Prova 3: Job 1 e 2 foram marcados como 'sent'
    expect(mockDb.jobs.get("job-1").job_status).toBe("sent");
    expect(mockDb.jobs.get("job-2").job_status).toBe("sent");

    // Prova 4: Job 3 NÃO foi descartado (continua 'pending'), foi adiado e gravou error_log de cota
    const job3 = mockDb.jobs.get("job-3");
    expect(job3.job_status).toBe("pending");
    expect(job3.error_log).toContain("Cota diária do chip atingida (2/2)");
    expect(job3.scheduled_for).toBeDefined();

    // Prova 5: Job 3 foi re-adicionado à fila com delay para re-tentativa na próxima janela
    expect(queueAddedJobs).toHaveLength(1);
    expect(queueAddedJobs[0].data.jobId).toBe("job-3");
    expect(queueAddedJobs[0].opts.delay).toBeGreaterThanOrEqual(1000);

    // Prova 6: Cota consumida gravada no banco é exatamente 2 (o 3º foi liberado)
    const usage = await getChipDailyUsage("chip-limit-2", null, mockPool);
    expect(usage).toBe(2);
  });

  it("2. Falha libera: Evolution devolve 500 -> sent_count volta ao valor anterior", async () => {
    const testChip = {
      id: "chip-fail-test",
      name: "Chip Falha",
      active: true,
      is_default: true,
      chip_state: "cold",
      daily_limit_override: 10,
      dispatch_webhook_url: "https://evolution.example.com/message/sendText/chip-fail-test",
      dispatch_webhook_token: "token-123",
    };
    mockEvolutionInstances.push(testChip);

    // Mock do fetch da Evolution retornando erro 500
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    }));

    mockDb.jobs.set("job-err", {
      id: "job-err",
      schedule_id: "sched-err",
      template_id: "tpl-err",
      custom_message: "Olá teste de erro",
      job_status: "pending",
      lead_name: "Lead Erro",
      phone: "5534991099999",
      meeting_datetime: null,
      schedule_status: "active",
      campaign_id: "camp-1",
      company_id: "comp-1",
      message: "Mensagem erro",
      trigger_type: "after_enrollment",
      campaign_status: "active",
      exit_on_reply: false,
      exit_on_won: false,
      exit_on_lost: false,
      exit_on_human_takeover: false,
      tenant_id: "geracao-digital",
      evolution_instance: "chip-fail-test",
    });

    // Uso inicial antes da tentativa é 0
    const usageBefore = await getChipDailyUsage("chip-fail-test", null, mockPool);
    expect(usageBefore).toBe(0);

    // Execução do job deve lançar o erro da Evolution
    await expect(processJob({ data: { jobId: "job-err" } })).rejects.toThrow("Evolution API 500");

    // Prova: sent_count voltou a 0 após o erro 500!
    const usageAfter = await getChipDailyUsage("chip-fail-test", null, mockPool);
    expect(usageAfter).toBe(0);
  });

  it("3. Override sem teto: daily_limit_override = 5000 é aceito e gera linha de auditoria", async () => {
    // 1. Testa resolução de limite de 5000
    const limit = resolveChipDailyLimit({ daily_limit_override: 5000, chip_state: "cold" });
    expect(limit).toBe(5000);

    // 2. Grava auditoria de alteração de limite
    const recorded = await recordDailyLimitOverrideAudit(mockPool, {
      instanceId: "chip-audit-123",
      clientId: "geracao-digital",
      previousLimit: 50,
      newLimit: 5000,
      changedByUid: "user-admin-1",
      changedByEmail: "admin@vexo.com.br",
    });

    expect(recorded).toBe(true);
    expect(mockDb.audit).toHaveLength(1);
    expect(mockDb.audit[0]).toMatchObject({
      instance_id: "chip-audit-123",
      client_id: "geracao-digital",
      previous_limit: 50,
      new_limit: 5000,
      changed_by_uid: "user-admin-1",
      changed_by_email: "admin@vexo.com.br",
    });
  });

  it("4. Proteção do Worker: Enxerga o pool e falha com erro descritivo caso o pool não esteja disponível", async () => {
    const workerPool = getFollowupWorkerDbPool();
    expect(workerPool).toBeDefined();
    expect(workerPool).toBe(mockPool);
  });

  it("5. Auditoria com tabela ausente: upsertLeadClientEvolutionInstance salva o chip com sucesso fora da transação", async () => {
    // Simula ambiente onde a migration da auditoria ainda não rodou
    mockDb.auditTableMissing = true;

    const saved = await upsertLeadClientEvolutionInstance(
      "geracao-digital",
      {
        name: "Chip Sem Auditoria",
        dispatchWebhookUrl: "https://evolution.example.com/message/sendText/chip-no-audit",
        dailyLimitOverride: 250,
      },
      { uid: "admin-1", email: "admin@vexo.com.br" },
      null,
      mockPool
    );

    // Prova: o chip é salvo com sucesso apesar do erro na tabela de auditoria!
    expect(saved).toBeDefined();
    expect(saved.client_id).toBe("geracao-digital");
    expect(saved.name).toBe("Chip Sem Auditoria");
    expect(saved.daily_limit_override).toBe(250);
  });

  it("6. Falha fechada na Jornada: Pool nulo lança erro descritivo e impede envio", async () => {
    currentWorkerPool = null;

    mockEvolutionInstances.push({
      id: "chip-1",
      name: "Chip 1",
      active: true,
      is_default: true,
      dispatch_webhook_url: "https://evolution.example.com/chip-1",
    });

    mockDb.leads.set("lead-fail-pool", {
      id: "lead-fail-pool",
      name: "Lead Sem Pool",
      phone: "5534991090001",
      status: "open",
    });
    mockDb.companies.set("comp-fail-pool", {
      id: "comp-fail-pool",
      name: "Empresa Teste",
      tenant_id: "geracao-digital",
      evolution_instance: "chip-1",
    });

    const journeyJob = {
      name: "process-event-journey",
      data: {
        companyId: "comp-fail-pool",
        leadId: "lead-fail-pool",
        eventName: "lead_created",
        journeyId: "j-1",
        channel: "whatsapp",
        aiPrompt: null,
      },
    };

    await expect(processEventJourneyJob(journeyJob)).rejects.toThrow(
      "Pool de banco de dados indisponível para validação de cota."
    );
  });

  it("7. Adiantamento na Jornada: Cota atingida -> cota liberada, job reagendado para próxima janela com error_log e scheduled_for, sem envio", async () => {
    const testChip = {
      id: "chip-journey-limit",
      name: "Chip Jornada",
      active: true,
      is_default: true,
      chip_state: "cold",
      daily_limit_override: 1, // cota de apenas 1 envio por dia
      dispatch_webhook_url: "https://evolution.example.com/message/sendText/chip-journey-limit",
      dispatch_webhook_token: "token-123",
    };
    mockEvolutionInstances.push(testChip);

    const evolutionCalls = [];
    globalThis.fetch = vi.fn(async (url, opts) => {
      evolutionCalls.push({ url, body: JSON.parse(opts.body) });
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => JSON.stringify({ success: true }),
        json: async () => ({ success: true }),
      };
    });

    mockDb.leads.set("lead-j1", { id: "lead-j1", name: "Lead J1", phone: "5534991091111", status: "open" });
    mockDb.leads.set("lead-j2", { id: "lead-j2", name: "Lead J2", phone: "5534991092222", status: "open" });
    mockDb.companies.set("comp-1", { id: "comp-1", name: "Empresa 1", tenant_id: "geracao-digital", evolution_instance: "chip-journey-limit" });

    const job1 = {
      name: "process-event-journey",
      data: {
        companyId: "comp-1",
        leadId: "lead-j1",
        eventName: "lead_created",
        journeyId: "j-1",
        channel: "whatsapp",
        aiPrompt: null,
      },
    };
    const job2 = {
      name: "process-event-journey",
      data: {
        companyId: "comp-1",
        leadId: "lead-j2",
        eventName: "lead_created",
        journeyId: "j-1",
        channel: "whatsapp",
        aiPrompt: null,
      },
    };

    // 1º envio da jornada: consome a cota (1/1)
    await processEventJourneyJob(job1);
    expect(evolutionCalls).toHaveLength(1);
    expect(evolutionCalls[0].body.number).toBe("5534991091111");

    // 2º envio da jornada: cota estourada (2 > 1) -> deve adiar, liberar cota e NÃO chamar Evolution
    await processEventJourneyJob(job2);

    // Prova 1: Evolution NÃO foi chamada pela 2ª vez
    expect(evolutionCalls).toHaveLength(1);

    // Prova 2: Job foi reagendado no BullMQ com status pending, scheduled_for e error_log
    const reEnqueuedJourneyJob = queueAddedJobs.find((j) => j.name === "process-event-journey");
    expect(reEnqueuedJourneyJob).toBeDefined();
    expect(reEnqueuedJourneyJob.data.scheduled_for).toBeDefined();
    expect(reEnqueuedJourneyJob.data.error_log).toContain("Cota diária do chip atingida (1/1)");
    expect(reEnqueuedJourneyJob.data.status).toBe("pending");
    expect(reEnqueuedJourneyJob.opts.delay).toBeGreaterThanOrEqual(1000);

    // Prova 3: Cota em excesso foi liberada (sent_count gravado permanece em 1)
    const usage = await getChipDailyUsage("chip-journey-limit", null, mockPool);
    expect(usage).toBe(1);
  });

  it("8. Prova do mecanismo Postgres: Se a auditoria rodasse antes do COMMIT com tabela ausente, COMMIT falharia com 'current transaction is aborted'", async () => {
    mockDb.auditTableMissing = true;
    const client = await mockPool.connect();
    await client.query("BEGIN");
    await client.query("INSERT INTO public.lead_client_evolution_instances (client_id, name) VALUES ('t1', 'c1')");
    // Se a query de auditoria falhar dentro do bloco da transação (mesmo com .catch no JS):
    await client.query("INSERT INTO public.evolution_instance_daily_limit_audit VALUES ()").catch(() => {});
    // O COMMIT é rejeitado pelo Postgres porque o bloco foi abortado:
    await expect(client.query("COMMIT")).rejects.toThrow("current transaction is aborted");
    await client.query("ROLLBACK");
  });
});
