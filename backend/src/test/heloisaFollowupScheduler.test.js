import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executarCriarFollowup,
  HELOISA_TOOLS,
} from "../domains/goclaw/heloisaEngine.js";
import { processHeloisaScheduledWhatsappJob } from "../followup/worker.js";
import * as followupQueueModule from "../followup/queue.js";

describe("Heloísa — Follow-up Scheduler com Disparo Programado no WhatsApp", () => {
  let mockQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQueue = {
      add: vi.fn().mockResolvedValue({ id: "job-123" }),
    };
    vi.spyOn(followupQueueModule, "getFollowupQueue").mockReturnValue(mockQueue);
  });

  it("Teste 1: calcula remind_at futuro correto para tempos relativos ('daqui 10 minutos')", async () => {
    const mockPool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        if (sql.includes("INSERT INTO public.lead_reminders")) {
          return { rows: [{ id: "rem-1", title: params[1], remind_at: params[3] }] };
        }
        return { rows: [] };
      }),
    };

    const agora = Date.now();
    const res = await executarCriarFollowup(
      {
        titulo: "Mensagem teste follow-up",
        data_lembrete: "daqui 10 minutos",
      },
      mockPool,
      "instancia-teste",
      { nome: "Conrado Finzi", telefone: "5534997817660" }
    );

    expect(res.sucesso).toBe(true);
    expect(res.delay_ms).toBeDefined();
    // delay deve ser aproximadamente 10 minutos (600.000 ms)
    expect(res.delay_ms).toBeGreaterThanOrEqual(590000);
    expect(res.delay_ms).toBeLessThanOrEqual(610000);

    const dataRemind = new Date(res.data_iso).getTime();
    expect(dataRemind).toBeGreaterThan(agora + 580000);
  });

  it("Teste 2: agenda o job na fila BullMQ com delay em milissegundos quando enviar_whatsapp for true", async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: "rem-2", title: "Lembrete WhatsApp" }] }),
    };

    const res = await executarCriarFollowup(
      {
        titulo: "Avisar cliente sobre proposta",
        data_lembrete: "daqui 10 minutos",
        mensagem_whatsapp: "Olá Conrado, lembrete da proposta!",
        enviar_whatsapp: true,
      },
      mockPool,
      "instancia-teste",
      { nome: "Conrado Finzi", telefone: "5534997817660" }
    );

    expect(res.sucesso).toBe(true);
    expect(mockQueue.add).toHaveBeenCalledTimes(1);

    const [jobName, jobData, jobOptions] = mockQueue.add.mock.calls[0];
    expect(jobName).toBe("heloisa-scheduled-whatsapp");
    expect(jobData.numero).toBe("5534997817660");
    expect(jobData.texto).toContain("lembrete da proposta");
    expect(jobOptions.delay).toBeGreaterThanOrEqual(590000);
    expect(jobOptions.delay).toBeLessThanOrEqual(610000);
  });

  it("Teste 3: processHeloisaScheduledWhatsappJob no worker executa o envio de WhatsApp", async () => {
    const mockJob = {
      name: "heloisa-scheduled-whatsapp",
      data: {
        numero: "5534997817660",
        texto: "Teste de lembrete agendado",
        instanceName: "instancia-teste",
        tenantId: "geracao-digital",
      },
    };

    const result = await processHeloisaScheduledWhatsappJob(mockJob);
    expect(result).toBeDefined();
    expect(result.sucesso).toBe(true);
  });

  it("Teste 4: resposta da Heloísa informa explicitamente o horário e os minutos para o disparo no WhatsApp", async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: "rem-4", title: "Lembrete com horário" }] }),
    };

    const res = await executarCriarFollowup(
      {
        titulo: "Teste de Follow-up 10 min",
        data_lembrete: "daqui 10 minutos",
        enviar_whatsapp: true,
      },
      mockPool,
      "instancia-teste",
      { nome: "Conrado Finzi", telefone: "5534997817660" }
    );

    expect(res.sucesso).toBe(true);
    expect(res.mensagem).toMatch(/Lembrete de follow-up agendado com sucesso/i);
    expect(res.mensagem).toMatch(/WhatsApp às \d{2}:\d{2}/i);
    expect(res.mensagem).toContain("daqui a 10 minutos");
  });
});
