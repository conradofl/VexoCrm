// Fase 3 — o agente de atendimento manda um áudio da Biblioteca de Áudios.
//
// Caminho REAL, ponta a ponta: webhook do chatbot -> processBatch -> prompt com
// o catálogo -> resposta do modelo -> texto -> áudio -> mensagem gravada.
// Banco da biblioteca: Postgres real em memória (pglite com a migration de
// produção). Storage: o provedor local real.
//
// Dublado, e só isto:
//   - a RESPOSTA DO MODELO (fetch para o provedor de IA);
//   - o ENVIO PELO WHATSAPP (fetch para a Evolution);
//   - a config que vem do Supabase (agente do chip, settings do tenant, lead),
//     no mesmo molde de webhookAudioDispatchE2E.test.js.
// loadAgentAudioCatalog, parseAIResponse, resolveAudioChoice,
// sendAgentLibraryAudio, sendMediaMessageViaEvolution e a leitura do arquivo
// rodam de verdade.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAudioLibraryDb, limparStorageDeTeste, poolFor } from "./helpers/audioLibraryHarness.js";
import { makeWav } from "./helpers/audioFixtures.js";

let db = null;
vi.mock("../services/database.js", async (importOriginal) => {
  const actual = await importOriginal();
  const mocked = { ...actual };
  Object.defineProperty(mocked, "pgDatabasePool", {
    enumerable: true,
    get: () => (db ? { query: (sql, params) => db.query(sql, params) } : null),
  });
  return mocked;
});

const { registerChatbotRoutes } = await import("../domains/chatbot/routes.js");
const { parseAIResponse } = await import("../chatbot-ai-engine.js");
const { createAudio, setAudioAgents, AGENT_AUDIO_MAX_ITEMS } = await import("../audioLibrary/service.js");
const { loadAgentAudioCatalog, normalizeAudioChoice, sendAgentLibraryAudio } = await import("../audioLibrary/agentAudio.js");
const { sendMediaMessageViaEvolution } = await import("../services/evolution.js");

const TENANT_A = "teste-audio-chat-empresa-a";
const TENANT_B = "teste-audio-chat-empresa-b";
const AGENTE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENTE_CAMPANHA_A = "abababab-abab-4bab-8bab-abababababab";
const AGENTE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVO = "https://vexo-evolution-api.xdvm8y.easypanel.host";
const INSTANCIA = "teste-audio-chat-atende";

const LEAD_MESSAGES_SCHEMA = `
  CREATE TABLE public.lead_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL,
    phone text,
    sender_type text NOT NULL DEFAULT 'agent',
    direction text NOT NULL DEFAULT 'outbound',
    message_text text,
    created_at timestamptz NOT NULL DEFAULT now(),
    meta jsonb NOT NULL DEFAULT '{}'::jsonb
  );
`;

let messageSeq = 0;
function mensagemDeTexto(phone, texto) {
  messageSeq += 1;
  return {
    event: "messages.upsert",
    instance: INSTANCIA,
    data: {
      key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: `3EB0AUDIOCHAT${String(messageSeq).padStart(8, "0")}` },
      pushName: "Maria",
      message: { conversation: texto },
      messageType: "conversation",
      messageTimestamp: 1728591234 + messageSeq,
      owner: INSTANCIA,
      source: "android",
    },
    sender: `${phone}@s.whatsapp.net`,
    server_url: EVO,
    apikey: "EVO_TEST_KEY",
  };
}

