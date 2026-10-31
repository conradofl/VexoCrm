// Chave de IA quebrada nao pode ficar escondida na tela.
//
// Antes deste commit: se a chave do Gemini quebrasse e a Groq respondesse, a
// tela nao mostrava nada; se a escada inteira falhasse, o simulador dizia
// "Prompt não configurado" — processBatch devolve null e a causa se perdia.
// Agora a causa chega: aviso na resposta que saiu, codigo proprio na que nao saiu.
//
// Duble so no que sai do processo: fetch para os provedores e o banco.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const chatSearchMock = { findRagContextForQuestion: vi.fn() };
vi.mock("../rag/chatSearch.js", async () => {
  const actual = await vi.importActual("../rag/chatSearch.js");
  return { ...actual, findRagContextForQuestion: (...args) => chatSearchMock.findRagContextForQuestion(...args) };
});
vi.mock("../services/llmUsage.js", async (importOriginal) => ({ ...(await importOriginal()), gravarUsoLlm: vi.fn(async () => {}) }));

const { processBatch, runChatbotAI } = await import("../chatbot-ai-engine.js");
const n8nSettingsService = await import("../services/n8nSettings.js");

const CHAVES_DE_AMBIENTE = ["GROQ_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "LLM_MODEL_LADDER", "GROQ_CAMPAIGN_AI_MODEL"];
const CHAVE_INVALIDA_GEMINI = '[{"error":{"code":400,"message":"Please pass a valid API key","status":"INVALID_ARGUMENT"}}]';
const COTA = "Rate limit reached on tokens per minute (TPM): Limit 8000, Used 8000";
const VALIDO = JSON.stringify({ mensagem: "Olá! Como posso ajudar?", status_conversa: "aguardando_usuario", dados: {} });

let ambienteSalvo;
let originalFetch;

function provedores(respostas) {
  global.fetch = vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    const r = respostas[body.model];
    if (r?.ok === false) return { ok: false, status: r.status, text: async () => r.corpo };
    if (r) return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: r } }] }) };
    return { ok: false, status: 500, text: async () => "Internal Error" };
  });
}

function makeSupabase() {
  const updates = [];
  const inserts = [];
  const api = {
    updates,
    inserts,
    from: (table) => {
      if (table === "chatbot_prompts" || table === "lead_client_prompts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: { content: "Você é um assistente da Empresa Solar ABC.", prompt: "Você é um assistente da Empresa Solar ABC." } }),
                maybeSingle: () => Promise.resolve({ data: { content: "Você é um assistente da Empresa Solar ABC.", prompt: "Você é um assistente da Empresa Solar ABC." } }),
              }),
            }),
          }),
        };
      }
      if (table === "chatbot_templates") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: null }),
                maybeSingle: () => Promise.resolve({ data: null }),
              }),
            }),
          }),
        };
      }
      if (table === "lead_messages") {
        return { insert: (payload) => { inserts.push(payload); return Promise.resolve({ error: null }); } };
      }
      return api;
    },
    select: () => api,
    order: () => api,
    limit: () => Promise.resolve({ data: [] }), // sem lead existente: fluxo normal, sem recontato
    insert: (payload) => { inserts.push(payload); return Promise.resolve({ error: null }); },
    update: (payload) => {
      updates.push(payload);
      const chain = { eq: () => chain, then: (resolve) => resolve({ error: null }) };
      return chain;
    },
    eq: () => api,
    maybeSingle: () => Promise.resolve({ data: null }),
    single: () => Promise.resolve({ data: null }),
  };
  return api;
}

beforeEach(() => {
  ambienteSalvo = Object.fromEntries(CHAVES_DE_AMBIENTE.map((k) => [k, process.env[k]]));
  for (const k of CHAVES_DE_AMBIENTE) delete process.env[k];
  process.env.GROQ_API_KEY = "gsk_chave_de_teste";
  process.env.GEMINI_API_KEY = "gemini_chave_de_teste";
  process.env.LLM_MODEL_LADDER = "gemini-flash-latest,gemini-flash-lite-latest,openai/gpt-oss-120b";
  originalFetch = global.fetch;
  chatSearchMock.findRagContextForQuestion.mockResolvedValue({ applies: false, chunks: [], needsReindexDocumentIds: [] });
  vi.spyOn(n8nSettingsService, "getLeadClientN8nSettings").mockResolvedValue({});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  for (const k of CHAVES_DE_AMBIENTE) {
    if (ambienteSalvo[k] === undefined) delete process.env[k];
    else process.env[k] = ambienteSalvo[k];
  }
});

const turno = (extra = {}) => ({
  clientId: "geracao-digital",
  phone: "5534999991234",
  messages: [{ text: "Oi" }],
  supabase: makeSupabase(),
  model: "padrao",
  llmModel: "gemini-flash-latest",
  isSimulation: true,
  noPersist: true,
  ...extra,
});

describe("resposta que saiu de outro provedor carrega a chave quebrada", () => {
  it("Gemini com chave invalida, Groq responde: resultado traz _credenciaisQuebradas", async () => {
    provedores({ "gemini-flash-latest": { ok: false, status: 400, corpo: CHAVE_INVALIDA_GEMINI }, "openai/gpt-oss-120b": VALIDO });

    const result = await processBatch(turno());

    expect(result.mensagem).toBe("Olá! Como posso ajudar?");
    expect(result._credenciaisQuebradas).toEqual(["gemini"]);
  });

  it("sem chave quebrada, nada de aviso", async () => {
    provedores({ "gemini-flash-latest": VALIDO });
    const result = await processBatch(turno());
    expect(result._credenciaisQuebradas).toBeUndefined();
  });
});

describe("turno que falhou inteiro diz a causa", () => {
  it("credencial quebrada + resto em cota: processBatch devolve null e o diagnostico e credencial, nao cota", async () => {
    provedores({
      "gemini-flash-latest": { ok: false, status: 400, corpo: CHAVE_INVALIDA_GEMINI },
      "openai/gpt-oss-120b": { ok: false, status: 429, corpo: COTA },
    });
    const diagnosticoIa = {};

    const result = await processBatch(turno({ diagnosticoIa }));

    expect(result).toBeNull();
    expect(diagnosticoIa.code).toBe("LLM_CREDENTIAL_INVALID");
    expect(diagnosticoIa.provedores).toEqual(["gemini"]);
    expect(diagnosticoIa.mensagem).toMatch(/credencial invalida no provedor gemini/i);
  });

  it("so cota: o diagnostico e cota, com o modelo", async () => {
    process.env.LLM_MODEL_LADDER = "openai/gpt-oss-120b";
    provedores({ "openai/gpt-oss-120b": { ok: false, status: 429, corpo: COTA } });
    const diagnosticoIa = {};

    const result = await processBatch(turno({ diagnosticoIa, llmModel: "openai/gpt-oss-120b" }));

    expect(result).toBeNull();
    expect(diagnosticoIa.code).toBe("LLM_QUOTA_EXCEEDED");
    expect(diagnosticoIa.modelo).toBe("openai/gpt-oss-120b");
  });

  it("quem nao passa diagnosticoIa continua recebendo null, como sempre", async () => {
    provedores({});
    await expect(processBatch(turno())).resolves.toBeNull();
  });

  it("runChatbotAI: falha sem causa conhecida nao inventa diagnostico", async () => {
    provedores({});
    const res = await runChatbotAI({ systemPrompt: "x", history: [], newMessages: ["oi"], existingData: {}, llmModel: "gemini-flash-latest" });
    expect(res.mensagem).toBe("");
    expect(res.falhaIa).toBeNull();
  });
});
