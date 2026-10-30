// A escada deixou de ser "da Groq".
//
// 30/10/2026: o agente da Container Led emudeceu. Os tres modelos vivos da Groq
// tomaram 413 e o fallback para o Gemini era uma chamada avulsa, para um modelo
// ja descontinuado. O Gemini nao tinha rede: um 429 ou 503 do Google e o
// agente ficaria mudo do mesmo jeito. Agora cada degrau e roteado pelo provedor
// do proprio id, e o laco e o mesmo para todos.
//
// Dubles so no que sai do processo: o fetch para os provedores.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { callLlmChatCompletion, runChatbotAI } from "../chatbot-ai-engine.js";

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

function ok(content) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
}
function falha(status, corpo) {
  return { ok: false, status, text: async () => corpo };
}
function provedorDaUrl(url) {
  const u = String(url);
  if (u.includes("api.groq.com")) return "groq";
  if (u.includes("generativelanguage.googleapis.com")) return "gemini";
  if (u.includes("api.openai.com")) return "openai";
  if (u.includes("api.anthropic.com")) return "anthropic";
  return "?";
}

/** respostas: { [modelo]: resposta | (() => Promise) } — o resto devolve 500. */
function provedores(respostas) {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const body = JSON.parse(init.body);
    chamadas.push({ provedor: provedorDaUrl(url), modelo: body.model });
    const r = respostas[body.model];
    if (typeof r === "function") return r();
    return r || falha(500, "Internal Error");
  });
}

beforeEach(() => {
  ambienteSalvo = Object.fromEntries(CHAVES_DE_AMBIENTE.map((k) => [k, process.env[k]]));
  for (const k of CHAVES_DE_AMBIENTE) delete process.env[k];
  process.env.GROQ_API_KEY = "gsk_chave_de_teste";
  process.env.GEMINI_API_KEY = "gemini_chave_de_teste";
  process.env.LLM_MODEL_LADDER = "gemini-flash-latest,gemini-flash-lite-latest,openai/gpt-oss-120b";
  chamadas = [];
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

describe("cada degrau vai para o provedor do proprio id", () => {
  it("id do Gemini vai para o Google, id da Groq vai para a Groq", async () => {
    provedores({
      "gemini-flash-latest": falha(503, "overloaded"),
      "gemini-flash-lite-latest": falha(503, "overloaded"),
      "openai/gpt-oss-120b": ok("resposta da groq"),
    });

    const res = await callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI });

    expect(res).toBe("resposta da groq");
    expect(chamadas).toEqual([
      { provedor: "gemini", modelo: "gemini-flash-latest" },
      { provedor: "gemini", modelo: "gemini-flash-lite-latest" },
      { provedor: "groq", modelo: "openai/gpt-oss-120b" },
    ]);
  });
});

