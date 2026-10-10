// backend/src/test/webhookAudioDispatchE2E.test.js
//
// Teste E2E do caminho real de despacho de áudio no webhook do Chatbot:
// Webhook recebe áudio -> Transcrição -> IA responde -> Síntese de Voz (Onyx) -> Envio via Evolution.
//
// Este teste protege contra regressões no routes.js (como o ReferenceError de normalizeHttpUrl
// ou falhas de wiring no envio multimodal).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";
import { EVOLUTION_V2_AUDIO_UPSERT_FIXTURE } from "./audioTranscriptionAndEnvelopeGuard.test.js";

// Mock de node-edge-tts e fs/promises para síntese determinística e rápida
const mockTtsPromise = vi.fn();
vi.mock("node-edge-tts", () => {
  return {
    EdgeTTS: vi.fn().mockImplementation(function (options) {
      this.options = options;
      this.ttsPromise = mockTtsPromise;
    }),
  };
});

vi.mock("fs/promises", () => {
  return {
    default: {
      readFile: vi.fn().mockResolvedValue(Buffer.from("fake-audio-mp3-bytes")),
      unlink: vi.fn().mockResolvedValue(undefined),
    },
    readFile: vi.fn().mockResolvedValue(Buffer.from("fake-audio-mp3-bytes")),
    unlink: vi.fn().mockResolvedValue(undefined),
  };
});

