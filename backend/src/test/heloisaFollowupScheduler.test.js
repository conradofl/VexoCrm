import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executarCriarFollowup,
  parseDataLembrete,
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

  it("Teste 5: suporte a números por extenso no reconhecimento de voz ('daqui a dois minutos')", () => {
    const res2min = parseDataLembrete("daqui a dois minutos");
    expect(res2min.minutos).toBe(2);
    expect(res2min.delayMs).toBeGreaterThanOrEqual(115000);
    expect(res2min.delayMs).toBeLessThanOrEqual(125000);

    const res1h = parseDataLembrete("daqui a uma hora");
    expect(res1h.minutos).toBe(60);

    const res3h = parseDataLembrete("daqui a três horas");
    expect(res3h.minutos).toBe(180);

    const resTres = parseDataLembrete("daqui a tres horas");
    expect(resTres.minutos).toBe(180);

    const res15min = parseDataLembrete("daqui a quinze minutos");
    expect(res15min.minutos).toBe(15);

    const res20min = parseDataLembrete("daqui a vinte minutos");
    expect(res20min.minutos).toBe(20);

    const resMeia = parseDataLembrete("daqui a meia hora");
    expect(resMeia.minutos).toBe(30);
  });

  it("Teste 6: remoção do objeto pool do payload no BullMQ ao executarCriarFollowup", async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: "rem-6", title: "Lembrete sem pool" }] }),
    };

    await executarCriarFollowup(
      {
        titulo: "Follow-up Conrado",
        data_lembrete: "daqui a dois minutos",
        enviar_whatsapp: true,
      },
      mockPool,
      "instancia-teste",
      { nome: "Conrado Finzi", telefone: "5534997817660" }
    );

    expect(mockQueue.add).toHaveBeenCalledTimes(1);
    const [jobName, jobData] = mockQueue.add.mock.calls[0];
    expect(jobName).toBe("heloisa-scheduled-whatsapp");
    expect(jobData).not.toHaveProperty("pool");
    expect(jobData.numero).toBe("5534997817660");
  });

  it("Teste 7: worker processHeloisaScheduledWhatsappJob emite logs explícitos para auditoria", async () => {
    const consoleLogSpy = vi.spyOn(console, "log");

    const mockJob = {
      name: "heloisa-scheduled-whatsapp",
      data: {
        numero: "5534997817660",
        texto: "Mensagem de followup para Conrado",
        instanceName: "instancia-teste",
        tenantId: "geracao-digital",
      },
    };

    const res = await processHeloisaScheduledWhatsappJob(mockJob);
    expect(res).toBeDefined();

    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[followup/worker] ⏰ Disparando lembrete programado da Heloísa para 5534997817660: "Mensagem de followup para Conrado"'
    );

    const successLogFound = consoleLogSpy.mock.calls.some(
      (args) =>
        typeof args[0] === "string" &&
        args[0].startsWith("[followup/worker] ✅ Lembrete enviado com sucesso para 5534997817660 via")
    );
    expect(successLogFound).toBe(true);

    consoleLogSpy.mockRestore();
  });
});
