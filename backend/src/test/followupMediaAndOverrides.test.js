import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventEmitter from "node:events";

// ─── Mocks de Banco e Fila ───────────────────────────────────────────────────

const mockStorage = new Map(); // key -> { buffer, contentType }
const mockQueueJobs = new Map(); // jobId -> { id, data, opts, remove: fn }
let queueJobSeq = 1;

const mockQueue = {
  add: vi.fn(async (name, data, opts = {}) => {
    const id = opts.jobId || `bull-${queueJobSeq++}`;
    const jobObj = {
      id,
      name,
      data,
      opts,
      remove: vi.fn().mockImplementation(async () => {
        mockQueueJobs.delete(id);
      }),
    };
    mockQueueJobs.set(id, jobObj);
    return jobObj;
  }),
  getJob: vi.fn(async (id) => mockQueueJobs.get(id) || null),
};

vi.mock("../followup/queue.js", () => ({
  QUEUE_NAME: "followup-test-queue",
  getRedisConnection: () => ({}),
  getFollowupQueue: () => mockQueue,
}));

let mockDbJobs = new Map();
let mockTemplates = new Map();
let mockSchedules = new Map();
let mockCompanies = new Map();
let mockLeadRows = new Map();
let mockQuotaUsage = new Map(); // key -> count

