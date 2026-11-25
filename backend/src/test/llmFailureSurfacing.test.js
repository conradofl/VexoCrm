// Chave de IA quebrada nao pode ficar escondida na tela (PR #179 trazido para o main em 21/11/2026).
//
// O main ja carregava a credencial quebrada quando a escada falhava inteira
// (_credencialInvalida no retorno do simulador). Faltava o outro caso: a chave do
// Gemini quebra, a Groq responde, e a tela nao mostrava nada. Agora a resposta que
// saiu leva a lista dos provedores com chave quebrada.
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
      const chain = { eq: () => chain, in: () => chain, then: (resolve) => resolve({ error: null }) };
      return chain;
    },
    eq: () => api, in: () => api,
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
  it("Gemini com chave invalida, Groq responde: resultado traz _credencialInvalida", async () => {
    provedores({ "gemini-flash-latest": { ok: false, status: 400, corpo: CHAVE_INVALIDA_GEMINI }, "openai/gpt-oss-120b": VALIDO });

    const result = await processBatch(turno());

    expect(result.mensagem).toBe("Olá! Como posso ajudar?");
    expect(result._credencialInvalida).toEqual(["gemini"]);
  });

  it("sem chave quebrada, nada de aviso", async () => {
    provedores({ "gemini-flash-latest": VALIDO });
    const result = await processBatch(turno());
    expect(result.mensagem).toBe("Olá! Como posso ajudar?");
    expect(result._credencialInvalida).toBeUndefined();
  });
});

describe("turno que falhou inteiro diz a causa", () => {
  it("credencial quebrada + resto em cota: o simulador recebe a credencial, nao so a cota", async () => {
    provedores({
      "gemini-flash-latest": { ok: false, status: 400, corpo: CHAVE_INVALIDA_GEMINI },
      "openai/gpt-oss-120b": { ok: false, status: 429, corpo: COTA },
    });

    const result = await processBatch(turno());

    expect(result.mensagem).toBe("");
    expect(result._credencialInvalida).toEqual(["gemini"]);
  });

  it("so cota: sem credencial quebrada, a causa vem no detalhe", async () => {
    process.env.LLM_MODEL_LADDER = "openai/gpt-oss-120b";
    provedores({ "openai/gpt-oss-120b": { ok: false, status: 429, corpo: COTA } });

    const result = await processBatch(turno({ llmModel: "openai/gpt-oss-120b" }));

    expect(result.mensagem).toBe("");
    expect(result._credencialInvalida).toBeNull();
    expect(String(result._falhaDetalhe)).toMatch(/TPM|cota|rate limit/i);
  });

  it("fora do simulador o turno que falhou continua devolvendo null e marca o motivo", async () => {
    provedores({});
    const diagnostico = {};
    await expect(processBatch(turno({ isSimulation: false, noPersist: true, diagnostico }))).resolves.toBeNull();
    expect(["falha_ia", "resposta_vazia"]).toContain(diagnostico.motivo);
  });

  it("runChatbotAI: falha sem credencial quebrada nao inventa provedor", async () => {
    provedores({});
    const res = await runChatbotAI({ systemPrompt: "x", history: [], newMessages: ["oi"], existingData: {}, llmModel: "gemini-flash-latest" });
    expect(res.mensagem).toBe("");
    expect(res._credencialInvalida).toBeNull();
  });
});
