// backend/src/test/inboundBufferChipIsolation.test.js
//
// TESTES OBRIGATÓRIOS — Cruzamento de Chip e Resposta Duplicada (Blocos 1 e 2)
//
// Prova, não teste verde:
//  a) Duas mensagens do mesmo lead em formatos diferentes ("34991510131" e
//     "5534991510131@s.whatsapp.net") caem na mesma chave canônica -> UMA resposta só
//  b) Mensagens do mesmo lead por instâncias diferentes -> buffers separados;
//     timer de uma NÃO cancela o da outra
//  c) Resposta do bot grava instance_name preenchido com a instância que enviou,
//     mesmo quando o webhook vem sem instance identifier

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "http";

vi.mock("../chatbot-ai-engine.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    processBatch: vi.fn(async () => ({
      mensagem: "Olá! Como posso ajudar?",
      status_conversa: "em_atendimento",
      classificacao: "qualificado",
    })),
  };
});

import { bufferMessage, _messageBuffersForTest } from "../chatbot-ai-engine.js";
import { toCanonicalPhoneFromJid } from "../services/canonicalPhone.js";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";

describe("CRUZAMENTO DE CHIP E RESPOSTA DUPLICADA — Blocos 1 e 2", () => {
  beforeEach(() => {
    _messageBuffersForTest.clear();
  });

  afterEach(() => {
    _messageBuffersForTest.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("toCanonicalPhoneFromJid", () => {
    it("canonicaliza telefone cru sem DDI e JID com DDI para a mesma string canônica", () => {
      const rawWithoutDdi = "34991510131";
      const rawJid = "5534991510131@s.whatsapp.net";
      const rawCUs = "553491510131@c.us"; // sem o nono dígito

      expect(toCanonicalPhoneFromJid(rawWithoutDdi)).toBe("5534991510131");
      expect(toCanonicalPhoneFromJid(rawJid)).toBe("5534991510131");
      expect(toCanonicalPhoneFromJid(rawCUs)).toBe("5534991510131");
      expect(toCanonicalPhoneFromJid(rawWithoutDdi)).toBe(toCanonicalPhoneFromJid(rawJid));
    });

    it("@g.us e @lid não são tratados como telefone e preservam o identificador", () => {
      const groupJid = "120363049633060243@g.us";
      const lidJid = "100200300@lid";

      expect(toCanonicalPhoneFromJid(groupJid)).toBe(groupJid);
      expect(toCanonicalPhoneFromJid(lidJid)).toBe(lidJid);
      // Não colidem com telefone
      expect(toCanonicalPhoneFromJid(groupJid)).not.toBe("120363049633060243");
    });

    it("trata null, undefined e strings vazias sem lançar erro", () => {
      expect(toCanonicalPhoneFromJid(null)).toBe("");
      expect(toCanonicalPhoneFromJid(undefined)).toBe("");
      expect(toCanonicalPhoneFromJid("   ")).toBe("");
    });
  });

  describe("Bloco 1 — Buffer por chip e telefone canônico", () => {
    it("TESTE (a): duas mensagens do mesmo lead com formatos diferentes dentro de 3s -> UMA resposta só", () => {
      vi.useFakeTimers();
      const processSpy = vi.fn();
      const clientId = "client-spazio";
      const instance = "bia-do-spazio-slug";

      // Mensagem 1: formato curto sem DDI
      bufferMessage(clientId, "34991510131", { text: "Olá, gostaria de saber os preços" }, processSpy, instance);

      // Avança 1.5s (dentro do delay de 3s)
      vi.advanceTimersByTime(1500);
      expect(processSpy).not.toHaveBeenCalled();

      // Mensagem 2: formato JID da Evolution
      bufferMessage(clientId, "5534991510131@s.whatsapp.net", { text: "Tem alguém disponível?" }, processSpy, instance);

      // Avança mais 3s
      vi.advanceTimersByTime(3000);

      // Deve disparar UMA única vez com o lote de 2 mensagens agrupadas
      expect(processSpy).toHaveBeenCalledTimes(1);
      expect(processSpy).toHaveBeenCalledWith([
        { text: "Olá, gostaria de saber os preços" },
        { text: "Tem alguém disponível?" },
      ]);
    });

    it("TESTE (b): mensagens do mesmo lead chegando por instâncias diferentes -> buffers separados e timers independentes", () => {
      vi.useFakeTimers();
      const processChipA = vi.fn();
      const processChipB = vi.fn();
      const clientId = "client-spazio";
      const leadPhone = "5534991510131";

      // Mensagem no Chip A
      bufferMessage(clientId, leadPhone, { text: "Msg no chip A" }, processChipA, "chip-a-slug");

      // Passam 2 segundos
      vi.advanceTimersByTime(2000);
      expect(processChipA).not.toHaveBeenCalled();
      expect(processChipB).not.toHaveBeenCalled();

      // Mensagem no Chip B para o mesmo lead
      bufferMessage(clientId, leadPhone, { text: "Msg no chip B" }, processChipB, "chip-b-slug");

      // Passa mais 1 segundo (total 3s desde chip A, mas apenas 1s para chip B)
      vi.advanceTimersByTime(1000);

      // O timer do Chip A completou 3s: DEVE ter processado!
      // O timer do Chip B NÃO cancelou o do Chip A!
      expect(processChipA).toHaveBeenCalledTimes(1);
      expect(processChipA).toHaveBeenCalledWith([{ text: "Msg no chip A" }]);
      expect(processChipB).not.toHaveBeenCalled();

      // Passam mais 2 segundos (total 3s desde chip B)
      vi.advanceTimersByTime(2000);

      // Agora o Chip B também processa de forma independente
      expect(processChipB).toHaveBeenCalledTimes(1);
      expect(processChipB).toHaveBeenCalledWith([{ text: "Msg no chip B" }]);
    });

    it("instância ausente ou vazia usa marcador explícito 'sem-instancia'", () => {
      vi.useFakeTimers();
      const processSpy = vi.fn();
      const clientId = "client-spazio";

      bufferMessage(clientId, "34991510131", { text: "Msg sem instância" }, processSpy, null);

      const expectedKey = `${clientId}:sem-instancia:5534991510131`;
      expect(_messageBuffersForTest.has(expectedKey)).toBe(true);

      vi.advanceTimersByTime(3000);
      expect(processSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("Bloco 2 — Registro da instância que de fato enviou na resposta do bot", () => {
    it("TESTE (c): resposta do bot grava instance_name preenchido com a instância que enviou (targetInstance)", async () => {
      const app = express();
      app.use(express.json());

      let recordedMessage = null;
      const fakeDispatchSettings = {
        webhookUrl: "https://evo.vexo.test/message/sendText/instancia-enviadora-real",
        webhookToken: "test-token",
        source: "tenant_default",
        instanceName: "instancia-enviadora-real",
        tentativas: [],
      };

      const createChain = (tableName) => {
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          in: vi.fn(() => chain),
          is: vi.fn(() => chain),
          gte: vi.fn(() => chain),
          order: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          maybeSingle: vi.fn(async () => ({ data: { id: "lead-1" }, error: null })),
          single: vi.fn(async () => ({ data: { id: "lead-1" }, error: null })),
          insert: vi.fn(async (payload) => {
            if (tableName === "lead_messages" && payload.sender_type === "bot") {
              recordedMessage = payload;
            }
            return { data: null, error: null };
          }),
          update: vi.fn(() => chain),
          then: (resolve) => resolve({ data: [], error: null }),
        };
        return chain;
      };

      const fakeSupabase = {
        from: vi.fn((tableName) => createChain(tableName)),
      };

      // Mock fetch global para simular retorno de envio à Evolution
      const originalFetch = global.fetch;
      global.fetch = vi.fn(async (url) => {
        if (String(url).includes("evo.vexo.test")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ key: { id: "wa-msg-123" } }),
            text: async () => JSON.stringify({ key: { id: "wa-msg-123" } }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      const mockDb = {
        query: vi.fn(async () => ({ rows: [] })),
        connect: vi.fn(async () => ({
          query: vi.fn(async () => ({ rows: [] })),
          release: vi.fn(),
        })),
      };

      const deps = {
        classifyConversation: vi.fn(async () => ({ ignore: false })),
        ensureDb: () => true,
        ensureDbClient: vi.fn(),
        findCampaignReplyMatches: vi.fn(async () => ({ matches: [], waitForReplyMatches: [], processingWaitForReplyMatches: [] })),
        getLeadClientEvolutionInstances: vi.fn(async () => []),
        getLeadClientN8nSettings: vi.fn(async () => ({
          chatbot_enabled: true,
          chatbot_inbound_scope: "all",
        })),
        internalErrorPayloadDetails: vi.fn(),
        isMissingSchemaError: () => false,
        leadsTableName: () => "leads",
        maskPhoneForLog: (p) => p,
        MAX_LEADS_OUTLIER_BATCH: 50,
        continueCampaignLeadFromReply: vi.fn(),
        normalizeString: (s) => (s ? String(s).trim() : ""),
        normalizeTenantKey: (k) => k || "outlier",
        pgDatabasePool: mockDb,
        requireAppViewAccess: () => (_req, _res, next) => next(),
        requireFirebaseAuth: (_req, _res, next) => next(),
        resolveAuthorizedClientId: (_req, _res, cid) => cid || "test-client",
        resolveDispatchWebhookSettings: vi.fn(async () => fakeDispatchSettings),
        resolveInboundDispatchSettings: vi.fn(async () => fakeDispatchSettings),
        sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
        sendError: (res, status, code, msg) => res.status(status).json({ error: code, message: msg }),
        supabase: fakeSupabase,
        validateLeadsOutlierRecord: () => true,
        validateN8nInboundBearer: vi.fn(async () => true),
      };

      registerChatbotRoutes(app, deps);

      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;

      try {
        vi.useFakeTimers();

        // Envia webhook sem instância identificada (instanceName nulo)
        const res = await originalFetch(`http://127.0.0.1:${port}/api/hardcoded-chat-webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: "test-client",
            phone: "5534991510131",
            message: "Olá bot",
            key: { id: "test-msg-1" },
            // Sem instance ou instanceName!
          }),
        });

        expect(res.status).toBe(200);

        // O webhook coloca a mensagem no bufferMessage (3000ms delay).
        // Dispara os timers para que a rota real execute o processBatch e o appendLeadMessage da resposta
        await vi.advanceTimersByTimeAsync(3500);

        expect(recordedMessage).not.toBeNull();
        expect(recordedMessage.instance_name).toBe("instancia-enviadora-real");
      } finally {
        vi.useRealTimers();
        global.fetch = originalFetch;
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });
});