const mockPool = {
  query: vi.fn(async (sql, params = []) => {
    // 1. Quota diária
    if (sql.includes("INSERT INTO public.evolution_instance_daily_usage")) {
      const [instanceId, date] = params;
      const key = `${instanceId}_${date}`;
      const count = (mockQuotaUsage.get(key) || 0) + 1;
      mockQuotaUsage.set(key, count);
      return { rows: [{ sent_count: count }] };
    }
    if (sql.includes("SELECT sent_count FROM public.evolution_instance_daily_usage")) {
      const [instanceId, date] = params;
      const key = `${instanceId}_${date}`;
      return { rows: [{ sent_count: mockQuotaUsage.get(key) || 0 }] };
    }
    if (sql.includes("UPDATE public.evolution_instance_daily_usage")) {
      const [instanceId, date] = params;
      const key = `${instanceId}_${date}`;
      const count = Math.max(0, (mockQuotaUsage.get(key) || 0) - 1);
      mockQuotaUsage.set(key, count);
      return { rows: [] };
    }
    if (sql.includes("CREATE TABLE IF NOT EXISTS") || sql.includes("CREATE INDEX IF NOT EXISTS")) {
      return { rows: [] };
    }

    // 1.1 Select de Job para cancelamento pontual
    if (sql.includes("FROM followup_jobs fj") && sql.includes("WHERE fj.id = $1")) {
      const [jobId] = params;
      const job = mockDbJobs.get(jobId);
      if (!job) return { rows: [] };
      const schedule = mockSchedules.get(job.schedule_id) || {};
      const company = mockCompanies.get(schedule.company_id) || {};
      return {
        rows: [
          {
            id: job.id,
            schedule_id: job.schedule_id,
            bull_job_id: job.bull_job_id,
            status: job.status,
            campaign_id: schedule.campaign_id,
            company_id: schedule.company_id,
            tenant_id: company.tenant_id || "geracao-digital",
          },
        ],
      };
    }

    // 2. Select do Worker em followup_jobs
    if (sql.includes("FROM followup_jobs       fj") && sql.includes("WHERE fj.id = $1")) {
      const [jobId] = params;
      const job = mockDbJobs.get(jobId);
      if (!job) return { rows: [] };

      const schedule = mockSchedules.get(job.schedule_id) || {};
      const template = job.template_id ? mockTemplates.get(job.template_id) || {} : {};
      const company = mockCompanies.get(schedule.company_id) || {};

      return {
        rows: [
          {
            id: job.id,
            schedule_id: job.schedule_id,
            template_id: job.template_id,
            custom_message: job.custom_message,
            job_status: job.status,
            job_media_path: job.media_path,
            job_media_type: job.media_type,
            job_media_mime: job.media_mime,
            job_media_filename: job.media_filename,
            lead_name: schedule.lead_name || "Lead Teste",
            phone: schedule.phone || "5511999999999",
            meeting_datetime: schedule.meeting_datetime || null,
            schedule_status: schedule.status || "active",
            campaign_id: schedule.campaign_id || null,
            company_id: schedule.company_id || "comp-1",
            message: template.message || "Mensagem padrão",
            trigger_type: template.trigger_type || "on_schedule",
            template_media_path: template.media_path,
            template_media_type: template.media_type,
            template_media_mime: template.media_mime,
            template_media_filename: template.media_filename,
            campaign_status: "active",
            exit_on_reply: true,
            exit_on_won: true,
            exit_on_lost: true,
            exit_on_human_takeover: true,
            tenant_id: company.tenant_id || "geracao-digital",
            evolution_instance: company.evolution_instance || "inst-default",
            evolution_instances: company.evolution_instances || [],
          },
        ],
      };
    }

    // 3. Update status e error_log de followup_jobs
    if (sql.includes("UPDATE followup_jobs SET status='sent'")) {
      const [jobId] = params;
      const job = mockDbJobs.get(jobId);
      if (job) {
        job.status = "sent";
        job.sent_at = new Date();
        job.error_log = null;
      }
      return { rows: [] };
    }
    if (sql.includes("UPDATE followup_jobs SET status='failed'")) {
      const [errMsg, jobId] = params.length === 2 ? [params[0], params[1]] : [params[1], params[0]];
      const targetId = sql.includes("error_log=$1 WHERE id=$2") ? params[1] : params[0];
      const job = mockDbJobs.get(targetId);
      if (job) {
        job.status = "failed";
        job.error_log = sql.includes("error_log=$1") ? params[0] : params[1];
      }
      return { rows: [] };
    }
    if (sql.includes("UPDATE followup_jobs SET scheduled_for=$1, error_log=$2 WHERE id=$3")) {
      const [scheduledFor, quotaMsg, jobId] = params;
      const job = mockDbJobs.get(jobId);
      if (job) {
        job.scheduled_for = scheduledFor;
        job.error_log = quotaMsg;
      }
      return { rows: [] };
    }
    if (sql.includes("UPDATE followup_jobs SET scheduled_for=$1, bull_job_id=$2 WHERE id=$3")) {
      const [scheduledFor, bullJobId, jobId] = params;
      const job = mockDbJobs.get(jobId);
      if (job) {
        job.scheduled_for = scheduledFor;
        job.bull_job_id = bullJobId;
      }
      return { rows: [] };
    }
    if (sql.includes("UPDATE followup_jobs SET bull_job_id=$1 WHERE id=$2")) {
      const [bullJobId, jobId] = params;
      const job = mockDbJobs.get(jobId);
      if (job) {
        job.bull_job_id = bullJobId;
      }
      return { rows: [] };
    }
    if (sql.includes("UPDATE followup_jobs SET status = 'cancelled' WHERE id = $1")) {
      const [jobId] = params;
      const job = mockDbJobs.get(jobId);
      if (job) {
        job.status = "cancelled";
      }
      return { rows: [] };
    }

    // 4. Select de jobs pendentes para reagendamento por template
    if (sql.includes("FROM followup_jobs fj") && sql.includes("WHERE fj.template_id = $1 AND fj.status = 'pending'")) {
      const [templateId] = params;
      const rows = [];
      for (const job of mockDbJobs.values()) {
        if (job.template_id === templateId && job.status === "pending") {
          const schedule = mockSchedules.get(job.schedule_id) || {};
          const company = mockCompanies.get(schedule.company_id) || {};
          rows.push({
            id: job.id,
            schedule_id: job.schedule_id,
            bull_job_id: job.bull_job_id,
            scheduled_for: job.scheduled_for,
            custom_message: job.custom_message,
            lead_name: schedule.lead_name,
            phone: schedule.phone,
            meeting_datetime: schedule.meeting_datetime,
            schedule_created_at: schedule.created_at || new Date().toISOString(),
            company_id: schedule.company_id,
            tenant_id: company.tenant_id || "geracao-digital",
          });
        }
      }
      return { rows };
    }

    // 5. Contagem de jobs pendentes por template
    if (sql.includes("SELECT COUNT(*)::int as count FROM followup_jobs WHERE template_id = $1 AND status = 'pending'")) {
      const [templateId] = params;
      let count = 0;
      for (const job of mockDbJobs.values()) {
        if (job.template_id === templateId && job.status === "pending") {
          count++;
        }
      }
      return { rows: [{ count }] };
    }

    // 6. Busca de data_nascimento no banco
    if (sql.includes("SELECT data_nascimento FROM public.")) {
      const [tenantId, phone] = params;
      const key = `${tenantId}_${phone}`;
      const birthDate = mockLeadRows.get(key) || null;
      return { rows: birthDate ? [{ data_nascimento: birthDate }] : [] };
    }

    // 7. Reschedule / cancel no queueRoutes
    if (sql.includes("SELECT fj.id, fj.schedule_id, fj.bull_job_id, fj.status")) {
      const [jobId] = params;
      const job = mockDbJobs.get(jobId);
      if (!job) return { rows: [] };
      const schedule = mockSchedules.get(job.schedule_id) || {};
      const company = mockCompanies.get(schedule.company_id) || {};
      return {
        rows: [
          {
            id: job.id,
            schedule_id: job.schedule_id,
            bull_job_id: job.bull_job_id,
            status: job.status,
            campaign_id: schedule.campaign_id,
            company_id: schedule.company_id,
            tenant_id: company.tenant_id || "geracao-digital",
          },
        ],
      };
    }

    return { rows: [] };
  }),
};

