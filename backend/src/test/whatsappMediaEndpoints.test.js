// backend/src/test/whatsappMediaEndpoints.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";
import * as storage from "../services/storage.js";
import * as evolution from "../services/evolution.js";
import { resolveMessageContent, transcribeAudio, AUDIO_TRANSCRIPTION_TIMEOUT_MS } from "../chatbot-ai-engine.js";

describe("WhatsApp Media Endpoints (GET /api/whatsapp/media/:waMessageId e POST /api/whatsapp/messages/media)", () => {
  let routes = {};
  let mockDbRows = [];
  let dbQueries = [];

  const mockPgPool = {
    query: vi.fn(async (text, params) => {
      dbQueries.push({ text, params });
      if (text.includes("FROM public.lead_messages")) {
        const clientId = params[0];
        const waId = params[1];
        const filtered = mockDbRows.filter(
          (r) => r.client_id === clientId && (r.wa_message_id === waId || String(r.id) === waId)
        );
        return { rows: filtered };
      }
      return { rows: [] };
    }),
  };

  const app = {
    get: (path, ...rest) => {
      routes[`GET ${path}`] = rest[rest.length - 1];
    },
    post: (path, ...rest) => {
      routes[`POST ${path}`] = rest[rest.length - 1];
    },
    delete: () => {},
    put: () => {},
    patch: () => {},
  };

  const deps = {
    ensureDb: () => true,
    getLeadClientEvolutionInstances: vi.fn(async () => [
      { id: "inst-1", name: "sonhare-evo", active: true, is_default: true, dispatch_webhook_url: "https://evo.host/message/sendText/sonhare-evo", dispatch_webhook_token: "token-123" },
    ]),
    getLeadClientN8nSettings: vi.fn(),
    internalErrorPayloadDetails: () => ({}),
    isMissingSchemaError: () => false,
    leadsTableName: () => "leads",
    maskPhoneForLog: (p) => p,
    MAX_LEADS_OUTLIER_BATCH: 100,
    continueCampaignLeadFromReply: vi.fn(),
    findCampaignReplyMatches: vi.fn(),
    normalizeString: (s) => (typeof s === "string" ? s.trim() : null),
    normalizeTenantKey: (s) => (typeof s === "string" ? s.trim() : null),
    pgDatabasePool: mockPgPool,
    requireAppViewAccess: () => (req, res, next) => next?.(),
    requireFirebaseAuth: (req, res, next) => next?.(),
    resolveAuthorizedClientId: (req, res, reqClientId) => reqClientId || "tenant-sonhare",
    resolveDispatchWebhookSettings: vi.fn(),
    resolveInboundDispatchSettings: vi.fn(),
    sanitizePhone: (p) => (p || "").replace(/\D/g, ""),
    sendError: (res, status, code, message) => {
      res._status = status;
      res._json = { success: false, error: { code, message } };
      return res;
    },
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: { id: 1 }, error: null }),
          }),
        }),
      }),
    },
    validateLeadsOutlierRecord: () => true,
    validateN8nInboundBearer: () => true,
  };

  beforeEach(() => {
    routes = {};
    mockDbRows = [];
    dbQueries = [];
    vi.clearAllMocks();
    registerChatbotRoutes(app, deps);
  });

  it("1. GET /api/whatsapp/media isola estritamente por client_id (regra anti-vazamento do Conrado)", async () => {
    const handler = routes["GET /api/whatsapp/media/:waMessageId"];
    expect(handler).toBeDefined();

    // Mensagem existe no tenant A (tenant-sonhare), mas tenant B tenta consultar
    mockDbRows = [
      {
        id: 100,
        client_id: "tenant-sonhare",
        wa_message_id: "WA-LEAK-TEST-01",
        phone: "5534999990000",
        message_text: "[áudio] Mensagem sigilosa",
        media_path: "media/tenant-sonhare/2026/09/WA-LEAK-TEST-01.ogg",
        effective_timestamp: new Date().toISOString(),
      },
    ];

    const req = {
      params: { waMessageId: "WA-LEAK-TEST-01" },
      query: { clientId: "outro-tenant-invasor" },
      headers: {},
    };

    const res = {
      _status: 200,
      _json: null,
      status(s) { this._status = s; return this; },
      json(d) { this._json = d; return this; },
      send() { return this; },
      setHeader() {},
    };

    await handler(req, res);

    expect(res._status).toBe(404);
    expect(res._json?.error?.code).toBe("MEDIA_NOT_FOUND");
    // Verifica que a query no Postgres usou client_id = $1
    expect(dbQueries[0].params[0]).toBe("outro-tenant-invasor");
  });

  it("2. GET /api/whatsapp/media retorna JSON com dataUrl quando requisitado com format=json", async () => {
    const handler = routes["GET /api/whatsapp/media/:waMessageId"];

    mockDbRows = [
      {
        id: 200,
        client_id: "tenant-sonhare",
        wa_message_id: "WA-AUDIO-200",
        phone: "5534999990000",
        message_text: "Quero saber o preço do pacote",
        meta: { transcribed: true, messageType: "audio" },
        media_path: "media/tenant-sonhare/2026/09/WA-AUDIO-200.ogg",
        effective_timestamp: new Date().toISOString(),
      },
    ];

    const fakeAudio = Buffer.from("OggS-fake-audio-bytes");
    vi.spyOn(storage, "getMediaBuffer").mockResolvedValueOnce({
      buffer: fakeAudio,
      contentType: "audio/ogg",
      source: "r2",
    });

    const req = {
      params: { waMessageId: "WA-AUDIO-200" },
      query: { clientId: "tenant-sonhare", format: "json" },
      headers: { accept: "application/json" },
    };

    let resultJson = null;
    const res = {
      _status: 200,
      status(s) { this._status = s; return this; },
      json(d) { resultJson = d; return this; },
      setHeader() {},
      send() {},
    };

    await handler(req, res);

    expect(resultJson?.item).toBeDefined();
    expect(resultJson.item.mediaType).toBe("audio");
    expect(resultJson.item.mimeType).toBe("audio/ogg");
    expect(resultJson.item.dataUrl).toContain("data:audio/ogg;base64,");
    expect(resultJson.item.transcription).toBe("Quero saber o preço do pacote");
    expect(resultJson.item.expired).toBe(false);
  });

  it("3. GET /api/whatsapp/media marca expired=true para mídia antiga (>20 dias) sem cópia no R2", async () => {
    const handler = routes["GET /api/whatsapp/media/:waMessageId"];

    // Mensagem de 25 dias atrás sem media_path
    const twentyFiveDaysAgo = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString();
    mockDbRows = [
      {
        id: 300,
        client_id: "tenant-sonhare",
        wa_message_id: "WA-EXPIRED-300",
        phone: "5534999990000",
        message_text: "Áudio do cliente que já foi transcrito antes",
        meta: { transcribed: true, messageType: "audio" },
        media_path: null,
        effective_timestamp: twentyFiveDaysAgo,
      },
    ];

    const req = {
      params: { waMessageId: "WA-EXPIRED-300" },
      query: { clientId: "tenant-sonhare", format: "json" },
      headers: {},
    };

    let resultJson = null;
    const res = {
      _status: 200,
      status(s) { this._status = s; return this; },
      json(d) { resultJson = d; return this; },
      setHeader() {},
      send() {},
    };

    await handler(req, res);

    expect(resultJson?.item?.expired).toBe(true);
    expect(resultJson?.item?.dataUrl).toBeNull();
    // Transcrição histórica permanece preservada mesmo com mídia expirada
    expect(resultJson?.item?.transcription).toBe("Áudio do cliente que já foi transcrito antes");
  });

  it("4. POST /api/whatsapp/messages/media rejeita arquivos maiores que o teto de envio", async () => {
    const handler = routes["POST /api/whatsapp/messages/media"];
    expect(handler).toBeDefined();

    // Cria payload simulando arquivo de 17 MB (acima de 16 MB)
    const largeBuffer = Buffer.alloc(17 * 1024 * 1024);
    const req = {
      body: {
        chatId: "5534999991111",
        mediaType: "image",
        base64: largeBuffer.toString("base64"),
        clientId: "tenant-sonhare",
      },
      headers: {},
    };

    const res = {
      _status: 200,
      _json: null,
      status(s) { this._status = s; return this; },
      json(d) { this._json = d; return this; },
    };

    await handler(req, res);

    expect(res._status).toBe(400);
    expect(res._json?.error?.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("5. POST /api/whatsapp/messages/media envia áudio via sendMediaMessageViaEvolution com encoding=true", async () => {
    const handler = routes["POST /api/whatsapp/messages/media"];

    const sendEvoSpy = vi.spyOn(evolution, "sendMediaMessageViaEvolution").mockResolvedValueOnce({
      success: true,
      waMessageId: "WA-SENT-AUDIO-999",
      raw: { status: "SERVER_ACK" },
    });

    const saveStorageSpy = vi.spyOn(storage, "saveMediaBuffer").mockResolvedValueOnce({
      mediaPath: "media/tenant-sonhare/2026/09/WA-SENT-AUDIO-999.ogg",
      sizeBytes: 1024,
      mimetype: "audio/ogg",
    });

    const req = {
      body: {
        chatId: "5534999992222",
        mediaType: "audio",
        base64: Buffer.from("audio-bytes").toString("base64"),
        mimetype: "audio/ogg",
        clientId: "tenant-sonhare",
      },
      headers: {},
    };

    let resultJson = null;
    let statusCode = null;
    const res = {
      status(s) { statusCode = s; return this; },
      json(d) { resultJson = d; return this; },
    };

    await handler(req, res);

    expect(statusCode).toBe(201);
    expect(resultJson?.item?.waMessageId).toBe("WA-SENT-AUDIO-999");
    expect(resultJson?.item?.mediaPath).toBe("media/tenant-sonhare/2026/09/WA-SENT-AUDIO-999.ogg");

    expect(sendEvoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceName: "sonhare-evo",
        number: "5534999992222",
        mediaType: "audio",
      })
    );
    expect(saveStorageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "tenant-sonhare",
        waMessageId: "WA-SENT-AUDIO-999",
        mediaType: "audio",
      })
    );
  });

  it("6. GET /api/whatsapp/media executa cascata para Evolution se idade <= 20 dias e persiste no R2", async () => {
    const handler = routes["GET /api/whatsapp/media/:waMessageId"];

    // Mensagem recebida há 3 dias (dentro dos 20 dias) mas sem media_path
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    mockDbRows = [
      {
        id: 400,
        client_id: "tenant-sonhare",
        wa_message_id: "WA-RECENT-400",
        phone: "5534999990000",
        instance_name: "sonhare-evo",
        message_text: "[imagem]",
        meta: { messageType: "image" },
        media_path: null,
        effective_timestamp: threeDaysAgo,
      },
    ];

    const evoPullSpy = vi.spyOn(evolution, "fetchMediaBase64FromEvolution").mockResolvedValueOnce({
      base64: Buffer.from("image-bytes-from-evo").toString("base64"),
      mimetype: "image/jpeg",
    });

    const saveStorageSpy = vi.spyOn(storage, "saveMediaBuffer").mockResolvedValueOnce({
      mediaPath: "media/tenant-sonhare/2026/09/WA-RECENT-400.jpg",
      sizeBytes: 1024,
      mimetype: "image/jpeg",
    });

    const req = {
      params: { waMessageId: "WA-RECENT-400" },
      query: { clientId: "tenant-sonhare", format: "json" },
      headers: {},
    };

    let resultJson = null;
    const res = {
      _status: 200,
      status(s) { this._status = s; return this; },
      json(d) { resultJson = d; return this; },
      setHeader() {},
      send() {},
    };

    await handler(req, res);

    expect(evoPullSpy).toHaveBeenCalledWith("sonhare-evo", "WA-RECENT-400");
    expect(saveStorageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "tenant-sonhare",
        waMessageId: "WA-RECENT-400",
        mediaType: "image",
      })
    );
    expect(resultJson?.item?.source).toBe("evolution");
    expect(resultJson?.item?.mimeType).toBe("image/jpeg");
    expect(resultJson?.item?.expired).toBe(false);
  });

  it("7. GET /api/whatsapp/media retorna binário com Content-Type e Cache-Control para carregamento direto", async () => {
    const handler = routes["GET /api/whatsapp/media/:waMessageId"];

    mockDbRows = [
      {
        id: 500,
        client_id: "tenant-sonhare",
        wa_message_id: "WA-BIN-500",
        phone: "5534999990000",
        message_text: "[áudio]",
        meta: { messageType: "audio" },
        media_path: "media/tenant-sonhare/2026/09/WA-BIN-500.ogg",
        effective_timestamp: new Date().toISOString(),
      },
    ];

    const fakeOgg = Buffer.from("OggS-raw-audio");
    vi.spyOn(storage, "getMediaBuffer").mockResolvedValueOnce({
      buffer: fakeOgg,
      contentType: "audio/ogg",
      source: "local",
    });

    const req = {
      params: { waMessageId: "WA-BIN-500" },
      query: { clientId: "tenant-sonhare" },
      headers: { accept: "*/*" },
    };

    const headersSet = {};
    let sentBuffer = null;
    const res = {
      setHeader(k, v) { headersSet[k] = v; },
      send(b) { sentBuffer = b; return this; },
    };

    await handler(req, res);

    expect(headersSet["Content-Type"]).toBe("audio/ogg");
    expect(headersSet["Cache-Control"]).toBe("public, max-age=86400");
    expect(headersSet["Content-Length"]).toBe(fakeOgg.length);
    expect(sentBuffer).toEqual(fakeOgg);
  });

  it("8. resolveMessageContent descarta mensagens de grupo (@g.us) SEM chamar a Evolution API nem salvar no R2", async () => {
    const evoPullSpy = vi.spyOn(evolution, "fetchMediaBase64FromEvolution").mockResolvedValueOnce({
      base64: Buffer.from("audio-bytes").toString("base64"),
      mimetype: "audio/ogg",
    });
    const saveStorageSpy = vi.spyOn(storage, "saveMediaBuffer");

    const groupPayload = {
      data: {
        key: {
          remoteJid: "120363024829182391@g.us",
          id: "WA-GRP-123",
          fromMe: false,
        },
        message: {
          audioMessage: { mimetype: "audio/ogg" },
        },
      },
    };

    const res = await resolveMessageContent(groupPayload, {
      clientId: "tenant-sonhare",
      instanceName: "sonhare-evo",
    });

    expect(evoPullSpy).not.toHaveBeenCalled();
    expect(saveStorageSpy).not.toHaveBeenCalled();
    expect(res.type).toBe("audio");
    expect(res.text).toBe("[áudio]");
    expect(res.transcribed).toBe(false);
  });

  it("9. resolveMessageContent descarta figurinha (sticker) SEM chamar a Evolution API nem salvar no R2", async () => {
    const evoPullSpy = vi.spyOn(evolution, "fetchMediaBase64FromEvolution").mockResolvedValueOnce({
      base64: Buffer.from("sticker-bytes").toString("base64"),
      mimetype: "image/webp",
    });
    const saveStorageSpy = vi.spyOn(storage, "saveMediaBuffer");

    const stickerPayload = {
      data: {
        key: {
          remoteJid: "5534999990000@s.whatsapp.net",
          id: "WA-STK-999",
          fromMe: false,
        },
        message: {
          stickerMessage: { mimetype: "image/webp" },
        },
      },
    };

    const res = await resolveMessageContent(stickerPayload, {
      clientId: "tenant-sonhare",
      instanceName: "sonhare-evo",
    });

    expect(evoPullSpy).not.toHaveBeenCalled();
    expect(saveStorageSpy).not.toHaveBeenCalled();
    expect(res.type).toBe("sticker");
    expect(res.text).toBe("[sticker]");
  });

  it("10. resolveMessageContent com fromMe=true NÃO executa pull na Evolution nem transcrição", async () => {
    const evoPullSpy = vi.spyOn(evolution, "fetchMediaBase64FromEvolution");

    const fromMeAudioPayload = {
      data: {
        key: {
          remoteJid: "5534999990000@s.whatsapp.net",
          id: "WA-FROM-ME-01",
          fromMe: true,
        },
        message: {
          audioMessage: { mimetype: "audio/ogg" },
        },
      },
    };

    const res = await resolveMessageContent(fromMeAudioPayload, {
      clientId: "tenant-sonhare",
      instanceName: "sonhare-evo",
      fromMe: true,
    });

    expect(evoPullSpy).not.toHaveBeenCalled();
    expect(res.type).toBe("audio");
    expect(res.text).toBe("[áudio]");
    expect(res.transcribed).toBe(false);
  });

  it("11. transcribeAudio timeout ou erro: mensagem segue com fallback [áudio] sem interromper o fluxo", async () => {
    // Simula áudio com base64 já disponível mas cujo Whisper falha/dá timeout
    const audioPayload = {
      data: {
        key: {
          remoteJid: "5534999990000@s.whatsapp.net",
          id: "WA-AUDIO-TIMEOUT-1",
          fromMe: false,
        },
        message: {
          audioMessage: {
            mimetype: "audio/ogg",
            base64: Buffer.from("fake-audio-bytes").toString("base64"),
          },
        },
      },
    };

    const originalFetch = global.fetch;
    const oldGroqKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "gsk_test_key_mock";

    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (String(url).includes("/audio/transcriptions")) {
        const timeoutError = new Error("The operation was aborted due to timeout");
        timeoutError.name = "TimeoutError";
        throw timeoutError;
      }
      return originalFetch(url);
    });

    try {
      const res = await resolveMessageContent(audioPayload, {
        clientId: "tenant-sonhare",
        instanceName: "sonhare-evo",
        fromMe: false,
      });

      // Se estourar o timeout, a mensagem segue com fallback [áudio] e transcribed: false
      expect(res.type).toBe("audio");
      expect(res.text).toBe("[áudio]");
      expect(res.transcribed).toBe(false);
    } finally {
      global.fetch = originalFetch;
      process.env.GROQ_API_KEY = oldGroqKey;
    }
  });
});
