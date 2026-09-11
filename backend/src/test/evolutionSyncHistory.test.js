import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getEvolutionInstanceSyncProgress,
  syncEvolutionInstanceChatsAndMessages,
  ensureSyncProgressTable,
} from "../services/evolution.js";

describe("Evolution Sync - Histórico Completo, Lotes, Checkpoint e Concorrência", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("1. getEvolutionInstanceSyncProgress retorna estado padrão idle quando não há registro", async () => {
    const fakePool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    const progress = await getEvolutionInstanceSyncProgress("tenant-1", "chip-1", fakePool);
    expect(progress).toEqual({
      status: "idle",
      total_chats: 0,
      processed_chats: 0,
      synced_chats: 0,
      inserted_messages: 0,
      current_batch: 0,
      total_batches: 0,
    });
  });

  it("2. getEvolutionInstanceSyncProgress detecta sync 'running' estagnado há mais de 5 minutos como 'failed'", async () => {
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const fakePool = {
      query: vi.fn().mockImplementation(async (sql) => {
        if (sql.includes("CREATE TABLE")) return { rows: [] };
        return {
          rows: [
            {
              client_id: "tenant-1",
              instance_id: "chip-1",
              status: "running",
              total_chats: 100,
              processed_chats: 30,
              updated_at: sixMinutesAgo,
            },
          ],
        };
      }),
    };

    const progress = await getEvolutionInstanceSyncProgress("tenant-1", "chip-1", fakePool);
    expect(progress.status).toBe("failed");
    expect(progress.error_message).toContain("Sincronização interrompida");
  });

  it("3. syncEvolutionInstanceChatsAndMessages adia sincronização quando houver campanha disparando no tenant", async () => {
    const fakePool = {
      query: vi.fn().mockImplementation(async (sql) => {
        if (sql.includes("campaign_dispatches")) {
          return {
            rows: [{ id: "camp-1", name: "Disparo Black Friday" }],
          };
        }
        return { rows: [] };
      }),
    };

    const result = await syncEvolutionInstanceChatsAndMessages(
      "tenant-1",
      "https://evolution.host/webhook/disparos/chip-gmca",
      "token-123",
      { pool: fakePool, instanceId: "chip-gmca" }
    );

    expect(result.deferred).toBe(true);
    expect(result.campaignName).toBe("Disparo Black Friday");
    expect(result.message).toContain("Disparo Black Friday");
  });

  it("4. syncEvolutionInstanceChatsAndMessages bloqueia concorrência no mesmo chip se já estiver rodando", async () => {
    // Simula uma execução longa em andamento usando fetch mockado que atrasa
    let resolveFirstFetch;
    const fetchPromise = new Promise((resolve) => {
      resolveFirstFetch = resolve;
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.includes("/chat/findChats/")) {
        await fetchPromise;
        return {
          ok: true,
          json: async () => [{ id: "5511999999999@s.whatsapp.net" }],
        };
      }
      return { ok: true, json: async () => [] };
    });

    const fakePool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    try {
      // Inicia a primeira sincronização (fica aguardando no findChats)
      const firstSyncPromise = syncEvolutionInstanceChatsAndMessages(
        "tenant-concorrente",
        "https://evolution.host/webhook/chip-concorrente",
        "tok",
        { pool: fakePool, instanceId: "chip-concorrente", batchPauseMs: 10 }
      );

      // Segunda chamada síncrona para o mesmo chip enquanto a primeira ainda roda
      const secondResult = await syncEvolutionInstanceChatsAndMessages(
        "tenant-concorrente",
        "https://evolution.host/webhook/chip-concorrente",
        "tok",
        { pool: fakePool, instanceId: "chip-concorrente", batchPauseMs: 10 }
      );

      expect(secondResult.running).toBe(true);
      expect(secondResult.message).toContain("Sincronização já em andamento");

      // Libera a primeira
      resolveFirstFetch();
      await firstSyncPromise;
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("5. syncEvolutionInstanceChatsAndMessages processa sem cortar em 200 chats e atualiza checkpoints por lote", async () => {
    // Cria 40 chats simulados (devem ser divididos em lotes de 15: 15 + 15 + 10 = 3 lotes)
    const simulatedChats = Array.from({ length: 40 }, (_, idx) => ({
      id: `551198888${String(idx).padStart(4, "0")}@s.whatsapp.net`,
      remoteJid: `551198888${String(idx).padStart(4, "0")}@s.whatsapp.net`,
      name: `Contato ${idx}`,
    }));

    const updateQueries = [];
    const fakePool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        if (sql.includes("UPDATE public.whatsapp_instance_sync_progress")) {
          updateQueries.push({ sql, params });
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.includes("/chat/findChats/")) {
        return { ok: true, json: async () => simulatedChats };
      }
      if (url.includes("/chat/findContacts/")) {
        return { ok: true, json: async () => [] };
      }
      if (url.includes("/chat/findMessages/")) {
        return {
          ok: true,
          json: async () => [
            {
              key: { id: "msg-test", fromMe: false },
              message: { conversation: "Olá teste" },
              messageTimestamp: 1726000000,
            },
          ],
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    try {
      const result = await syncEvolutionInstanceChatsAndMessages(
        "tenant-full-test",
        "https://evolution.host/webhook/chip-full",
        "tok",
        { pool: fakePool, instanceId: "chip-full", batchSize: 15, batchPauseMs: 50 }
      );

      // Verificações fundamentais:
      // 1. Processou TODOS os 40 chats (NÃO cortou em 200 nem em 15)
      expect(result.chats).toBe(40);
      expect(result.synced).toBe(40);

      // 2. Gravou checkpoints de progresso intermediários (lote 1 = 15, lote 2 = 30, lote 3 = 40, mais completed)
      expect(updateQueries.length).toBeGreaterThanOrEqual(3);
      const checkpointProcessedCounts = updateQueries.map((q) => q.params?.[0]);
      expect(checkpointProcessedCounts).toContain(15);
      expect(checkpointProcessedCounts).toContain(30);
      expect(checkpointProcessedCounts).toContain(40);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("6. syncEvolutionInstanceChatsAndMessages retoma a partir do último checkpoint se o anterior falhou", async () => {
    const simulatedChats = [
      { id: "jid-1", remoteJid: "jid-1", name: "Chat 1" },
      { id: "jid-2", remoteJid: "jid-2", name: "Chat 2" },
      { id: "jid-3", remoteJid: "jid-3", name: "Chat 3" },
      { id: "jid-4", remoteJid: "jid-4", name: "Chat 4" },
    ];

    const processedJids = [];
    const fakePool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        // Simula progresso anterior com falha no jid-2
        if (sql.includes("SELECT status, last_remote_jid")) {
          return {
            rows: [
              {
                status: "failed",
                last_remote_jid: "jid-2",
                processed_chats: 2,
                synced_chats: 2,
                inserted_messages: 5,
              },
            ],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.includes("/chat/findChats/")) {
        return { ok: true, json: async () => simulatedChats };
      }
      if (url.includes("/chat/findMessages/")) {
        const match = url.match(/findMessages\/(.+)$/);
        return {
          ok: true,
          json: async () => [],
        };
      }
      return { ok: true, json: async () => [] };
    });

    try {
      const result = await syncEvolutionInstanceChatsAndMessages(
        "tenant-resume",
        "https://evolution.host/webhook/chip-resume",
        "tok",
        { pool: fakePool, instanceId: "chip-resume", batchSize: 2, batchPauseMs: 10 }
      );

      expect(result.chats).toBe(4);
      // Deve ter processado jid-3 e jid-4 e somado com os 2 já sincronizados
      expect(result.synced).toBe(4);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("7. syncEvolutionInstanceChatsAndMessages ordena chats de forma determinística por remoteJid evitando pulo de conversas na retomada", async () => {
    // A Evolution devolve os chats por recência (ordem não estável: zeta, alfa, beta)
    const disorderedChats = [
      { id: "zeta@s.whatsapp.net", remoteJid: "zeta@s.whatsapp.net", name: "Zeta" },
      { id: "alfa@s.whatsapp.net", remoteJid: "alfa@s.whatsapp.net", name: "Alfa" },
      { id: "beta@s.whatsapp.net", remoteJid: "beta@s.whatsapp.net", name: "Beta" },
    ];

    const processedOrder = [];
    const fakePool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        // Simula retomada a partir do checkpoint 'alfa'
        if (sql.includes("SELECT status, last_remote_jid")) {
          return {
            rows: [
              {
                status: "failed",
                last_remote_jid: "alfa@s.whatsapp.net",
                processed_chats: 1,
                synced_chats: 1,
                inserted_messages: 2,
              },
            ],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      if (url.includes("/chat/findChats/")) {
        return { ok: true, json: async () => disorderedChats };
      }
      if (url.includes("/chat/findMessages/")) {
        try {
          const body = JSON.parse(init?.body || "{}");
          if (body?.where?.key?.remoteJid) {
            processedOrder.push(body.where.key.remoteJid);
          }
        } catch {}
        return { ok: true, json: async () => [] };
      }
      return { ok: true, json: async () => [] };
    });

    try {
      const result = await syncEvolutionInstanceChatsAndMessages(
        "tenant-sort",
        "https://evolution.host/webhook/chip-sort",
        "tok",
        { pool: fakePool, instanceId: "chip-sort", batchSize: 1, batchPauseMs: 10 }
      );

      // Com ordenação determinística alfabética:
      // A lista ordenada é: alfa, beta, zeta
      // Checkpoint era 'alfa' (índice 0)
      // Deve retomar a partir do índice 1 (beta), depois 2 (zeta)
      expect(processedOrder).toEqual(["beta@s.whatsapp.net", "zeta@s.whatsapp.net"]);
      expect(result.chats).toBe(3);
      expect(result.synced).toBe(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
