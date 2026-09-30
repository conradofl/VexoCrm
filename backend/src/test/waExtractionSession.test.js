// backend/src/test/waExtractionSession.test.js
//
// Testes de sessão em memória, paginação estável e isolamento de recursos
// na extração de contatos do WhatsApp (Evolution API).
//
// Requisitos comprovados:
// 1. extrair conversas em três lotes faz uma busca de conversas na Evolution, não três
// 2. requisição de grupo não chama findChats nem findContacts
// 3. a ordem dos lotes é estável: a mesma conversa nunca aparece em dois lotes, e nenhuma fica de fora (com origem embaralhada)
// 4. sessão expirada devolve erro claro (HTTP 410) pedindo para recomeçar, não resultado parcial silencioso
// 5. o total extraído bate com o total disponível quando a extração vai até o fim

import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import {
  registerLeadsRoutes,
  extractionSessions,
  clearExtractionSessions,
  EXTRACTION_SESSION_TTL_MS,
} from "../domains/leads/routes.js";

function createMockDb() {
  const leads = [];
  return {
    leads,
    query: vi.fn(async (sql, params = []) => {
      const text = sql.trim();

      if (text.includes("FROM public.lead_client_evolution_instances")) {
        const rows = [
          {
            id: "inst-sess-1",
            client_id: "tenant-sessao",
            name: "GD Sessao",
            dispatch_webhook_url: "https://evo.vexo.com/instance/GD_Sessao",
            owner_uid: "uid-dono",
            active: true,
            is_default: true,
          },
          {
            id: "inst-sess-2",
            client_id: "tenant-sessao",
            name: "GD Sessao 2",
            dispatch_webhook_url: "https://evo.vexo.com/instance/GD_Sessao_2",
            owner_uid: "uid-dono-2",
            active: true,
            is_default: false,
          },
        ];
        if (params.includes("GD Sessao 2") || params.includes("inst-sess-2")) {
          return { rows: [rows[1]] };
        }
        if (params.includes("GD Sessao") || params.includes("inst-sess-1")) {
          return { rows: [rows[0]] };
        }
        return { rows };
      }

      if (text.includes("FROM public.lead_client_n8n_settings")) {
        return {
          rows: [{ plan_tier: "avancado", modulos_avulsos: [] }],
        };
      }

      if (text.includes("SELECT") && text.includes("FROM public.leads")) {
        return { rows: [] };
      }

      if (text.startsWith("INSERT INTO public.leads")) {
        const colsMatch = text.match(/\(([^)]+)\)/);
        const colNames = colsMatch ? colsMatch[1].split(",").map((c) => c.trim().replace(/"/g, "")) : [];
        if (colNames.length > 0) {
          const COLS_COUNT = colNames.length;
          const inserted = [];
          for (let i = 0; i < params.length; i += COLS_COUNT) {
            const row = { id: `lead-${leads.length + 1}` };
            colNames.forEach((col, idx) => {
              row[col] = params[i + idx];
            });
            leads.push(row);
            inserted.push(row);
          }
          return { rows: inserted };
        }
      }

      return { rows: [] };
    }),
  };
}

describe("Sessão em Memória e Paginação Estável de Extração WA", () => {
  let server;
  let baseUrl;
  let mockDb;
  let originalFetch;
  let findChatsCallCount = 0;
  let findContactsCallCount = 0;
  let fetchCalls = [];
  let shouldShuffleChats = false;

  // 45 conversas para dividir em 3 lotes de 15
  const BASE_CHATS = Array.from({ length: 45 }, (_, i) => {
    const phone = `551199000${String(i).padStart(4, "0")}`;
    return {
      remoteJid: `${phone}@s.whatsapp.net`,
      pushName: `Lead Convo ${String(i).padStart(2, "0")}`,
      lastMessage: {
        key: {
          remoteJidAlt: `${phone}@s.whatsapp.net`,
          fromMe: false,
        },
      },
    };
  });

  beforeAll(async () => {
    originalFetch = globalThis.fetch;

    const app = express();
    app.use(express.json());
    mockDb = createMockDb();

    globalThis.fetch = vi.fn(async (url, opts) => {
      const urlStr = String(url);
      fetchCalls.push(urlStr);

      if (urlStr.includes("localhost") || urlStr.includes("127.0.0.1")) {
        return originalFetch(url, opts);
      }

      if (urlStr.includes("/instance/fetchInstances")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { name: "GD Sessao", owner: "5511999990000@s.whatsapp.net" },
            { name: "GD Sessao 2", owner: "5511999991111@s.whatsapp.net" },
          ],
        };
      }

      if (urlStr.includes("/chat/findChats/")) {
        findChatsCallCount++;
        let list = [...BASE_CHATS];
        if (shouldShuffleChats) {
          // Embaralha aleatoriamente a lista retornada pela Evolution
          list.sort(() => Math.random() - 0.5);
        }
        return {
          ok: true,
          status: 200,
          json: async () => list,
        };
      }

      if (urlStr.includes("/chat/findContacts/")) {
        findContactsCallCount++;
        return {
          ok: true,
          status: 200,
          json: async () =>
            BASE_CHATS.map((c) => ({
              remoteJid: c.remoteJid,
              name: c.pushName,
            })),
        };
      }

      if (urlStr.includes("/group/findGroupInfos/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "120363000001@g.us",
            subject: "Grupo Teste",
            participants: [{ id: "5511988881111@s.whatsapp.net", pushName: "Membro 1" }],
          }),
        };
      }

      return { ok: false, status: 404, text: async () => "Not Found" };
    });

    const deps = {
      ensureDb: () => true,
      pgDatabasePool: mockDb,
      requireFirebaseAuth: (_req, _res, next) => {
        _req.user = { client_id: "tenant-sessao", role: "admin" };
        _req.authAccess = { isAdmin: true, role: "internal", clientId: "tenant-sessao" };
        next();
      },
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      resolveAuthorizedClientId: (_req, _res, cid) => cid || "tenant-sessao",
      sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
      sendError: (res, status, code, msg) => res.status(status).json({ error: code, message: msg }),
      normalizeString: (s) => (s ? String(s).trim() : ""),
      supabase: null,
    };

    registerLeadsRoutes(app, deps);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${server.address().port}`;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    mockDb.leads.length = 0;
    findChatsCallCount = 0;
    findContactsCallCount = 0;
    fetchCalls = [];
    shouldShuffleChats = false;
    clearExtractionSessions();
  });

  it("[TESTE OBRIGATÓRIO] extrair conversas em três lotes faz uma busca de conversas na Evolution, não três", async () => {
    const sessionId = "sessao-teste-3-lotes";

    // Lote 1: cursor 0
    const res1 = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "tenant-sessao",
        instanceName: "GD Sessao",
        sources: ["conversas"],
        sessionId,
        cursor: 0,
        batchSize: 15,
      }),
    });
    expect(res1.status).toBe(200);
    const d1 = await res1.json();
    expect(d1.fromChats).toBe(15);
    expect(d1.hasMore).toBe(true);
    expect(d1.nextCursor).toBe(15);

    // Lote 2: cursor 15
    const res2 = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "tenant-sessao",
        instanceName: "GD Sessao",
        sources: ["conversas"],
        sessionId,
        cursor: 15,
        batchSize: 15,
      }),
    });
    expect(res2.status).toBe(200);
    const d2 = await res2.json();
    expect(d2.fromChats).toBe(15);
    expect(d2.hasMore).toBe(true);
    expect(d2.nextCursor).toBe(30);

    // Lote 3: cursor 30
    const res3 = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "tenant-sessao",
        instanceName: "GD Sessao",
        sources: ["conversas"],
        sessionId,
        cursor: 30,
        batchSize: 15,
      }),
    });
    expect(res3.status).toBe(200);
    const d3 = await res3.json();
    expect(d3.fromChats).toBe(15);
    expect(d3.hasMore).toBe(false);

    // Prova mandatória: findChats foi chamado UMA ÚNICA VEZ na Evolution, não três!
    expect(findChatsCallCount).toBe(1);
    // findContacts também foi chamado uma única vez!
    expect(findContactsCallCount).toBe(1);
  });

  it("[TESTE OBRIGATÓRIO] requisição de grupo não chama findChats nem findContacts", async () => {
    const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "tenant-sessao",
        instanceName: "GD Sessao",
        sources: ["grupos"],
        groupIds: ["120363000001@g.us"],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.fromGroups).toBe(1);

    // findChats e findContacts NUNCA foram chamados para grupo!
    expect(findChatsCallCount).toBe(0);
    expect(findContactsCallCount).toBe(0);
    expect(fetchCalls.some((u) => u.includes("/chat/findChats/"))).toBe(false);
    expect(fetchCalls.some((u) => u.includes("/chat/findContacts/"))).toBe(false);
  });

  it("[TESTE OBRIGATÓRIO] a ordem dos lotes é estável: a mesma conversa nunca aparece em dois lotes, e nenhuma fica de fora — mesmo com a origem devolvendo a lista embaralhada", async () => {
    shouldShuffleChats = true;
    const sessionId = "sessao-embaralhada-estavel";
    const collectedPhones = [];

    // Faz as 3 requisições
    for (let cursor = 0; cursor < 45; cursor += 15) {
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "tenant-sessao",
          instanceName: "GD Sessao",
          sources: ["conversas"],
          sessionId,
          cursor,
          batchSize: 15,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.fromChats).toBe(15);
    }

    // Todos os 45 leads foram inseridos no mockDb
    expect(mockDb.leads).toHaveLength(45);
    const phones = mockDb.leads.map((l) => l.telefone);

    // 1. Nenhuma conversa aparece repetida (0 duplicatas)
    const uniquePhones = new Set(phones);
    expect(uniquePhones.size).toBe(45);

    // 2. A ordem entre os lotes é estritamente determinística (alfabética por telefone)
    expect(phones).toEqual([...phones].sort((a, b) => a.localeCompare(b)));

    // 3. Nenhuma conversa ficou de fora (todas as 45 originais estão presentes)
    for (const item of BASE_CHATS) {
      const digits = item.remoteJid.split("@")[0].replace(/\D/g, "");
      expect(uniquePhones.has(digits)).toBe(true);
    }
  });

  it("[TESTE OBRIGATÓRIO] sessão expirada devolve erro claro (HTTP 410) pedindo para recomeçar, não resultado parcial silencioso", async () => {
    // 1. Sessão inexistente chamada com cursor > 0
    const resUnknown = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "tenant-sessao",
        instanceName: "GD Sessao",
        sources: ["conversas"],
        sessionId: "sessao-que-nunca-existiu",
        cursor: 15,
        batchSize: 15,
      }),
    });

    expect(resUnknown.status).toBe(410);
    const errUnknown = await resUnknown.json();
    expect(errUnknown.error).toBe("WA_EXTRACTION_SESSION_EXPIRED");
    expect(errUnknown.message).toMatch(/Sessão de extração expirada ou não encontrada/i);
    // Nenhum lead gravado
    expect(mockDb.leads).toHaveLength(0);

    // 2. Sessão que existia mas expirou pelo TTL
    const sessionId = "sessao-vai-expirar";
    // Cria o lote 1
    const res1 = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "tenant-sessao",
        instanceName: "GD Sessao",
        sources: ["conversas"],
        sessionId,
        cursor: 0,
        batchSize: 15,
      }),
    });
    expect(res1.status).toBe(200);

    // Força a expiração do TTL na sessão em memória
    const sessionKey = `tenant-sessao:GD Sessao:${sessionId}`;
    const sessionObj = extractionSessions.get(sessionKey);
    expect(sessionObj).toBeDefined();
    sessionObj.lastAccessAt = Date.now() - (EXTRACTION_SESSION_TTL_MS + 1000);

    // Tenta puxar o lote 2
    const resExpired = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "tenant-sessao",
        instanceName: "GD Sessao",
        sources: ["conversas"],
        sessionId,
        cursor: 15,
        batchSize: 15,
      }),
    });

    expect(resExpired.status).toBe(410);
    const errExpired = await resExpired.json();
    expect(errExpired.error).toBe("WA_EXTRACTION_SESSION_EXPIRED");
    expect(errExpired.message).toMatch(/reinicie a extração/i);
  });

  it("[TESTE OBRIGATÓRIO] o total extraído bate com o total disponível quando a extração vai até o fim", async () => {
    const sessionId = "sessao-total-extracao";
    let cursor = 0;
    let hasMore = true;
    let accumulatedExtracted = 0;
    let totalAvailableReported = 0;

    while (hasMore) {
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "tenant-sessao",
          instanceName: "GD Sessao",
          sources: ["conversas"],
          sessionId,
          cursor,
          batchSize: 15,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      accumulatedExtracted += data.fromChats;
      hasMore = data.hasMore;
      totalAvailableReported = data.totalAvailable;
      cursor = data.nextCursor;
    }

    // Bate exatamente 45 com 45
    expect(accumulatedExtracted).toBe(45);
    expect(totalAvailableReported).toBe(45);
    expect(mockDb.leads).toHaveLength(45);
    // Evolution API só foi chamada 1 vez durante toda a extração
    expect(findChatsCallCount).toBe(1);
  });

  it("[TESTE OBRIGATÓRIO] lote 2 pedido com outra instância não reaproveita a sessão do lote 1 e devolve 410", async () => {
    const sessionId = "sessao-troca-chip";

    // Lote 1 com a instância "GD Sessao"
    const res1 = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "tenant-sessao",
        instanceName: "GD Sessao",
        sources: ["conversas"],
        sessionId,
        cursor: 0,
        batchSize: 15,
      }),
    });
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.fromChats).toBe(15);
    expect(data1.hasMore).toBe(true);

    // Lote 2 tenta continuar a mesma sessão mas com OUTRA instância ("GD Sessao 2")
    const res2 = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "tenant-sessao",
        instanceName: "GD Sessao 2",
        sources: ["conversas"],
        sessionId,
        cursor: 15,
        batchSize: 15,
      }),
    });

    // Como a instância mudou, o backend não acha sessão para "tenant-sessao:GD Sessao 2:sessao-troca-chip"
    // e recusa com 410 para o cliente recomeçar em vez de misturar dados ou atribuir contatos ao chip errado!
    expect(res2.status).toBe(410);
    const err2 = await res2.json();
    expect(err2.error).toBe("WA_EXTRACTION_SESSION_EXPIRED");
    expect(err2.message).toMatch(/Sessão de extração expirada ou não encontrada/i);

    // Garante que nenhum contato do chip 1 foi atribuído ou gravado sob o chip 2
    expect(mockDb.leads.every((l) => l.assigned_to !== "uid-dono-2")).toBe(true);
  });
});