describe("o Gemini tem rede", () => {
  it("503 do Google segue para o proximo degrau em vez de emudecer", async () => {
    provedores({
      "gemini-flash-latest": falha(503, "The model is overloaded"),
      "gemini-flash-lite-latest": ok("resposta do lite"),
    });

    await expect(callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI })).resolves.toBe(
      "resposta do lite"
    );
  });

  it("429 do Google segue para o proximo degrau", async () => {
    provedores({
      "gemini-flash-latest": falha(429, '{"error":{"status":"RESOURCE_EXHAUSTED"}}'),
      "gemini-flash-lite-latest": ok("resposta do lite"),
    });

    await expect(callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI })).resolves.toBe(
      "resposta do lite"
    );
  });

  it("provedor que nao responde (timeout) nao segura a escada", async () => {
    provedores({
      "gemini-flash-latest": () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
      "gemini-flash-lite-latest": ok("resposta do lite"),
    });

    await expect(callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI })).resolves.toBe(
      "resposta do lite"
    );
  });

  it("toda chamada leva um sinal de timeout", async () => {
    provedores({ "gemini-flash-latest": ok("x") });
    await callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI });
    expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("credencial quebrada nao vira silencio", () => {
  const CHAVE_INVALIDA_GEMINI = '[{"error":{"code":400,"message":"Please pass a valid API key","status":"INVALID_ARGUMENT"}}]';

  it("chave invalida descarta o provedor inteiro e segue para o proximo", async () => {
    const erroLog = vi.spyOn(console, "error").mockImplementation(() => {});
    provedores({
      "gemini-flash-latest": falha(400, CHAVE_INVALIDA_GEMINI),
      "openai/gpt-oss-120b": ok("resposta da groq"),
    });

    const res = await callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI });

    expect(res).toBe("resposta da groq");
    // O segundo id do Gemini nem e tentado: a chave e a mesma.
    expect(chamadas.map((c) => c.modelo)).toEqual(["gemini-flash-latest", "openai/gpt-oss-120b"]);
    expect(erroLog.mock.calls.flat().join(" ")).toMatch(/CREDENCIAL INVALIDA no provedor "gemini"/);
  });

  it("se o resto da escada falha por cota, o erro final nomeia a credencial, nao a cota", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    provedores({
      "gemini-flash-latest": falha(400, CHAVE_INVALIDA_GEMINI),
      "openai/gpt-oss-120b": falha(429, "Rate limit reached on tokens per minute (TPM): Limit 8000, Used 8000"),
    });

    const erro = await callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI }).catch((e) => e);

    expect(erro.code).toBe("LLM_CREDENTIAL_INVALID");
    expect(erro.message).toMatch(/credencial invalida no provedor gemini/i);
    expect(erro.message).not.toMatch(/A cota de IA/);
  });

  it("runChatbotAI nomeia a credencial no log final quando a escada inteira falha", async () => {
    const erroLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    provedores({
      "gemini-flash-latest": falha(400, CHAVE_INVALIDA_GEMINI),
      "openai/gpt-oss-120b": falha(429, "Rate limit reached on tokens per minute (TPM): Limit 8000, Used 8000"),
    });

    const res = await runChatbotAI({
      systemPrompt: "Você é a assistente virtual.",
      history: [],
      newMessages: ["Olá"],
      existingData: {},
      llmModel: "gemini-flash-latest",
    });

    expect(res.mensagem).toBe("");
    const final = erroLog.mock.calls.find((c) => String(c[0]).includes("TODOS OS MODELOS DA ESCADA FALHARAM"));
    expect(final?.[1]?.credencialInvalida).toMatch(/credencial invalida no provedor gemini/);
    // O laco externo nao insiste no outro id do Gemini depois da chave quebrada.
    expect(chamadas.map((c) => c.modelo)).not.toContain("gemini-flash-lite-latest");
  });
});

describe("provedor sem chave sai da escada, com aviso", () => {
  it("sem chave do Gemini, nenhuma chamada vai ao Google e a Groq atende", async () => {
    delete process.env.GEMINI_API_KEY;
    provedores({ "openai/gpt-oss-120b": ok("resposta da groq") });

    const res = await callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI });

    expect(res).toBe("resposta da groq");
    expect(chamadas.every((c) => c.provedor === "groq")).toBe(true);
  });

  it("sem chave nenhuma, falha com erro explicito em vez de devolver vazio", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
    provedores({});

    await expect(callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI })).rejects.toThrow(
      /nenhum modelo utilizavel/i
    );
    expect(chamadas).toEqual([]);
  });
});

describe("413 nao e cota acabando", () => {
  it("a mensagem final diz que o pedido e maior que o teto, nao que a cota acabou", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.LLM_MODEL_LADDER = "openai/gpt-oss-120b,openai/gpt-oss-20b";
    provedores({
      "openai/gpt-oss-120b": falha(413, "Request too large on tokens per minute (TPM): Limit 8000, Requested 9431"),
    });

    const erro = await callLlmChatCompletion({ model: "openai/gpt-oss-120b", messages: OI }).catch((e) => e);

    // O code fica o mesmo para a tela continuar funcionando; a frase deixa de mentir.
    expect(erro.code).toBe("LLM_QUOTA_EXCEEDED");
    expect(erro.message).toMatch(/o pedido e maior que o teto do modelo openai\/gpt-oss-120b \(limite 8\.000 tokens\)/i);
    expect(erro.message).not.toMatch(/cota de IA .* acabou/i);
  });
});

describe("singleModelOnly faz uma chamada so", () => {
  it("nao dispara fallback cruzado escondido", async () => {
    provedores({ "openai/gpt-oss-120b": falha(413, "Request too large: Limit 8000, Requested 9431") });

    await expect(
      callLlmChatCompletion({ model: "openai/gpt-oss-120b", messages: OI, singleModelOnly: true })
    ).rejects.toMatchObject({ code: "LLM_QUOTA_EXCEEDED" });
    expect(chamadas).toHaveLength(1);
  });
});