describe("Webhook Audio Dispatch E2E — Caminho Real de Transcrição, Síntese e Envio", () => {
  let capturedAudioSend = null;
  let originalFetch;

  beforeEach(() => {
    capturedAudioSend = null;
    originalFetch = global.fetch;
    process.env.EVOLUTION_API_URL = "https://vexo-evolution-api.xdvm8y.easypanel.host";
    process.env.EVOLUTION_API_KEY = "mock-evo-key";
    process.env.GROQ_API_KEY = "mock-groq-key";
    mockTtsPromise.mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("[TESTE OBRIGATÓRIO] rota do webhook executa a cadeia completa (transcrição -> resposta -> voz -> normalizeHttpUrl -> sendMediaMessageViaEvolution) sem ReferenceError", async () => {
    vi.useFakeTimers();

    // 1. Mock do fetch global para:
    // a) getBase64FromMediaMessage (download de áudio)
    // b) Groq Whisper (transcrição de áudio)
    // c) Groq / OpenAI LLM (geração de resposta de texto)
    // d) sendWhatsAppAudio da Evolution API
    global.fetch = vi.fn(async (url, opts = {}) => {
      const urlStr = String(url);

      // Download de mídia sob demanda da Evolution
      if (urlStr.includes("/chat/getBase64FromMediaMessage")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            base64: "ZmFrZS1hdWRpby1vcHVzLWJhc2U2NA==",
            mimetype: "audio/ogg; codecs=opus",
          }),
        };
      }

      // Transcrição de áudio via Groq Whisper
      if (urlStr.includes("/audio/transcriptions")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            text: "Olá, tudo bem com você? O que você oferece?",
          }),
        };
      }

      // Envio de áudio WhatsApp via Evolution API
      if (urlStr.includes("/message/sendWhatsAppAudio")) {
        capturedAudioSend = {
          url: urlStr,
          headers: opts.headers,
          body: JSON.parse(opts.body || "{}"),
        };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true, key: { id: "wa-audio-sent-123" } }),
        };
      }

      // Fallback padrão para chamadas de IA (LLM)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  resposta: "Olá Conrado! Tudo bem? Oferecemos soluções completas de automação e CRM para vendas.",
                  dados: {},
                  finalizado: false,
                  lead_source: "WhatsApp",
                }),
              },
            },
          ],
        }),
      };
    });

    const routes = {};
    const mockApp = {
      post: vi.fn((path, ...handlers) => {
        routes[`POST ${path}`] = handlers[handlers.length - 1];
      }),
      get: vi.fn((path, ...handlers) => {
        routes[`GET ${path}`] = handlers[handlers.length - 1];
      }),
      delete: vi.fn((path, ...handlers) => {
        routes[`DELETE ${path}`] = handlers[handlers.length - 1];
      }),
      put: vi.fn((path, ...handlers) => {
        routes[`PUT ${path}`] = handlers[handlers.length - 1];
      }),
    };

    const mockLeadRows = [
      {
        id: "lead-conrado-1",
        client_id: "vexo-adm",
        telefone: "5534997817660",
        phone: "5534997817660",
        historico: [],
        dados: {},
        status_conversa: "aberto",
        finalizado: false,
      },
    ];

    const mockAgentRows = [
      {
        id: "agente-vexo-1",
        tenant_id: "vexo-adm",
        name: "Joao",
        inbound_enabled: true,
        evolution_instance: "vexo-adm-vexo-atende",
        evolution_instances: ["vexo-adm-vexo-atende"],
        inbound_prompt: "Você é um assistente de vendas da Vexo.",
        inbound_spin_fields: [],
        instructions_consolidated_at: "2026-10-10T17:00:00.000Z",
      },
    ];

    const createChain = (tableName) => {
      const rows = tableName === "followup_companies" ? mockAgentRows : mockLeadRows;
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        in: vi.fn(() => chain),
        is: vi.fn(() => chain),
        gte: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => ({ data: rows[0], error: null })),
        single: vi.fn(async () => ({ data: rows[0], error: null })),
        insert: vi.fn(async () => ({ data: null, error: null })),
        update: vi.fn(() => chain),
        then: (resolve) => resolve({ data: rows, error: null }),
      };
      return chain;
    };

    const mockSupabase = {
      from: vi.fn((tableName) => createChain(tableName)),
    };

    const mockDbPool = {
      query: vi.fn(async (sql) => {
        const sqlStr = String(sql);
        if (sqlStr.includes("evolution_instances") || sqlStr.includes("instances")) {
          return {
            rows: [
              {
                id: "chip-1",
                client_id: "vexo-adm",
                name: "Vexo atende",
                dispatch_webhook_url: "https://vexo-evolution-api.xdvm8y.easypanel.host/message/sendText/vexo-adm-vexo-atende",
                dispatch_webhook_token: "evo-secret-token",
                active: true,
                is_default: true,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const mockGetLeadClientN8nSettings = vi.fn(async (clientId) => ({
      client_id: clientId,
      chatbot_enabled: true,
      inbound_scope: "all",
      chatbot_voice_mode: "mirror",
      chatbot_voice_id: "onyx",
      chatbot_voice_speed: 1.0,
      chatbot_model: "generico",
      sdr_numbers: [],
    }));

    const deps = {
      ensureDb: () => true,
      getLeadClientEvolutionInstances: async () => [
        {
          id: "chip-1",
          name: "Vexo atende",
          dispatch_webhook_url: "https://vexo-evolution-api.xdvm8y.easypanel.host/message/sendText/vexo-adm-vexo-atende",
          dispatch_webhook_token: "evo-secret-token",
          active: true,
        },
      ],
      getLeadClientN8nSettings: mockGetLeadClientN8nSettings,
      internalErrorPayloadDetails: () => ({}),
      isMissingSchemaError: () => false,
      leadsTableName: () => "leads",
      maskPhoneForLog: (p) => p,
      MAX_LEADS_OUTLIER_BATCH: 100,
      continueCampaignLeadFromReply: async () => ({ continued: false }),
      findCampaignReplyMatches: async () => ({ matches: [], waitForReplyMatches: [], processingWaitForReplyMatches: [] }),
      normalizeString: (s) => (s ? String(s).trim() : ""),
      normalizeTenantKey: (k) => k || "vexo-adm",
      pgDatabasePool: mockDbPool,
      requireAppViewAccess: () => (_req, _res, next) => next(),
      requireFirebaseAuth: (_req, _res, next) => next(),
      resolveAuthorizedClientId: (_req, _res, cid) => cid || "vexo-adm",
      resolveDispatchWebhookSettings: async () => ({
        webhookUrl: "https://vexo-evolution-api.xdvm8y.easypanel.host/message/sendText/vexo-adm-vexo-atende",
        webhookToken: "evo-secret-token",
        source: "chip",
      }),
      resolveInboundDispatchSettings: async () => ({
        webhookUrl: "https://vexo-evolution-api.xdvm8y.easypanel.host/message/sendText/vexo-adm-vexo-atende",
        webhookToken: "evo-secret-token",
        source: "inbound_chip",
        instanceName: "vexo-adm-vexo-atende",
      }),
      sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
      sendError: vi.fn(),
      supabase: mockSupabase,
      validateLeadsOutlierRecord: () => true,
      validateN8nInboundBearer: () => true,
    };

    // Monta as rotas reais de chatbot
    registerChatbotRoutes(mockApp, deps);

    const webhookHandler = routes["POST /api/hardcoded-chat-webhook"];
    expect(webhookHandler).toBeDefined();

    // 2. Dispara webhook com fixture de áudio real
    const req = {
      body: EVOLUTION_V2_AUDIO_UPSERT_FIXTURE,
      query: { clientId: "vexo-adm" },
    };
    const res = {
      json: vi.fn(),
    };

    await webhookHandler(req, res);

    // O webhook responde 200 imediatamente e coloca na fila de buffer
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    // 3. Avança os timers para disparar o bufferMessage e a execução do batch com IA e voz
    await vi.advanceTimersByTimeAsync(4000);

    // 4. Valida que o áudio de voz foi sintetizado e enviado para o endpoint da Evolution
    // SEM lançar 'ReferenceError: normalizeHttpUrl is not defined'
    expect(capturedAudioSend).not.toBeNull();
    expect(capturedAudioSend.url).toBe("https://vexo-evolution-api.xdvm8y.easypanel.host/message/sendWhatsAppAudio/vexo-adm-vexo-atende");
    expect(capturedAudioSend.body.number).toBe("5534997817660");
    expect(capturedAudioSend.body.audio).toBeDefined();
    expect(capturedAudioSend.body.encoding).toBe(true);
    expect(capturedAudioSend.headers.apikey).toBe("evo-secret-token");
  });
});
