// Custo de IA por cliente: cada chamada que deu certo vira uma linha em
// public.llm_usage, e a gravacao NUNCA derruba a resposta ao lead.
//
// Dubles so no que sai do processo: o fetch para os provedores e a gravacao no
// banco (gravarUsoLlm). A gravacao de verdade e testada em Postgres real
// (pglite) no fim do arquivo, com a migration de producao.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../services/llmUsage.js", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, gravarUsoLlm: vi.fn(async () => {}) };
});

const { gravarUsoLlm } = await import("../services/llmUsage.js");
const { callLlmChatCompletion, runChatbotAI } = await import("../chatbot-ai-engine.js");
const real = await vi.importActual("../services/llmUsage.js");
const { createPgliteDb } = await import("./helpers/pgliteDb.js");

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "supabase",
  "migrations",
  "20261030120000_create_llm_usage.sql"
);

const CHAVES_DE_AMBIENTE = [
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "LLM_MODEL_LADDER",
  "GROQ_MODEL_LADDER",
  "GROQ_CAMPAIGN_AI_MODEL",
];
let ambienteSalvo;
let fetchSpy;
let chamadas;
const OI = [{ role: "user", content: "oi" }];

function okOpenAi(content, usage = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content }, finish_reason: "stop" }], usage }),
  };
}
function falha(status, corpo = "erro") {
  return { ok: false, status, text: async () => corpo };
}
function provedores(respostas) {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(init.body);
    chamadas.push(body.model);
    return respostas[body.model] || falha(500, "Internal Error");
  });
}
function ultimaGravacao() {
  return gravarUsoLlm.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  ambienteSalvo = Object.fromEntries(CHAVES_DE_AMBIENTE.map((k) => [k, process.env[k]]));
  for (const k of CHAVES_DE_AMBIENTE) delete process.env[k];
  process.env.GROQ_API_KEY = "gsk_chave_de_teste";
  process.env.GEMINI_API_KEY = "gemini_chave_de_teste";
  process.env.LLM_MODEL_LADDER = "gemini-flash-latest,gemini-flash-lite-latest,openai/gpt-oss-120b";
  chamadas = [];
  gravarUsoLlm.mockReset();
  gravarUsoLlm.mockImplementation(async () => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  if (fetchSpy) fetchSpy.mockRestore();
  fetchSpy = null;
  vi.restoreAllMocks();
  for (const k of CHAVES_DE_AMBIENTE) {
    if (ambienteSalvo[k] === undefined) delete process.env[k];
    else process.env[k] = ambienteSalvo[k];
  }
});

describe("usage capturado em cada provedor", () => {
  it.each([
    ["gemini", "gemini-flash-latest", "GEMINI_API_KEY"],
    ["groq", "openai/gpt-oss-120b", "GROQ_API_KEY"],
    ["openai", "gpt-4o-mini", "OPENAI_API_KEY"],
  ])("%s: tokens e finish_reason da resposta chegam a gravacao", async (provider, model, chave) => {
    process.env[chave] = "chave_de_teste";
    provedores({ [model]: okOpenAi("ok", { prompt_tokens: 900, completion_tokens: 45, total_tokens: 945 }) });

    await callLlmChatCompletion({ model, messages: OI, singleModelOnly: true });

    expect(ultimaGravacao()).toMatchObject({
      provider,
      model,
      promptTokens: 900,
      completionTokens: 45,
      totalTokens: 945,
      finishReason: "stop",
      tentativas: 1,
    });
    expect(typeof ultimaGravacao().latencyMs).toBe("number");
  });

  it("anthropic: input/output tokens viram prompt/completion, total e a soma", async () => {
    process.env.ANTHROPIC_API_KEY = "chave_de_teste";
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 700, output_tokens: 20 },
      }),
    }));

    await callLlmChatCompletion({ model: "claude-3-5-haiku-20241022", messages: OI, singleModelOnly: true });

    expect(ultimaGravacao()).toMatchObject({
      provider: "anthropic",
      promptTokens: 700,
      completionTokens: 20,
      totalTokens: 720,
      finishReason: "end_turn",
    });
  });

  it("nao grava texto do prompt nem da resposta", async () => {
    provedores({ "gemini-flash-latest": okOpenAi("RESPOSTA-SECRETA") });
    await callLlmChatCompletion({ model: "gemini-flash-latest", messages: [{ role: "user", content: "PROMPT-SECRETO" }] });
    const gravado = JSON.stringify(ultimaGravacao());
    expect(gravado).not.toContain("PROMPT-SECRETO");
    expect(gravado).not.toContain("RESPOSTA-SECRETA");
  });
});

