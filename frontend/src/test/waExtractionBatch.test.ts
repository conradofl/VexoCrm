import { describe, it, expect, vi } from "vitest";
import {
  runWaExtractionPipeline,
  resolveEffectiveChatLimit,
  enforcePlanChatLimit,
  validateExtractionInstance,
  type WaExtractionPlan,
  type WaExtractionProgress,
} from "@/lib/leads/waExtractionRunner";

describe("waExtractionBatch (Regras e Orquestração de Extração)", () => {
  const basePlan: WaExtractionPlan = {
    clientId: "tenant-teste",
    instanceId: "inst-1",
    groupsInstanceId: "inst-1",
    isAdvancedPlan: true,
    sources: {
      conversas: false,
      agenda: false,
      grupos: true,
    },
    selectedGroups: [
      { id: "g1@g.us", name: "Grupo Alfa" },
      { id: "g2@g.us", name: "Grupo Beta" },
      { id: "g3@g.us", name: "Grupo Gama" },
    ],
  };

  it("[TESTE OBRIGATÓRIO] extração de vários grupos faz uma requisição por grupo, não uma para todos", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      return {
        ok: true,
        json: async () => ({
          success: true,
          extractedCount: 10,
          fromGroups: 10,
        }),
      } as any;
    });

    const result = await runWaExtractionPipeline(basePlan, {
      fetchFn: fetchMock,
      getIdToken: async () => "token-123",
      apiBaseUrl: "https://api.test",
    });

    expect(result.success).toBe(true);
    expect(result.totalExtracted).toBe(30);

    // Exatamente 3 requisições disparadas, uma por grupo
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const call1Body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    const call2Body = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    const call3Body = JSON.parse(fetchMock.mock.calls[2][1]?.body as string);

    expect(call1Body.sources).toEqual(["grupos"]);
    expect(call1Body.groupIds).toEqual(["g1@g.us"]);

    expect(call2Body.sources).toEqual(["grupos"]);
    expect(call2Body.groupIds).toEqual(["g2@g.us"]);

    expect(call3Body.sources).toEqual(["grupos"]);
    expect(call3Body.groupIds).toEqual(["g3@g.us"]);
  });

  it("[TESTE OBRIGATÓRIO] grupo que falha não impede os outros, e aparece com o erro dele", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      const gid = body.groupIds?.[0];

      if (gid === "g2@g.us") {
        return {
          ok: false,
          status: 504,
          json: async () => ({ error: "Timeout na Evolution API" }),
          text: async () => "Gateway Timeout",
        } as any;
      }

      return {
        ok: true,
        json: async () => ({
          success: true,
          extractedCount: 15,
          fromGroups: 15,
        }),
      } as any;
    });

    const result = await runWaExtractionPipeline(basePlan, {
      fetchFn: fetchMock,
      getIdToken: async () => "token-123",
      apiBaseUrl: "https://api.test",
    });

    // O pipeline completou e processou todos os 3 grupos
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // g1 e g3 mineraram 15 cada = 30
    expect(result.totalExtracted).toBe(30);
    expect(result.fromGroups).toBe(30);

    // O grupo que falhou foi registrado com seu respectivo erro
    expect(result.failedGroups).toHaveLength(1);
    expect(result.failedGroups[0]).toEqual({
      groupId: "g2@g.us",
      groupName: "Grupo Beta",
      error: "Timeout na Evolution API",
    });
  });

  it("[TESTE OBRIGATÓRIO] o progresso reflete quantos grupos foram processados", async () => {
    const progressReports: WaExtractionProgress[] = [];

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, extractedCount: 5, fromGroups: 5 }),
    } as any));

    await runWaExtractionPipeline(basePlan, {
      fetchFn: fetchMock,
      getIdToken: async () => "token-123",
      apiBaseUrl: "https://api.test",
      onProgress: (p) => progressReports.push({ ...p }),
    });

    // Filtra relatórios da fase de grupos
    const groupProgress = progressReports.filter((p) => p.phase === "grupos");
    expect(groupProgress).toHaveLength(3);

    expect(groupProgress[0].currentGroupIndex).toBe(1);
    expect(groupProgress[0].totalGroups).toBe(3);
    expect(groupProgress[0].remainingGroups).toBe(2);
    expect(groupProgress[0].currentGroupName).toBe("Grupo Alfa");

    expect(groupProgress[1].currentGroupIndex).toBe(2);
    expect(groupProgress[1].totalGroups).toBe(3);
    expect(groupProgress[1].remainingGroups).toBe(1);
    expect(groupProgress[1].currentGroupName).toBe("Grupo Beta");

    expect(groupProgress[2].currentGroupIndex).toBe(3);
    expect(groupProgress[2].totalGroups).toBe(3);
    expect(groupProgress[2].remainingGroups).toBe(0);
    expect(groupProgress[2].currentGroupName).toBe("Grupo Gama");
  });

  it("[TESTE OBRIGATÓRIO] o valor enviado de chatLimit é sempre o máximo permitido pelo plano", () => {
    // Plano avançado usa "all" (ilimitado)
    expect(resolveEffectiveChatLimit(true)).toBe("all");
    // Plano não avançado usa 500 (máximo permitido)
    expect(resolveEffectiveChatLimit(false)).toBe(500);
  });

  it("[TESTE OBRIGATÓRIO] plano sem ilimitado continua limitado — a trava não pode sumir", () => {
    // Tentativa de passar "all" em plano sem ilimitado é travada em 500
    const checkNonAdvanced = enforcePlanChatLimit("all", false);
    expect(checkNonAdvanced.clamped).toBe(true);
    expect(checkNonAdvanced.limit).toBe(500);

    // Plano avançado permite "all"
    const checkAdvanced = enforcePlanChatLimit("all", true);
    expect(checkAdvanced.clamped).toBe(false);
    expect(checkAdvanced.limit).toBe("all");
  });

  it("[TESTE OBRIGATÓRIO] não é possível disparar importação com grupos de uma instância e a instância atual sendo outra", async () => {
    // Validador direto
    const invalidCheck = validateExtractionInstance("inst-2", "inst-1", true);
    expect(invalidCheck.valid).toBe(false);
    expect(invalidCheck.error).toContain("Instância selecionada foi alterada");

    const validCheck = validateExtractionInstance("inst-1", "inst-1", true);
    expect(validCheck.valid).toBe(true);

    // Pipeline bloqueia antes do fetch
    const fetchMock = vi.fn();
    const divergentPlan: WaExtractionPlan = {
      ...basePlan,
      instanceId: "inst-2",
      groupsInstanceId: "inst-1", // grupos carregados no chip anterior
    };

    await expect(
      runWaExtractionPipeline(divergentPlan, {
        fetchFn: fetchMock,
        getIdToken: async () => "token-123",
        apiBaseUrl: "https://api.test",
      })
    ).rejects.toThrow(/Instância selecionada foi alterada/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("conversas e agenda rodam cada uma na sua própria requisição", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, extractedCount: 20 }),
    } as any));

    const mixedPlan: WaExtractionPlan = {
      clientId: "tenant-teste",
      instanceId: "inst-1",
      isAdvancedPlan: false, // Plano essencial -> 500
      sources: {
        conversas: true,
        agenda: true,
        grupos: false,
      },
      selectedGroups: [],
    };

    const result = await runWaExtractionPipeline(mixedPlan, {
      fetchFn: fetchMock,
      getIdToken: async () => "token-123",
      apiBaseUrl: "https://api.test",
    });

    expect(result.success).toBe(true);
    // 2 requisições: 1 de conversas + 1 de agenda
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const call1Body = JSON.parse(calls[0]?.[1]?.body as string);
    const call2Body = JSON.parse(calls[1]?.[1]?.body as string);

    expect(call1Body.sources).toEqual(["conversas"]);
    expect(call1Body.chatLimit).toBe(500); // plano não avançado = 500

    expect(call2Body.sources).toEqual(["agenda"]);
  });

  it("possibilidade de parar no meio sem perder o que já entrou", async () => {
    let callCount = 0;
    let stopRequested = false;

    const fetchMock = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // Usuário clica em Parar após o primeiro grupo entrar
        stopRequested = true;
      }
      return {
        ok: true,
        json: async () => ({ success: true, extractedCount: 25, fromGroups: 25 }),
      } as any;
    });

    const result = await runWaExtractionPipeline(basePlan, {
      fetchFn: fetchMock,
      getIdToken: async () => "token-123",
      apiBaseUrl: "https://api.test",
      isCancelled: () => stopRequested,
    });

    expect(result.cancelled).toBe(true);
    // Parou logo após o 1º grupo, não executou os grupos 2 e 3
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Mas preservou os 25 contatos que já entraram!
    expect(result.totalExtracted).toBe(25);
  });

  it("[TESTE OBRIGATÓRIO] conversas em instância grande é processada em vários lotes, e nenhum lote sozinho passa do teto de tempo", async () => {
    let callIndex = 0;
    const batchSizesObserved: number[] = [];
    const cursorsObserved: number[] = [];

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      batchSizesObserved.push(body.batchSize);
      cursorsObserved.push(body.cursor);
      callIndex++;

      // Simula 3 lotes de 15 conversas (total 45 conversas)
      if (callIndex === 1) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            extractedCount: 15,
            fromChats: 15,
            hasMore: true,
            nextCursor: 15,
            totalAvailable: 45,
          }),
        } as any;
      } else if (callIndex === 2) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            extractedCount: 15,
            fromChats: 15,
            hasMore: true,
            nextCursor: 30,
            totalAvailable: 45,
          }),
        } as any;
      } else {
        return {
          ok: true,
          json: async () => ({
            success: true,
            extractedCount: 15,
            fromChats: 15,
            hasMore: false,
            nextCursor: 45,
            totalAvailable: 45,
          }),
        } as any;
      }
    });

    const conversasPlan: WaExtractionPlan = {
      clientId: "tenant-teste",
      instanceId: "inst-1",
      isAdvancedPlan: true,
      sources: {
        conversas: true,
        agenda: false,
        grupos: false,
      },
      selectedGroups: [],
    };

    const result = await runWaExtractionPipeline(conversasPlan, {
      fetchFn: fetchMock,
      getIdToken: async () => "token-123",
      apiBaseUrl: "https://api.test",
    });

    expect(result.success).toBe(true);
    expect(result.totalExtracted).toBe(45);
    expect(result.fromChats).toBe(45);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Cada lote foi de 15 conversas (escolhido por tempo para não estourar os 30s)
    expect(batchSizesObserved).toEqual([15, 15, 15]);
    expect(cursorsObserved).toEqual([0, 15, 30]);
  });

  it("[TESTE OBRIGATÓRIO] falha em conversas não impede agenda nem grupos; o resultado mostra o que entrou e o que falhou", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      const source = body.sources?.[0];

      if (source === "conversas") {
        return {
          ok: false,
          status: 504,
          json: async () => ({ error: "TimeoutError: signal timed out" }),
        } as any;
      }

      if (source === "agenda") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            extractedCount: 20,
            fromAddressBook: 20,
            hasMore: false,
          }),
        } as any;
      }

      if (source === "grupos") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            extractedCount: 10,
            fromGroups: 10,
          }),
        } as any;
      }

      return { ok: false, status: 404 } as any;
    });

    const fullPlan: WaExtractionPlan = {
      clientId: "tenant-teste",
      instanceId: "inst-1",
      isAdvancedPlan: true,
      sources: {
        conversas: true,
        agenda: true,
        grupos: true,
      },
      selectedGroups: [
        { id: "g1@g.us", name: "Grupo Alfa" },
        { id: "g2@g.us", name: "Grupo Beta" },
      ],
    };

    const result = await runWaExtractionPipeline(fullPlan, {
      fetchFn: fetchMock,
      getIdToken: async () => "token-123",
      apiBaseUrl: "https://api.test",
    });

    // Pipeline completou sem lançar exceção!
    expect(result.success).toBe(true);
    // Conversas falhou (0), mas agenda (20) e grupos (2 x 10 = 20) entraram perfeitamente!
    expect(result.fromChats).toBe(0);
    expect(result.fromAddressBook).toBe(20);
    expect(result.fromGroups).toBe(20);
    expect(result.totalExtracted).toBe(40);

    // O erro de conversas foi registrado no relatório de falhas
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].phase).toBe("conversas");
    expect(result.failures[0].label).toBe("Conversas");
    expect(result.failures[0].error).toContain("TimeoutError");
  });

  it("[TESTE OBRIGATÓRIO] falha em agenda não impede grupos", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      const source = body.sources?.[0];

      if (source === "agenda") {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "Erro interno no servidor ao ler agenda" }),
        } as any;
      }

      if (source === "grupos") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            extractedCount: 12,
            fromGroups: 12,
          }),
        } as any;
      }

      return { ok: false, status: 404 } as any;
    });

    const agendaGroupPlan: WaExtractionPlan = {
      clientId: "tenant-teste",
      instanceId: "inst-1",
      isAdvancedPlan: false,
      sources: {
        conversas: false,
        agenda: true,
        grupos: true,
      },
      selectedGroups: [{ id: "g1@g.us", name: "Grupo 1" }],
    };

    const result = await runWaExtractionPipeline(agendaGroupPlan, {
      fetchFn: fetchMock,
      getIdToken: async () => "token-123",
      apiBaseUrl: "https://api.test",
    });

    expect(result.success).toBe(true);
    expect(result.fromAddressBook).toBe(0);
    expect(result.fromGroups).toBe(12);
    expect(result.totalExtracted).toBe(12);

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].phase).toBe("agenda");
    expect(result.failures[0].label).toBe("Agenda");
  });

  it("[TESTE OBRIGATÓRIO] o progresso mostra a fase e o quanto já foi feito em cada uma", async () => {
    const progressList: WaExtractionProgress[] = [];

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      const source = body.sources?.[0];

      if (source === "conversas") {
        return {
          ok: true,
          json: async () => ({ success: true, extractedCount: 8, fromChats: 8, hasMore: false, totalAvailable: 8 }),
        } as any;
      }
      if (source === "agenda") {
        return {
          ok: true,
          json: async () => ({ success: true, extractedCount: 15, fromAddressBook: 15, hasMore: false, totalAvailable: 15 }),
        } as any;
      }
      if (source === "grupos") {
        return {
          ok: true,
          json: async () => ({ success: true, extractedCount: 5, fromGroups: 5 }),
        } as any;
      }
      return { ok: true, json: async () => ({ success: true }) } as any;
    });

    const plan: WaExtractionPlan = {
      clientId: "tenant-teste",
      instanceId: "inst-1",
      isAdvancedPlan: true,
      sources: {
        conversas: true,
        agenda: true,
        grupos: true,
      },
      selectedGroups: [{ id: "g1@g.us", name: "Grupo Único" }],
    };

    await runWaExtractionPipeline(plan, {
      fetchFn: fetchMock,
      getIdToken: async () => "token-123",
      apiBaseUrl: "https://api.test",
      onProgress: (p) => progressList.push({ ...p }),
    });

    const phasesReported = progressList.map((p) => p.phase);
    expect(phasesReported).toContain("conversas");
    expect(phasesReported).toContain("agenda");
    expect(phasesReported).toContain("grupos");
    expect(phasesReported).toContain("done");

    // Mensagens descritivas em cada fase
    const conversasProg = progressList.find((p) => p.phase === "conversas");
    expect(conversasProg?.statusMessage).toMatch(/conversas/i);

    const agendaProg = progressList.find((p) => p.phase === "agenda");
    expect(agendaProg?.statusMessage).toMatch(/agenda/i);

    const gruposProg = progressList.find((p) => p.phase === "grupos");
    expect(gruposProg?.statusMessage).toMatch(/Grupo Único/);
  });

  it("[TESTE OBRIGATÓRIO] parar no meio preserva o que já entrou, em qualquer fase", async () => {
    // 1. Parar durante conversas
    let cancelFlag = false;
    let conversasBatch = 0;
    const fetchMockConversas = vi.fn(async () => {
      conversasBatch++;
      if (conversasBatch === 1) {
        cancelFlag = true; // cancela logo após o 1º lote de conversas
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          extractedCount: 15,
          fromChats: 15,
          hasMore: true,
          nextCursor: 15,
          totalAvailable: 60,
        }),
      } as any;
    });

    const planConversas: WaExtractionPlan = {
      clientId: "tenant-teste",
      instanceId: "inst-1",
      isAdvancedPlan: true,
      sources: { conversas: true, agenda: true, grupos: false },
      selectedGroups: [],
    };

    const res1 = await runWaExtractionPipeline(planConversas, {
      fetchFn: fetchMockConversas,
      getIdToken: async () => "token-123",
      isCancelled: () => cancelFlag,
    });

    expect(res1.cancelled).toBe(true);
    expect(res1.totalExtracted).toBe(15);
    expect(res1.fromChats).toBe(15);
    // Não executou nem o 2º lote de conversas nem a agenda
    expect(fetchMockConversas).toHaveBeenCalledTimes(1);

    // 2. Parar durante a agenda
    let cancelInAgenda = false;
    const fetchMockAgenda = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      if (body.sources?.[0] === "conversas") {
        return {
          ok: true,
          json: async () => ({ success: true, extractedCount: 10, fromChats: 10, hasMore: false }),
        } as any;
      }
      if (body.sources?.[0] === "agenda") {
        cancelInAgenda = true;
        return {
          ok: true,
          json: async () => ({ success: true, extractedCount: 25, fromAddressBook: 25, hasMore: true }),
        } as any;
      }
      return { ok: true, json: async () => ({ success: true, extractedCount: 50, fromGroups: 50 }) } as any;
    });

    const planAgenda: WaExtractionPlan = {
      clientId: "tenant-teste",
      instanceId: "inst-1",
      isAdvancedPlan: true,
      sources: { conversas: true, agenda: true, grupos: true },
      selectedGroups: [{ id: "g1@g.us", name: "Grupo Alpha" }],
    };

    const res2 = await runWaExtractionPipeline(planAgenda, {
      fetchFn: fetchMockAgenda,
      getIdToken: async () => "token-123",
      isCancelled: () => cancelInAgenda,
    });

    expect(res2.cancelled).toBe(true);
    expect(res2.fromChats).toBe(10);
    expect(res2.fromAddressBook).toBe(25);
    expect(res2.fromGroups).toBe(0);
    expect(res2.totalExtracted).toBe(35);
  });

  it("[TESTE OBRIGATÓRIO] um mesmo sessionId gerado no início é enviado em todas as fases", async () => {
    const sessionIdsReceived: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      if (body.sessionId) {
        sessionIdsReceived.push(body.sessionId);
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          extractedCount: 5,
          fromChats: 5,
          fromAddressBook: 5,
          fromGroups: 5,
          hasMore: false,
        }),
      } as any;
    });

    const plan: WaExtractionPlan = {
      clientId: "tenant-teste",
      instanceId: "inst-1",
      isAdvancedPlan: true,
      sources: { conversas: true, agenda: true, grupos: true },
      selectedGroups: [{ id: "g1@g.us", name: "Grupo 1" }],
    };

    await runWaExtractionPipeline(plan, {
      fetchFn: fetchMock,
      getIdToken: async () => "token-123",
      apiBaseUrl: "https://api.test",
    });

    // 1 requisição para conversas, 1 para agenda, 1 para grupo 1 = 3 requisições
    expect(sessionIdsReceived).toHaveLength(3);
    // Todas usaram exatamente o mesmo sessionId!
    expect(new Set(sessionIdsReceived).size).toBe(1);
    expect(sessionIdsReceived[0]).toBeTruthy();
  });
});