describe("agente de atendimento manda áudio da biblioteca", () => {
  let pool;
  let wavA;
  let audioA;
  let audioSemInstrucao;
  let envios; // ordem real das chamadas à Evolution: "texto" | "audio"
  let audioBodies;
  let promptsDoModelo;
  let gravadas; // linhas que appendLeadMessage mandou gravar em lead_messages
  let sqlDoPool;
  let respostaDoModelo;
  let evolution; // { texto: status, audio: status }
  let originalFetch;

  async function conversar(texto, phone) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    global.fetch = vi.fn(async (url, opts = {}) => {
      const urlStr = String(url);
      if (urlStr.includes("/message/sendText")) {
        envios.push("texto");
        const ok = evolution.texto < 400;
        return {
          ok,
          status: evolution.texto,
          json: async () => ({ key: { id: "wa-texto-1" } }),
          text: async () => JSON.stringify({ key: { id: "wa-texto-1" } }),
        };
      }
      if (urlStr.includes("/message/sendWhatsAppAudio")) {
        envios.push("audio");
        audioBodies.push({ url: urlStr, body: JSON.parse(opts.body || "{}"), signal: opts.signal });
        const ok = evolution.audio < 400;
        return { ok, status: evolution.audio, text: async () => JSON.stringify({ key: { id: "wa-audio-1" } }) };
      }
      // Qualquer outra chamada é o provedor de IA: a resposta do modelo é o dublê.
      const body = JSON.parse(opts.body || "{}");
      if (Array.isArray(body.messages)) promptsDoModelo.push(body.messages[0]?.content || "");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: typeof respostaDoModelo === "string" ? respostaDoModelo : JSON.stringify(respostaDoModelo) } }],
          usage: { total_tokens: 100 },
        }),
        text: async () => "",
      };
    });

    const routes = {};
    const reg = (method) => vi.fn((path, ...handlers) => { routes[`${method} ${path}`] = handlers[handlers.length - 1]; });
    const mockApp = { post: reg("POST"), get: reg("GET"), delete: reg("DELETE"), put: reg("PUT"), patch: reg("PATCH") };

    const leadRows = [{ id: "lead-1", client_id: TENANT_A, telefone: phone, phone, historico: [], dados: {}, status_conversa: "aberto", finalizado: false }];
    const agentRows = [{
      id: AGENTE_A,
      tenant_id: TENANT_A,
      name: "Atendente",
      agent_kind: "atendimento",
      inbound_enabled: true,
      evolution_instance: INSTANCIA,
      evolution_instances: [INSTANCIA],
      inbound_prompt: "Você é a atendente da loja.",
      inbound_spin_fields: [],
      instructions_consolidated_at: "2026-10-10T17:00:00.000Z",
    }];
    const createChain = (table) => {
      const rows = table === "followup_companies" ? agentRows : leadRows;
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
        insert: vi.fn((row) => {
          if (table === "lead_messages") gravadas.push(row);
          return chain;
        }),
        update: vi.fn(() => chain),
        upsert: vi.fn(() => chain),
        then: (resolve) => resolve({ data: rows, error: null }),
      };
      return chain;
    };

    const chip = {
      id: "chip-1",
      client_id: TENANT_A,
      name: "Atende",
      dispatch_webhook_url: `${EVO}/message/sendText/${INSTANCIA}`,
      dispatch_webhook_token: "evo-secret-token",
      active: true,
      is_default: true,
    };
    const depsPool = {
      query: vi.fn(async (sql, params) => {
        const s = String(sql);
        sqlDoPool.push(s);
        // A biblioteca e o histórico de mensagens são banco de verdade.
        if (s.includes("audio_library") || s.includes("lead_messages")) return db.query(sql, params);
        if (s.includes("evolution_instances") || s.includes("instances")) return { rows: [chip] };
        return { rows: [] };
      }),
    };

    const deps = {
      ensureDb: () => true,
      getLeadClientEvolutionInstances: async () => [chip],
      getLeadClientN8nSettings: vi.fn(async (clientId) => ({
        client_id: clientId,
        chatbot_enabled: true,
        inbound_scope: "all",
        chatbot_voice_mode: "always", // voz sintética pedida: a biblioteca tem que vencer
        chatbot_model: "generico",
        send_window_enabled: false,
        sdr_numbers: [],
      })),
      internalErrorPayloadDetails: () => ({}),
      isMissingSchemaError: () => false,
      leadsTableName: () => "leads",
      maskPhoneForLog: (p) => p,
      MAX_LEADS_OUTLIER_BATCH: 100,
      continueCampaignLeadFromReply: async () => ({ continued: false }),
      findCampaignReplyMatches: async () => ({ matches: [], waitForReplyMatches: [], processingWaitForReplyMatches: [] }),
      normalizeString: (s) => (s ? String(s).trim() : ""),
      normalizeTenantKey: (k) => k || TENANT_A,
      pgDatabasePool: depsPool,
      requireAppViewAccess: () => (_req, _res, next) => next(),
      requireFirebaseAuth: (_req, _res, next) => next(),
      resolveAuthorizedClientId: (_req, _res, cid) => cid || TENANT_A,
      resolveDispatchWebhookSettings: async () => ({ webhookUrl: chip.dispatch_webhook_url, webhookToken: chip.dispatch_webhook_token, source: "chip" }),
      resolveInboundDispatchSettings: async () => ({
        webhookUrl: chip.dispatch_webhook_url,
        webhookToken: chip.dispatch_webhook_token,
        source: "inbound_chip",
        instanceName: INSTANCIA,
      }),
      sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
      sendError: vi.fn(),
      supabase: { from: vi.fn((table) => createChain(table)) },
      validateLeadsOutlierRecord: () => true,
      validateN8nInboundBearer: () => true,
    };

    registerChatbotRoutes(mockApp, deps);
    const webhook = routes["POST /api/hardcoded-chat-webhook"];
    const res = { json: vi.fn() };
    await webhook({ body: mensagemDeTexto(phone, texto), query: { clientId: TENANT_A } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    await vi.advanceTimersByTimeAsync(4000);
    vi.useRealTimers();
    // O lote roda em promessas depois do timer: espera a conversa assentar.
    await vi.waitFor(() => expect(promptsDoModelo.length).toBeGreaterThan(0), { timeout: 8000 });
    await new Promise((ok) => setTimeout(ok, 400));
  }

  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    originalFetch = global.fetch;
    process.env.EVOLUTION_API_URL = EVO;
    process.env.EVOLUTION_API_KEY = "mock-evo-key";
    process.env.GROQ_API_KEY = "mock-groq-key";
    process.env.GEMINI_API_KEY = "mock-gemini-key";

    db = await createAudioLibraryDb({ extraSchema: LEAD_MESSAGES_SCHEMA });
    pool = poolFor(db);
    await db.query(
      `INSERT INTO followup_companies (id, tenant_id, name, agent_kind) VALUES
         ($1, $4, 'Atendente', 'atendimento'), ($2, $4, 'Disparo', 'campanha'), ($3, $5, 'Atendente B', 'atendimento')`,
      [AGENTE_A, AGENTE_CAMPANHA_A, AGENTE_B, TENANT_A, TENANT_B]
    );
    wavA = makeWav({ seconds: 3 });
    audioA = await createAudio(pool, { clientId: TENANT_A, buffer: wavA, name: "Boas-vindas", whenToUse: "Quando o lead diz que chegou pelo anúncio" });
    audioSemInstrucao = await createAudio(pool, { clientId: TENANT_A, buffer: makeWav({ seconds: 2 }), name: "Sem instrução" });
    await setAudioAgents(pool, { id: audioA.id, clientId: TENANT_A, companyIds: [AGENTE_A] });

    envios = [];
    audioBodies = [];
    promptsDoModelo = [];
    gravadas = [];
    sqlDoPool = [];
    evolution = { texto: 200, audio: 200 };
    respostaDoModelo = {
      mensagem: "Que bom que você veio! Te mando um áudio rapidinho explicando.",
      status_conversa: "aguardando_usuario",
      dados: {},
      classificacao: "MORNO",
      finalizado: false,
      nao_comercial: false,
      audio: "A1",
    };
  });

  afterEach(async () => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    await db.close();
    db = null;
    vi.restoreAllMocks();
  });

  afterAll(() => limparStorageDeTeste([TENANT_A, TENANT_B]));

  it("o modelo escolhe A1: sai o texto, DEPOIS o áudio gravado, e o áudio vira mensagem própria", async () => {
    await conversar("Oi, vi o anúncio de vocês", "5534999001001");

    expect(envios).toEqual(["texto", "audio"]);
    expect(audioBodies[0].url).toBe(`${EVO}/message/sendWhatsAppAudio/${INSTANCIA}`);
    expect(audioBodies[0].body.number).toBe("5534999001001");
    expect(Buffer.from(audioBodies[0].body.audio, "base64").equals(wavA)).toBe(true);
    // Na conversa o envio tem tempo limite (não há fila para tentar de novo).
    expect(audioBodies[0].signal).toBeInstanceOf(AbortSignal);

    const doAudio = gravadas.filter((row) => row.meta?.audioLibraryId);
    expect(doAudio).toHaveLength(1);
    expect(doAudio[0]).toMatchObject({
      client_id: TENANT_A,
      direction: "outbound",
      sender_type: "bot",
      message_text: "[áudio: Boas-vindas]",
      meta: { isLibraryAudio: true, audioLibraryId: audioA.id, audioName: "Boas-vindas", companyId: AGENTE_A },
    });
    const doTexto = gravadas.filter((row) => !row.meta?.audioLibraryId && row.direction === "outbound");
    expect(doTexto.map((r) => r.message_text)).toContain("Que bom que você veio! Te mando um áudio rapidinho explicando.");
  });

  it("contenções de prompt: o catálogo leva código, nome e 'quando usar' — nunca id de banco nem caminho de arquivo", async () => {
    await conversar("Oi, vi o anúncio", "5534999001002");

    const prompt = promptsDoModelo.join("\n");
    expect(prompt).toContain('A1 — "Boas-vindas": Quando o lead diz que chegou pelo anúncio');
    expect(prompt).toContain('"audio": "A1"');
    expect(prompt).not.toContain(audioA.id);
    expect(prompt).not.toContain("followup-media");
    expect(prompt).not.toContain(audioA.storage_key);
    // Áudio sem "quando usar" e áudio não ligado ao agente não entram.
    expect(prompt).not.toContain("Sem instrução");
    expect(audioSemInstrucao.when_to_use).toBeNull();
  });

  it("conversa não gasta cota de chip", async () => {
    await conversar("Oi, vi o anúncio", "5534999001003");
    expect(envios).toEqual(["texto", "audio"]);
    // A lista de chips LÊ o uso do dia; o que não pode haver é gravação (reserva).
    const gravacoesNaCota = sqlDoPool.filter((s) =>
      /(INSERT\s+INTO|UPDATE)\s+(public\.)?evolution_instance_daily_usage/i.test(s)
    );
    expect(gravacoesNaCota).toEqual([]);
  });

  it("audio: null — só o texto", async () => {
    respostaDoModelo = { ...respostaDoModelo, audio: null };
    await conversar("Qual o horário de vocês?", "5534999001004");
    expect(envios).toEqual(["texto"]);
    expect(gravadas.some((row) => row.meta?.audioLibraryId)).toBe(false);
  });

  it.each([["A7"], ["a1; DROP"], [audioSemInstrucaoPlaceholder()], [["A1"]], [{ code: "A1" }]])(
    "código fora do catálogo ou malformado (%j) não envia áudio",
    async (escolha) => {
      respostaDoModelo = { ...respostaDoModelo, audio: escolha };
      await conversar("Oi", `55349990020${String(messageSeq).padStart(2, "0")}`);
      expect(envios).toEqual(["texto"]);
    }
  );

  it("o mesmo áudio não vai duas vezes para o mesmo lead (histórico vem das mensagens gravadas)", async () => {
    await db.query(
      `INSERT INTO lead_messages (client_id, phone, direction, sender_type, message_text, meta)
       VALUES ($1, '5534999001005', 'outbound', 'bot', '[áudio: Boas-vindas]', $2::jsonb)`,
      [TENANT_A, JSON.stringify({ audioLibraryId: audioA.id })]
    );
    await conversar("Oi, vi o anúncio de novo", "5534999001005");
    expect(envios).toEqual(["texto"]);

    // Outro lead recebe normalmente.
    envios.length = 0;
    await conversar("Oi, vi o anúncio", "5534999001006");
    expect(envios).toEqual(["texto", "audio"]);
  });

  it("Evolution recusa o áudio: o lead fica com o texto, UMA tentativa só, e nada é gravado como áudio", async () => {
    evolution.audio = 500;
    await conversar("Oi, vi o anúncio", "5534999001007");
    expect(envios).toEqual(["texto", "audio"]);
    expect(gravadas.some((row) => row.meta?.audioLibraryId)).toBe(false);
  });

  it("texto não entregue: áudio solto não é enviado", async () => {
    evolution.texto = 500;
    await conversar("Oi, vi o anúncio", "5534999001008");
    expect(envios).toEqual(["texto"]);
  });

  it("áudio arquivado entre a escolha e o envio não sai", async () => {
    // Arquivado: sai do catálogo, então o código A1 nem existe neste turno.
    await db.query("UPDATE audio_library SET archived_at = now() WHERE id = $1", [audioA.id]);
    await conversar("Oi, vi o anúncio", "5534999001009");
    expect(envios).toEqual(["texto"]);
    expect(promptsDoModelo.join("\n")).not.toContain("ÁUDIOS GRAVADOS PELA EMPRESA");
  });

  it("resposta com contrato quebrado (texto puro) não manda áudio", async () => {
    respostaDoModelo = 'Claro! Vou te mandar o áudio A1 agora. "audio": "A1"';
    await conversar("Oi, vi o anúncio", "5534999001010");
    expect(envios.filter((e) => e === "audio")).toEqual([]);
  });

  // A hora do envio confere de novo tudo que o catálogo conferiu: entre o
  // modelo escolher e o áudio sair, a ligação pode ter mudado.
  describe("conferência na hora do envio (sendAgentLibraryAudio)", () => {
    let chamadas;
    const pedido = (over = {}) => ({
      db: pool,
      clientId: TENANT_A,
      companyId: AGENTE_A,
      phone: "5534999003001",
      instanceName: INSTANCIA,
      apiKey: "t",
      baseUrl: EVO,
      audioRef: { id: audioA.id, name: "Boas-vindas", code: "A1" },
      appendLeadMessage: vi.fn(async () => ({})),
      ...over,
    });

    beforeEach(() => {
      chamadas = [];
      global.fetch = vi.fn(async (url) => {
        chamadas.push(String(url));
        return new Response(JSON.stringify({ key: { id: "wa-1" } }), { status: 201 });
      });
    });

    it("ligado ao agente de atendimento: envia e grava", async () => {
      const p = pedido();
      expect(await sendAgentLibraryAudio(p)).toMatchObject({ sent: true, reason: null, waMessageId: "wa-1" });
      expect(chamadas).toEqual([`${EVO}/message/sendWhatsAppAudio/${INSTANCIA}`]);
      expect(p.appendLeadMessage).toHaveBeenCalledTimes(1);
    });

    it("ligação desfeita depois da escolha: não envia", async () => {
      await db.query("DELETE FROM audio_library_agents WHERE audio_id = $1", [audioA.id]);
      expect(await sendAgentLibraryAudio(pedido())).toEqual({ sent: false, reason: "audio_nao_ligado_ao_agente" });
      expect(chamadas).toEqual([]);
    });

    it("agente virou 'campanha' depois da escolha: não envia", async () => {
      await db.query("UPDATE followup_companies SET agent_kind = 'campanha' WHERE id = $1", [AGENTE_A]);
      expect((await sendAgentLibraryAudio(pedido())).sent).toBe(false);
      expect(chamadas).toEqual([]);
    });

    it("isolamento: pedido com o tenant da B para o áudio da A não envia, mesmo com ligação forjada", async () => {
      await db.query(`INSERT INTO audio_library_agents (audio_id, company_id, client_id) VALUES ($1, $2, $3)`, [audioA.id, AGENTE_B, TENANT_B]);
      const res = await sendAgentLibraryAudio(pedido({ clientId: TENANT_B, companyId: AGENTE_B }));
      expect(res).toEqual({ sent: false, reason: "audio_nao_encontrado_nesta_empresa" });
      expect(chamadas).toEqual([]);
    });

    it("áudio arquivado depois da escolha: não envia", async () => {
      await db.query("UPDATE audio_library SET archived_at = now() WHERE id = $1", [audioA.id]);
      expect(await sendAgentLibraryAudio(pedido())).toEqual({ sent: false, reason: "audio_arquivado" });
      expect(chamadas).toEqual([]);
    });
  });

  describe("catálogo do agente (loadAgentAudioCatalog)", () => {
    it("agente de CAMPANHA não tem catálogo, mesmo com linha de ligação gravada por fora", async () => {
      await db.query(`INSERT INTO audio_library_agents (audio_id, company_id, client_id) VALUES ($1, $2, $3)`, [audioA.id, AGENTE_CAMPANHA_A, TENANT_A]);
      const catalog = await loadAgentAudioCatalog(pool, { clientId: TENANT_A, companyId: AGENTE_CAMPANHA_A });
      expect(catalog.entries).toEqual([]);
      expect(catalog.block).toBe("");
    });

    it("isolamento: áudio da empresa B não entra no catálogo do agente da empresa A, nem com ligação forjada", async () => {
      const audioB = await createAudio(pool, { clientId: TENANT_B, buffer: makeWav(), name: "Segredo da B", whenToUse: "Sempre" });
      // Ligações que a rota nunca gravaria, escritas direto no banco:
      await db.query(`INSERT INTO audio_library_agents (audio_id, company_id, client_id) VALUES ($1, $2, $3)`, [audioB.id, AGENTE_A, TENANT_A]);
      await db.query(`INSERT INTO audio_library_agents (audio_id, company_id, client_id) VALUES ($1, $2, $3)`, [audioB.id, AGENTE_B, TENANT_B]);

      const daA = await loadAgentAudioCatalog(pool, { clientId: TENANT_A, companyId: AGENTE_A });
      expect(daA.entries.map((e) => e.name)).toEqual(["Boas-vindas"]);
      expect(daA.block).not.toContain("Segredo da B");

      // Agente da B consultado com o tenant da A: nada.
      const cruzado = await loadAgentAudioCatalog(pool, { clientId: TENANT_A, companyId: AGENTE_B });
      expect(cruzado.entries).toEqual([]);
    });

    it("ao bater o máximo, o catálogo SAI do prompt inteiro (não é cortado pela metade)", async () => {
      for (let i = 0; i < AGENT_AUDIO_MAX_ITEMS; i += 1) {
        const extra = await createAudio(pool, { clientId: TENANT_A, buffer: makeWav({ seconds: 1 }), name: `Extra ${i}`, whenToUse: "x".repeat(140) });
        // Direto no banco: a rota de ligação recusaria o 11º.
        await db.query(`INSERT INTO audio_library_agents (audio_id, company_id, client_id) VALUES ($1, $2, $3)`, [extra.id, AGENTE_A, TENANT_A]);
      }
      const catalog = await loadAgentAudioCatalog(pool, { clientId: TENANT_A, companyId: AGENTE_A });
      expect(catalog).toEqual({ entries: [], block: "", reason: "catalogo_acima_do_maximo" });
    });

    it("no limite exato, o bloco cabe no teto de caracteres", async () => {
      for (let i = 0; i < AGENT_AUDIO_MAX_ITEMS - 1; i += 1) {
        const extra = await createAudio(pool, { clientId: TENANT_A, buffer: makeWav({ seconds: 1 }), name: `N${"o".repeat(77)}${i}`, whenToUse: "x".repeat(140) });
        await setAudioAgents(pool, { id: extra.id, clientId: TENANT_A, companyIds: [AGENTE_A] });
      }
      const catalog = await loadAgentAudioCatalog(pool, { clientId: TENANT_A, companyId: AGENTE_A });
      expect(catalog.entries).toHaveLength(AGENT_AUDIO_MAX_ITEMS);
      expect(catalog.reason).toBeNull();
      expect(catalog.block.length).toBeLessThanOrEqual(3200);
    });

    it("sem agente (chip no chatbot padrão) não há catálogo", async () => {
      expect((await loadAgentAudioCatalog(pool, { clientId: TENANT_A, companyId: null })).entries).toEqual([]);
    });
  });
});