describe("dono da chamada", () => {
  it("com contexto, grava clientId, origem e phone", async () => {
    provedores({ "gemini-flash-latest": okOpenAi("ok") });
    await callLlmChatCompletion({
      model: "gemini-flash-latest",
      messages: OI,
      contexto: { clientId: "container-led", origem: "chatbot", phone: "5511999990000" },
    });
    expect(ultimaGravacao()).toMatchObject({ clientId: "container-led", origem: "chatbot", phone: "5511999990000" });
  });

  it("sem contexto, grava com dono nulo — e ainda grava", async () => {
    provedores({ "gemini-flash-latest": okOpenAi("ok") });
    await callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI });
    expect(gravarUsoLlm).toHaveBeenCalledTimes(1);
    expect(ultimaGravacao()).toMatchObject({ clientId: null, origem: null, phone: null });
  });

  it("degrau que falhou nao vira linha: so a tentativa que deu certo e gravada", async () => {
    provedores({
      "gemini-flash-latest": falha(503),
      "gemini-flash-lite-latest": falha(404, "model not found"),
      "openai/gpt-oss-120b": okOpenAi("ok"),
    });
    await callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI });
    expect(gravarUsoLlm).toHaveBeenCalledTimes(1);
    expect(ultimaGravacao().model).toBe("openai/gpt-oss-120b");
  });
});

describe("tentativas conta os degraus queimados", () => {
  it("dois degraus queimados e o terceiro acerta: tentativas = 3", async () => {
    provedores({
      "gemini-flash-latest": falha(503),
      "gemini-flash-lite-latest": falha(404, "model not found"),
      "openai/gpt-oss-120b": okOpenAi("ok"),
    });
    await callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI });
    expect(ultimaGravacao().tentativas).toBe(3);
  });

  it("413 que descarta degraus do mesmo provedor conta so as chamadas feitas", async () => {
    process.env.LLM_MODEL_LADDER = "openai/gpt-oss-120b,openai/gpt-oss-20b,gemini-flash-latest";
    provedores({
      "openai/gpt-oss-120b": falha(413, "Request too large: Limit 8000, Requested 9431"),
      "gemini-flash-latest": okOpenAi("ok"),
    });
    await callLlmChatCompletion({ model: "openai/gpt-oss-120b", messages: OI });
    expect(chamadas).toEqual(["openai/gpt-oss-120b", "gemini-flash-latest"]);
    expect(ultimaGravacao().tentativas).toBe(2);
  });

  it("runChatbotAI: a escada de fora soma no contador e o contexto chega a gravacao", async () => {
    const valido = JSON.stringify({ mensagem: "Olá!", status_conversa: "aguardando_usuario", dados: {} });
    provedores({
      "gemini-flash-latest": falha(503),
      "gemini-flash-lite-latest": okOpenAi('{"lixo": true'),
      "openai/gpt-oss-120b": okOpenAi(valido),
    });

    const res = await runChatbotAI({
      systemPrompt: "Você é a assistente virtual.",
      history: [],
      newMessages: ["Olá"],
      existingData: {},
      llmModel: "gemini-flash-latest",
      contexto: { clientId: "container-led", origem: "chatbot", phone: "5511999990000" },
    });

    expect(res.mensagem).toBe("Olá!");
    // O lite respondeu 200 com JSON quebrado: consumiu token, entao vira linha.
    expect(gravarUsoLlm.mock.calls.map((c) => [c[0].model, c[0].tentativas])).toEqual([
      ["gemini-flash-lite-latest", 2],
      ["openai/gpt-oss-120b", 3],
    ]);
    expect(ultimaGravacao()).toMatchObject({ clientId: "container-led", origem: "chatbot" });
  });
});