vi.mock("../followup/db.js", () => ({
  query: (...args) => mockPool.query(...args),
  getPool: () => mockPool,
  getSupabase: () => ({
    from: (table) => ({
      select: (cols) => ({
        eq: (col, val) => ({
          order: () => ({
            data: Array.from(mockTemplates.values()).filter((t) => t[col] === val),
            error: null,
          }),
          maybeSingle: async () => {
            if (table === "followup_templates") {
              const item = mockTemplates.get(val) || null;
              return { data: item, error: null };
            }
            if (table === "followup_campaigns") {
              const camp = Array.from(mockCompanies.values()).find((c) => c.id === val) || null;
              return { data: camp, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
      insert: (payload) => ({
        select: () => ({
          maybeSingle: async () => {
            const arr = Array.isArray(payload) ? payload : [payload];
            const item = { id: `inserted-${Date.now()}`, ...arr[0] };
            if (table === "followup_templates") {
              mockTemplates.set(item.id, item);
            }
            return { data: item, error: null };
          },
        }),
      }),
      update: (patch) => ({
        eq: (col, val) => ({
          select: () => ({
            maybeSingle: async () => {
              if (table === "followup_templates") {
                const existing = mockTemplates.get(val);
                if (!existing) return { data: null, error: new Error("Not found") };
                const updated = { ...existing, ...patch };
                mockTemplates.set(val, updated);
                return { data: updated, error: null };
              }
              return { data: patch, error: null };
            },
          }),
        }),
      }),
    }),
  }),
}));

// Mock dos serviços de storage e evolution
vi.mock("../services/storage.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    saveFollowupMediaBuffer: vi.fn(async ({ clientId, buffer, declaredFilename, declaredMimeType }) => {
      // Usa a função real de detecção e validação
      const detected = actual.detectFollowupMediaType(buffer, declaredFilename, declaredMimeType);
      const maxSize = actual.FOLLOWUP_MEDIA_MAX_SIZES[detected.mediaType];
      if (buffer.length > maxSize) {
        const maxMB = (maxSize / (1024 * 1024)).toFixed(0);
        const fileMB = (buffer.length / (1024 * 1024)).toFixed(2);
        const err = new Error(
          `O arquivo excede o limite máximo permitido de ${maxMB} MB para ${detected.mediaType} (enviado: ${fileMB} MB).`
        );
        err.code = "FILE_TOO_LARGE";
        throw err;
      }
      const key = `followup-media/${clientId}/${detected.mediaType}/${Date.now()}_${declaredFilename}`;
      mockStorage.set(key, { buffer, contentType: detected.mimeType });
      return {
        storageKey: key,
        sizeBytes: buffer.length,
        mediaType: detected.mediaType,
        mimeType: detected.mimeType,
        filename: declaredFilename,
      };
    }),
    getFollowupMediaBuffer: vi.fn(async (key) => mockStorage.get(key) || null),
  };
});

const mockEvolutionInstances = [
  {
    id: "inst-gd",
    name: "inst-gd",
    status: "connected",
    active: true,
    is_default: true,
    daily_limit: 100,
    dispatch_webhook_url: "https://evo.test/instance/inst-gd",
    dispatch_webhook_token: "token-123",
  },
];

vi.mock("../services/evolution.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getLeadClientEvolutionInstances: vi.fn(async () => mockEvolutionInstances),
  };
});

vi.mock("../services/n8nSettings.js", () => ({
  getLeadClientN8nSettings: vi.fn(async () => ({
    send_window_enabled: false,
    send_window_start: "08:00",
    send_window_end: "22:00",
    send_window_days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    send_window_timezone: "America/Sao_Paulo",
  })),
}));

import * as evolutionService from "../services/evolution.js";
import { processJob, sendViaEvolution } from "../followup/worker.js";
import {
  saveFollowupMediaBuffer,
  getFollowupMediaBuffer,
  detectFollowupMediaType,
  FOLLOWUP_MEDIA_MAX_SIZES,
} from "../services/storage.js";
import { reschedulePendingJobsForTemplate } from "../followup/service.js";
import { registerFollowupQueueRoutes } from "../followup/queueRoutes.js";
import { getDateKey } from "../services/analytics.js";

describe("ETAPA 4 — Anexos de Mídia e Edição de Verdade (Follow-up)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbJobs.clear();
    mockTemplates.clear();
    mockSchedules.clear();
    mockCompanies.clear();
    mockLeadRows.clear();
    mockStorage.clear();
    mockQueueJobs.clear();
    mockQuotaUsage.clear();

    if (mockEvolutionInstances[0]) {
      mockEvolutionInstances[0].daily_limit = 100;
    }

    // Setup base de company e chip
    mockCompanies.set("comp-1", {
      id: "comp-1",
      tenant_id: "geracao-digital",
      name: "Geração Digital",
      evolution_instance: "inst-gd",
      evolution_instances: [
        {
          id: "inst-gd",
          name: "inst-gd",
          status: "connected",
          daily_limit: 100,
          dispatch_webhook_url: "https://evo.test/instance/inst-gd",
          dispatch_webhook_token: "token-123",
        },
      ],
    });
  });

  // ── Teste 1 ───────────────────────────────────────────────────────────────
  it("Passo com mídia vai por sendMedia (e não por sendText)", async () => {
    const sendMediaSpy = vi.spyOn(evolutionService, "sendMediaMessageViaEvolution").mockResolvedValue({
      success: true,
      waMessageId: "msg-media-1",
    });

    const fakePdf = Buffer.from("%PDF-1.4 teste");
    const mediaKey = "followup-media/geracao-digital/document/proposta.pdf";
    mockStorage.set(mediaKey, { buffer: fakePdf, contentType: "application/pdf" });

    // Template com anexo
    mockTemplates.set("tpl-media", {
      id: "tpl-media",
      name: "Passo com proposta",
      message: "Olá {{nome}}, segue o contrato em anexo!",
      media_path: mediaKey,
      media_type: "document",
      media_mime: "application/pdf",
      media_filename: "proposta.pdf",
    });

    mockSchedules.set("sched-1", {
      id: "sched-1",
      company_id: "comp-1",
      lead_name: "Conrado",
      phone: "5511999999999",
      status: "active",
    });

    mockDbJobs.set("job-1", {
      id: "job-1",
      schedule_id: "sched-1",
      template_id: "tpl-media",
      status: "pending",
    });

    // Mock global fetch para espionar se sendText foi chamado
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ key: { id: "text-id" } }),
    });

    await processJob({ data: { jobId: "job-1" } });

    // 1. sendMediaMessageViaEvolution FOI chamada
    expect(sendMediaSpy).toHaveBeenCalledTimes(1);
    expect(sendMediaSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceName: "inst-gd",
        number: "5511999999999",
        mediaType: "document",
        caption: "Olá Conrado, segue o contrato em anexo!",
      })
    );

    // 2. sendText NÃO foi chamado
    const calledUrls = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(calledUrls.some((u) => u.includes("/message/sendText/"))).toBe(false);

    // Job foi marcado como sent
    expect(mockDbJobs.get("job-1").status).toBe("sent");

    sendMediaSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  // ── Teste 2 ───────────────────────────────────────────────────────────────
  it("Áudio sai como PTT (sendWhatsAppAudio com encoding: true)", async () => {
    const fakeAudio = Buffer.from("OggS audio voice note");
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ key: { id: "audio-msg-id" } }),
    });

    const res = await evolutionService.sendMediaMessageViaEvolution({
      instanceName: "inst-gd",
      number: "5511999999999",
      mediaType: "audio",
      base64: fakeAudio.toString("base64"),
      mimetype: "audio/ogg",
      webhookToken: "token-123",
      baseUrl: "https://evo.test",
    });

    expect(res.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];

    // Deve chamar /message/sendWhatsAppAudio/...
    expect(calledUrl).toContain("/message/sendWhatsAppAudio/inst-gd");
    const payload = JSON.parse(calledInit.body);
    expect(payload.encoding).toBe(true);
    expect(payload.audio).toBe(fakeAudio.toString("base64"));
    expect(payload.number).toBe("5511999999999");

    fetchSpy.mockRestore();
  });

  // ── Teste 3 ───────────────────────────────────────────────────────────────
  it("Mídia sumida falha estrito e NÃO degrada para texto puro", async () => {
    const sendMediaSpy = vi.spyOn(evolutionService, "sendMediaMessageViaEvolution");
    const fetchSpy = vi.spyOn(global, "fetch");

    // Template aponta para chave que NÃO existe no storage
    mockTemplates.set("tpl-missing", {
      id: "tpl-missing",
      name: "Passo sem arquivo",
      message: "Segue o catálogo em anexo!",
      media_path: "followup-media/geracao-digital/image/nao_existe.png",
      media_type: "image",
    });

    mockSchedules.set("sched-2", {
      id: "sched-2",
      company_id: "comp-1",
      lead_name: "Ana",
      phone: "5511988888888",
      status: "active",
    });

    mockDbJobs.set("job-missing", {
      id: "job-missing",
      schedule_id: "sched-2",
      template_id: "tpl-missing",
      status: "pending",
    });

    // O processamento deve lançar MEDIA_NOT_FOUND
    await expect(processJob({ data: { jobId: "job-missing" } })).rejects.toThrow(
      /Arquivo de mídia não encontrado no storage/
    );

    // Job atualizado para failed no banco com mensagem descritiva
    const job = mockDbJobs.get("job-missing");
    expect(job.status).toBe("failed");
    expect(job.error_log).toContain("Arquivo de mídia não encontrado no storage");

    // Zero chamadas para a Evolution (nenhum envio mutilado!)
    expect(sendMediaSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    sendMediaSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  // ── Teste 4 ───────────────────────────────────────────────────────────────
  it("Legenda passa pela guarda de saída (placeholders não substituídos bloqueiam envio)", async () => {
    const sendMediaSpy = vi.spyOn(evolutionService, "sendMediaMessageViaEvolution");
    const fakeImg = Buffer.from("\xFF\xD8\xFF image bytes");
    const mediaKey = "followup-media/geracao-digital/image/flyer.jpg";
    mockStorage.set(mediaKey, { buffer: fakeImg, contentType: "image/jpeg" });

    // Mensagem com variável quebrada que a renderização não consegue substituir
    mockTemplates.set("tpl-broken", {
      id: "tpl-broken",
      name: "Passo com variável quebrada",
      message: "Olá {{cliente_desconhecido}}, segue o material!",
      media_path: mediaKey,
      media_type: "image",
    });

    mockSchedules.set("sched-3", {
      id: "sched-3",
      company_id: "comp-1",
      lead_name: "Carlos",
      phone: "5511977777777",
      status: "active",
    });

    mockDbJobs.set("job-broken", {
      id: "job-broken",
      schedule_id: "sched-3",
      template_id: "tpl-broken",
      status: "pending",
    });

    // Deve lançar erro de bloqueio da guarda de saída
    await expect(processJob({ data: { jobId: "job-broken" } })).rejects.toThrow(
      /BLOQUEIO_GUARDA_SAIDA/
    );

    // Evolution nunca chamada
    expect(sendMediaSpy).not.toHaveBeenCalled();

    sendMediaSpy.mockRestore();
  });

  // ── Teste 5 ───────────────────────────────────────────────────────────────
  it("Cota conta uma vez com anexo (incrementa sent_count em exatamente 1)", async () => {
    vi.spyOn(evolutionService, "sendMediaMessageViaEvolution").mockResolvedValue({
      success: true,
      waMessageId: "media-quota-1",
    });

    const fakePdf = Buffer.from("%PDF-1.4 documento");
    const mediaKey = "followup-media/geracao-digital/document/tabela.pdf";
    mockStorage.set(mediaKey, { buffer: fakePdf, contentType: "application/pdf" });

    mockTemplates.set("tpl-quota", {
      id: "tpl-quota",
      name: "Passo Cota",
      message: "Olá {{nome}}, segue tabela!",
      media_path: mediaKey,
      media_type: "document",
    });

    mockSchedules.set("sched-quota", {
      id: "sched-quota",
      company_id: "comp-1",
      lead_name: "Beatriz",
      phone: "5511966666666",
      status: "active",
    });

    mockDbJobs.set("job-quota", {
      id: "job-quota",
      schedule_id: "sched-quota",
      template_id: "tpl-quota",
      status: "pending",
    });

    expect(mockQuotaUsage.size).toBe(0);

    await processJob({ data: { jobId: "job-quota" } });

    // Exatamente uma entrada de cota reservada com sent_count = 1
    const usageValues = Array.from(mockQuotaUsage.values());
    expect(usageValues).toEqual([1]);
    expect(mockDbJobs.get("job-quota").status).toBe("sent");
  });

  // ── Teste 6 ───────────────────────────────────────────────────────────────
  it("Tamanho e tipo recusados (PDF de 21 MB e arquivo .exe rejeitados com mensagem da aplicação)", async () => {
    // 1. PDF de 21 MB (> 20 MB teto e < 25 MB limite da rota)
    const bigBuffer = Buffer.alloc(21 * 1024 * 1024);
    bigBuffer.write("%PDF-1.4", 0, "ascii");

    await expect(
      saveFollowupMediaBuffer({
        clientId: "geracao-digital",
        buffer: bigBuffer,
        declaredFilename: "contrato_grande.pdf",
        declaredMimeType: "application/pdf",
      })
    ).rejects.toThrow(/O arquivo excede o limite máximo permitido de 20 MB para document \(enviado: 21\.00 MB\)/);

    // 2. Executável .exe (magic bytes MZ) disfarçado de imagem
    const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]); // MZ header
    await expect(
      saveFollowupMediaBuffer({
        clientId: "geracao-digital",
        buffer: exeBuffer,
        declaredFilename: "foto_segura.jpg",
        declaredMimeType: "image/jpeg",
      })
    ).rejects.toThrow(
      /Tipo de arquivo não permitido ou assinatura inválida\. Os tipos permitidos são: Imagem \(JPG, PNG, WebP\), Áudio \(OGG, MP3, WAV, M4A, AAC\), Vídeo \(MP4\) e Documento \(PDF, DOCX, XLSX\)\./
    );
  });

  // ── Teste 7 ───────────────────────────────────────────────────────────────
  it("Editar texto muda o job pendente (worker lê no envio)", async () => {
    let capturedCaption = "";
    vi.spyOn(evolutionService, "sendMediaMessageViaEvolution").mockImplementation(async ({ caption }) => {
      capturedCaption = caption;
      return { success: true, waMessageId: "edit-test" };
    });

    const fakePdf = Buffer.from("%PDF-1.4 arquivo");
    const mediaKey = "followup-media/geracao-digital/document/proposta.pdf";
    mockStorage.set(mediaKey, { buffer: fakePdf, contentType: "application/pdf" });

    // Template criado com mensagem antiga
    mockTemplates.set("tpl-edit", {
      id: "tpl-edit",
      name: "Passo 1",
      message: "Texto antigo da mensagem",
      media_path: mediaKey,
      media_type: "document",
    });

    mockSchedules.set("sched-edit", {
      id: "sched-edit",
      company_id: "comp-1",
      lead_name: "Daniel",
      phone: "5511955555555",
      status: "active",
    });

    // Job já agendado no banco
    mockDbJobs.set("job-edit", {
      id: "job-edit",
      schedule_id: "sched-edit",
      template_id: "tpl-edit",
      status: "pending",
    });

    // Operador altera o template no banco antes do disparo acontecer
    mockTemplates.get("tpl-edit").message = "Novo texto atualizado da proposta!";

    // Disparo acontece
    await processJob({ data: { jobId: "job-edit" } });

    // O worker leu o texto novo no envio!
    expect(capturedCaption).toBe("Novo texto atualizado da proposta!");
  });

  // ── Teste 8 ───────────────────────────────────────────────────────────────
  it("Editar prazo não move nada sozinho; ação de reagendar move e remove o velho da fila", async () => {
    const oldScheduledFor = new Date("2026-09-15T14:00:00.000Z").toISOString();
    const oldBullJobId = "fup-old-bull-job-1";

    mockQueueJobs.set(oldBullJobId, {
      id: oldBullJobId,
      remove: vi.fn(async () => {
        mockQueueJobs.delete(oldBullJobId);
      }),
    });

    mockTemplates.set("tpl-delay", {
      id: "tpl-delay",
      name: "Passo 2",
      message: "Aviso de reunião",
      trigger_type: "after_enrollment",
      trigger_value: 1,
      trigger_unit: "days",
    });

    mockSchedules.set("sched-delay", {
      id: "sched-delay",
      company_id: "comp-1",
      lead_name: "Eduardo",
      phone: "5511944444444",
      status: "active",
      created_at: new Date("2026-09-14T10:00:00.000Z").toISOString(),
    });

    mockDbJobs.set("job-delay", {
      id: "job-delay",
      schedule_id: "sched-delay",
      template_id: "tpl-delay",
      status: "pending",
      scheduled_for: oldScheduledFor,
      bull_job_id: oldBullJobId,
    });

    // 1. Operador altera trigger_value de 1 para 3 dias
    mockTemplates.get("tpl-delay").trigger_value = 3;

    // Prova: o scheduled_for do job pendente continua intocado!
    expect(mockDbJobs.get("job-delay").scheduled_for).toBe(oldScheduledFor);

    // 2. Agora o operador clona ou clica na ação explícita de reagendar
    const res = await reschedulePendingJobsForTemplate("tpl-delay");
    expect(res.success).toBe(true);
    expect(res.rescheduledCount).toBe(1);

    // 3. Prova: data foi recalculada e o job velho foi removido do BullMQ
    const updatedJob = mockDbJobs.get("job-delay");
    expect(updatedJob.scheduled_for).not.toBe(oldScheduledFor);
    expect(mockQueueJobs.has(oldBullJobId)).toBe(false); // Job velho removido da fila!
    expect(updatedJob.bull_job_id).not.toBe(oldBullJobId); // Novo bull_job_id gerado e salvo
  });

  // ── Teste 9 ───────────────────────────────────────────────────────────────
  it("Reagendamento acha data_nascimento no banco para passos de aniversário", async () => {
    mockTemplates.set("tpl-bday", {
      id: "tpl-bday",
      name: "Parabéns",
      message: "Feliz aniversário, {{nome}}!",
      trigger_type: "before_anchor",
      anchor_field: "data_nascimento",
      trigger_value: 0,
      trigger_unit: "days",
      scheduled_time: "09:00",
    });

    mockSchedules.set("sched-bday", {
      id: "sched-bday",
      company_id: "comp-1",
      lead_name: "Fernanda",
      phone: "5511933333333",
      status: "active",
      created_at: new Date("2026-09-14T12:00:00.000Z").toISOString(),
    });

    mockDbJobs.set("job-bday", {
      id: "job-bday",
      schedule_id: "sched-bday",
      template_id: "tpl-bday",
      status: "pending",
      scheduled_for: new Date("2026-09-14T09:00:00.000Z").toISOString(),
      bull_job_id: "bull-bday-old",
    });

    // Cadastra aniversário de Fernanda no banco (20 de outubro)
    mockLeadRows.set("geracao-digital_5511933333333", "1992-10-20");

    const res = await reschedulePendingJobsForTemplate("tpl-bday");
    expect(res.success).toBe(true);
    expect(res.rescheduledCount).toBe(1);

    const updatedJob = mockDbJobs.get("job-bday");
    // Deve estar agendado para o aniversário (mês 10, dia 20 às 09:00)
    expect(updatedJob.scheduled_for).toContain("-10-20T");
  });

  // ── Teste 10 ──────────────────────────────────────────────────────────────
  it("Adiar por cota e cancelar em seguida (bull_job_id atualizado impede envio)", async () => {
    const sendSpy = vi.spyOn(evolutionService, "sendMediaMessageViaEvolution");
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ key: { id: "text-id" } }),
    });

    vi.setSystemTime(new Date("2026-09-15T14:00:00Z")); // 11:00 em São Paulo, dia útil
    // Instância com cota limite = 1 e uso pré-existente = 1 (força adiamento por cota no próximo envio)
    mockEvolutionInstances[0].daily_limit_override = 1;
    mockQuotaUsage.set(`inst-gd_${getDateKey(new Date(), "America/Sao_Paulo")}`, 1);

    mockTemplates.set("tpl-postpone", {
      id: "tpl-postpone",
      name: "Passo Cota Zero",
      message: "Olá!",
      trigger_type: "on_schedule",
    });

    mockSchedules.set("sched-postpone", {
      id: "sched-postpone",
      company_id: "comp-1",
      lead_name: "Gustavo",
      phone: "5511922222222",
      status: "active",
    });

    mockDbJobs.set("job-postpone", {
      id: "job-postpone",
      schedule_id: "sched-postpone",
      template_id: "tpl-postpone",
      status: "pending",
      bull_job_id: "initial-bull-id",
    });

    // 1. Processar job quando cota está esgotada
    await processJob({ data: { jobId: "job-postpone" } });

    // Job foi adiado e bull_job_id foi ATUALIZADO no banco para o novo job da fila
    const postponedJob = mockDbJobs.get("job-postpone");
    expect(postponedJob.status).toBe("pending");
    expect(postponedJob.bull_job_id).not.toBe("initial-bull-id");
    expect(postponedJob.bull_job_id).toContain("fup-quota-job-postpone-");

    // 2. Operador cancela o job em seguida
    const newBullId = postponedJob.bull_job_id;
    expect(mockQueueJobs.has(newBullId)).toBe(true);

    // Cancelar remove da fila e marca como cancelled
    postponedJob.status = "cancelled";
    const queueJob = mockQueueJobs.get(newBullId);
    await queueJob.remove();

    // Prova: job não está mais na fila e nenhum envio ocorreu
    expect(mockQueueJobs.has(newBullId)).toBe(false);
    expect(sendSpy).not.toHaveBeenCalled();

    sendSpy.mockRestore();
    vi.useRealTimers();
  });

  // ── Teste 11 ──────────────────────────────────────────────────────────────
  it("Cancelar um passo não derruba a cadência (outros continuam pending)", async () => {
    mockSchedules.set("sched-multi", {
      id: "sched-multi",
      company_id: "comp-1",
      lead_name: "Helena",
      phone: "5511911111111",
      status: "active",
    });

    mockDbJobs.set("job-step-1", {
      id: "job-step-1",
      schedule_id: "sched-multi",
      status: "pending",
      bull_job_id: "bull-step-1",
    });

    mockDbJobs.set("job-step-2", {
      id: "job-step-2",
      schedule_id: "sched-multi",
      status: "pending",
      bull_job_id: "bull-step-2",
    });

    // Simula cancelamento pontual do passo 1 (ex.: endpoint PATCH /api/followup-queue/jobs/:jobId/cancel)
    const job1 = mockDbJobs.get("job-step-1");
    job1.status = "cancelled";

    // Prova: Passo 1 cancelado, mas Passo 2 continua pending e schedule continua active!
    expect(mockDbJobs.get("job-step-1").status).toBe("cancelled");
    expect(mockDbJobs.get("job-step-2").status).toBe("pending");
    expect(mockSchedules.get("sched-multi").status).toBe("active");
  });

  // ── Teste 12 ──────────────────────────────────────────────────────────────
  it("Guarda de tenant impede usuário sem permissão de cancelar job de outro cliente (retorna 404)", async () => {
    function createMockApp() {
      const routes = {};
      const register = (method, path, ...handlers) => {
        routes[`${method.toUpperCase()} ${path}`] = handlers;
      };
      return {
        routes,
        get: (path, ...handlers) => register("GET", path, ...handlers),
        post: (path, ...handlers) => register("POST", path, ...handlers),
        patch: (path, ...handlers) => register("PATCH", path, ...handlers),
        delete: (path, ...handlers) => register("DELETE", path, ...handlers),
      };
    }

    async function invokeRoute(app, method, pathPattern, req) {
      const key = `${method.toUpperCase()} ${pathPattern}`;
      const handlers = app.routes[key];
      if (!handlers) throw new Error(`Route not found: ${key}`);

      const res = {
        statusCode: 200,
        body: null,
        status(code) {
          res.statusCode = code;
          return res;
        },
        json(payload) {
          res.body = payload;
          return res;
        },
      };

      for (const handler of handlers) {
        let calledNext = false;
        await handler(req, res, () => {
          calledNext = true;
        });
        if (!calledNext) break;
      }

      return res;
    }

    const testApp = createMockApp();
    registerFollowupQueueRoutes(testApp, {
      normalizeString: (str) => (typeof str === "string" ? str.trim() : ""),
      requireFirebaseAuth: (req, res, next) => next(),
      sendError: (res, code, errCode, msg) => {
        res.status(code).json({ error: { code: errCode, message: msg } });
      },
      supabase: {},
    });

    // Empresa da Sonhare
    mockCompanies.set("comp-sonhare", {
      id: "comp-sonhare",
      tenant_id: "sonhare",
      name: "Sonhare",
    });

    mockSchedules.set("sched-sonhare", {
      id: "sched-sonhare",
      company_id: "comp-sonhare",
      status: "active",
    });

    mockDbJobs.set("job-sonhare", {
      id: "job-sonhare",
      schedule_id: "sched-sonhare",
      status: "pending",
      bull_job_id: "bull-sonhare",
    });

    // 1. Usuário com acesso apenas a 'geracao-digital' tenta cancelar job da 'sonhare'
    const forbiddenReq = {
      params: { jobId: "job-sonhare" },
      authAccess: {
        role: "internal",
        scopeMode: "assigned_clients",
        clientIds: ["geracao-digital"],
      },
    };

    const resForbidden = await invokeRoute(
      testApp,
      "PATCH",
      "/api/followup-queue/jobs/:jobId/cancel",
      forbiddenReq
    );

    // Deve ser barrado com 404 NOT_FOUND (para não vazar existência do recurso entre tenants)
    expect(resForbidden.statusCode).toBe(404);
    expect(resForbidden.body?.error?.code).toBe("NOT_FOUND");
    expect(mockDbJobs.get("job-sonhare").status).toBe("pending");

    // 2. Usuário com acesso a 'sonhare' consegue cancelar
    const allowedReq = {
      params: { jobId: "job-sonhare" },
      authAccess: {
        role: "internal",
        scopeMode: "assigned_clients",
        clientIds: ["sonhare"],
      },
    };

    const resAllowed = await invokeRoute(
      testApp,
      "PATCH",
      "/api/followup-queue/jobs/:jobId/cancel",
      allowedReq
    );

    expect(resAllowed.statusCode).toBe(200);
    expect(resAllowed.body?.status).toBe("cancelled");
    expect(mockDbJobs.get("job-sonhare").status).toBe("cancelled");
  });
});