function audioSemInstrucaoPlaceholder() {
  return "A2"; // existe na biblioteca, mas não está no catálogo (sem "quando usar", sem ligação)
}

describe("campo audio no JSON da resposta (parseAIResponse)", () => {
  const base = { mensagem: "Te mando um áudio.", status_conversa: "aguardando_usuario", dados: {} };

  it("sobrevive quando a resposta já vem como objeto e quando vem como texto com JSON", () => {
    expect(parseAIResponse({ ...base, audio: "A2" }).audio).toBe("A2");
    expect(parseAIResponse(JSON.stringify({ ...base, audio: " a3 " })).audio).toBe("A3");
    expect(parseAIResponse("```json\n" + JSON.stringify({ ...base, audio: "A1" }) + "\n```").audio).toBe("A1");
  });

  it("ausente, nulo ou lixo vira null", () => {
    expect(parseAIResponse({ ...base }).audio).toBeNull();
    expect(parseAIResponse({ ...base, audio: null }).audio).toBeNull();
    expect(parseAIResponse({ ...base, audio: "boas-vindas" }).audio).toBeNull();
    expect(parseAIResponse({ ...base, audio: 1 }).audio).toBeNull();
  });

  it("marcador de áudio no TEXTO nunca é lido como escolha (e a guarda de colchete continua valendo)", () => {
    const comMarcador = parseAIResponse({ ...base, mensagem: "[audio:A1] Olá" });
    expect(comMarcador.mensagem).toBe("");
    expect(comMarcador.contratoQuebrado).toBe(true);
    expect(comMarcador.audio).toBeUndefined();
  });

  it("normalizeAudioChoice só aceita A1..A99", () => {
    expect(["A1", "a10", "A99"].map(normalizeAudioChoice)).toEqual(["A1", "A10", "A99"]);
    expect(["A0", "A100", "B1", "A1 ", "", "A1\nA2"].map(normalizeAudioChoice)).toEqual([null, null, null, "A1", null, null]);
  });
});