describe("falha na gravacao NAO derruba a resposta", () => {
  it("gravacao que lanca na hora (sincrono): resposta sai igual", async () => {
    gravarUsoLlm.mockImplementation(() => {
      throw new Error('relation "public.llm_usage" does not exist');
    });
    provedores({ "gemini-flash-latest": okOpenAi("resposta ao lead") });

    await expect(callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI })).resolves.toBe(
      "resposta ao lead"
    );
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[llm-usage]"), expect.anything());
  });

  it("gravacao que rejeita depois (banco fora): resposta sai igual, sem rejeicao solta", async () => {
    gravarUsoLlm.mockImplementation(async () => {
      throw new Error("connection terminated unexpectedly");
    });
    provedores({ "gemini-flash-latest": okOpenAi("resposta ao lead") });

    await expect(callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI })).resolves.toBe(
      "resposta ao lead"
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[llm-usage]"), expect.anything());
  });

  it("runChatbotAI com a gravacao quebrada responde o lead normalmente", async () => {
    gravarUsoLlm.mockImplementation(() => {
      throw new Error('relation "public.llm_usage" does not exist');
    });
    const valido = JSON.stringify({ mensagem: "Olá!", status_conversa: "aguardando_usuario", dados: {} });
    provedores({ "gemini-flash-latest": okOpenAi(valido) });

    const res = await runChatbotAI({
      systemPrompt: "Você é a assistente virtual.",
      history: [],
      newMessages: ["Olá"],
      existingData: {},
      llmModel: "gemini-flash-latest",
      contexto: { clientId: "container-led", origem: "chatbot", phone: "5511999990000" },
    });

    expect(res.mensagem).toBe("Olá!");
    expect(res.contratoQuebrado).toBeFalsy();
  });
});

describe("gravacao em Postgres real, com a migration de producao", () => {
  it("migration e idempotente e a linha gravada tem so fato do evento", async () => {
    const db = await createPgliteDb();
    try {
      const sql = await readFile(MIGRATION, "utf8");
      await db.exec(sql);
      await db.exec(sql);

      const pool = { query: (texto, params) => db.query(texto, params) };
      await real.gravarUsoLlm(
        {
          clientId: "container-led",
          origem: "chatbot",
          phone: "5511999990000",
          provider: "gemini",
          model: "gemini-flash-latest",
          promptTokens: 900,
          completionTokens: 45.4,
          totalTokens: 945,
          finishReason: "stop",
          latencyMs: 812,
          tentativas: 1,
        },
        { pool }
      );
      await real.gravarUsoLlm({ provider: "groq", model: "openai/gpt-oss-120b" }, { pool });

      const { rows } = await db.query(
        "SELECT client_id, origem, provider, model, prompt_tokens, completion_tokens, total_tokens, tentativas, created_at FROM public.llm_usage ORDER BY total_tokens NULLS LAST"
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        client_id: "container-led",
        origem: "chatbot",
        provider: "gemini",
        prompt_tokens: 900,
        completion_tokens: 45,
        total_tokens: 945,
        tentativas: 1,
      });
      expect(rows[0].created_at).toBeInstanceOf(Date);
      expect(rows[1]).toMatchObject({ client_id: null, origem: null, prompt_tokens: null });

      const colunas = await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2",
        ["public", "llm_usage"]
      );
      const nomes = colunas.rows.map((r) => r.column_name);
      expect(nomes).not.toContain("cost");
      expect(nomes.some((n) => /prompt_text|response|content|custo|cost/.test(n))).toBe(false);
    } finally {
      await db.close();
    }
  });

  it("sem pool (sem banco), gravar nao faz nada e nao lanca", async () => {
    await expect(real.gravarUsoLlm({ provider: "groq", model: "x" }, { pool: null })).resolves.toBeUndefined();
  });
});
