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
});