describe("sendMediaMessageViaEvolution — tempo limite opcional", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sem timeoutMs (follow-up) a chamada sai SEM sinal de aborto; com timeoutMs, sai com", async () => {
    const chamadas = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      chamadas.push(init);
      return new Response(JSON.stringify({ key: { id: "x" } }), { status: 201 });
    }));
    const args = { instanceName: "chip", number: "5534999990000", mediaType: "audio", base64: "AAAA", webhookToken: "t", baseUrl: "https://evo.test" };

    await sendMediaMessageViaEvolution(args);
    expect(chamadas[0].signal).toBeUndefined();

    await sendMediaMessageViaEvolution({ ...args, timeoutMs: 20_000 });
    expect(chamadas[1].signal).toBeInstanceOf(AbortSignal);
  });

  it("estourou o tempo: a chamada é abortada e o erro sobe", async () => {
    vi.stubGlobal("fetch", vi.fn((url, init) => new Promise((_ok, fail) => {
      init.signal.addEventListener("abort", () => fail(init.signal.reason));
    })));
    await expect(
      sendMediaMessageViaEvolution({ instanceName: "chip", number: "5534999990000", mediaType: "audio", base64: "AAAA", webhookToken: "t", baseUrl: "https://evo.test", timeoutMs: 30 })
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
