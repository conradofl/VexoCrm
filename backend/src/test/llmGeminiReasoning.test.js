// reasoning_effort do Gemini e por modelo, aprendido — nunca lista escrita a mao.
//
// Medido em 30/10/2026 no endpoint compativel com OpenAI:
//   gemini-flash-latest       padrao 200  3027ms  total 129
//   gemini-flash-latest       none   200  1693ms  total 18
//   gemini-flash-lite-latest  padrao 200   899ms  total 18
//   gemini-flash-lite-latest  none   400  INVALID_ARGUMENT
// E chave invalida TAMBEM volta 400 INVALID_ARGUMENT.
//
// Duble so no fetch para o Google.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { callLlmChatCompletion, _resetGeminiSemReasoningForTest } from "../chatbot-ai-engine.js";

const CHAVES_DE_AMBIENTE = [
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "LLM_MODEL_LADDER",
  "GROQ_CAMPAIGN_AI_MODEL",
  "GEMINI_REASONING_EFFORT",
];
const OI = [{ role: "user", content: "oi" }];
const PARAMETRO_RECUSADO = '[{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}]';
const CHAVE_INVALIDA = '[{"error":{"code":400,"message":"Please pass a valid API key","status":"INVALID_ARGUMENT"}}]';

let ambienteSalvo;
let fetchSpy;
let corpos;

function ok(content = "ok") {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content }, finish_reason: "stop" }] }) };
}
function falha(status, corpo) {
  return { ok: false, status, text: async () => corpo };
}
/** responder(body) decide a resposta olhando o corpo enviado. */
function google(responder) {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const body = JSON.parse(init.body);
    corpos.push({ url: String(url), ...body });
    return responder(body);
  });
}
const lite = (body) =>
  body.model === "gemini-flash-lite-latest" && "reasoning_effort" in body ? falha(400, PARAMETRO_RECUSADO) : ok();

beforeEach(() => {
  ambienteSalvo = Object.fromEntries(CHAVES_DE_AMBIENTE.map((k) => [k, process.env[k]]));
  for (const k of CHAVES_DE_AMBIENTE) delete process.env[k];
  process.env.GEMINI_API_KEY = "gemini_chave_de_teste";
  process.env.GROQ_API_KEY = "gsk_chave_de_teste";
  process.env.LLM_MODEL_LADDER = "gemini-flash-latest,gemini-flash-lite-latest,openai/gpt-oss-120b";
  _resetGeminiSemReasoningForTest();
  corpos = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
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

describe("o flash recebe reasoning_effort", () => {
  it("padrao e none", async () => {
    google(() => ok());
    await callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI, singleModelOnly: true });
    expect(corpos).toHaveLength(1);
    expect(corpos[0].reasoning_effort).toBe("none");
  });

  it("GEMINI_REASONING_EFFORT muda a politica sem deploy", async () => {
    process.env.GEMINI_REASONING_EFFORT = "low";
    google(() => ok());
    await callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI, singleModelOnly: true });
    expect(corpos[0].reasoning_effort).toBe("low");
  });

  it("GEMINI_REASONING_EFFORT vazio: nunca manda o parametro", async () => {
    process.env.GEMINI_REASONING_EFFORT = "";
    google(() => ok());
    await callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI, singleModelOnly: true });
    expect("reasoning_effort" in corpos[0]).toBe(false);
  });
});

describe("modelo que recusa o parametro e aprendido", () => {
  it("lite: 400 com o parametro, repete sem, responde 200", async () => {
    google(lite);
    const res = await callLlmChatCompletion({ model: "gemini-flash-lite-latest", messages: OI, singleModelOnly: true });
    expect(res).toBe("ok");
    expect(corpos.map((c) => "reasoning_effort" in c)).toEqual([true, false]);
  });

  it("depois de aprender, a chamada seguinte ja sai sem o parametro — sem 400 de novo", async () => {
    google(lite);
    await callLlmChatCompletion({ model: "gemini-flash-lite-latest", messages: OI, singleModelOnly: true });
    corpos = [];
    await callLlmChatCompletion({ model: "gemini-flash-lite-latest", messages: OI, singleModelOnly: true });
    expect(corpos).toHaveLength(1);
    expect("reasoning_effort" in corpos[0]).toBe(false);
  });

  it("aprender o lite nao tira o parametro do flash", async () => {
    google(lite);
    await callLlmChatCompletion({ model: "gemini-flash-lite-latest", messages: OI, singleModelOnly: true });
    corpos = [];
    await callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI, singleModelOnly: true });
    expect(corpos[0].reasoning_effort).toBe("none");
  });

  it("para a escada o degrau e uma tentativa so: o proximo degrau nao e chamado", async () => {
    google(lite);
    process.env.LLM_MODEL_LADDER = "gemini-flash-lite-latest,openai/gpt-oss-120b";
    await callLlmChatCompletion({ model: "gemini-flash-lite-latest", messages: OI });
    expect(corpos.every((c) => c.model === "gemini-flash-lite-latest")).toBe(true);
  });
});

describe("so aprende quando a repeticao sem o parametro da certo", () => {
  it("repeticao que tambem falha: nada lembrado, a proxima chamada tenta com o parametro de novo", async () => {
    google(() => falha(400, PARAMETRO_RECUSADO));
    await callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI, singleModelOnly: true }).catch(() => {});
    expect(corpos.map((c) => "reasoning_effort" in c)).toEqual([true, false]);

    corpos = [];
    fetchSpy.mockRestore();
    google(() => ok());
    await callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI, singleModelOnly: true });
    expect(corpos[0].reasoning_effort).toBe("none");
  });
});

describe("chave invalida nao vira 'modelo recusou o parametro'", () => {
  it("400 INVALID_ARGUMENT de chave: nao repete, vira credencial e o provedor sai da escada", async () => {
    google((body) => (body.model.startsWith("gemini") ? falha(400, CHAVE_INVALIDA) : ok("groq")));

    const res = await callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI });

    expect(res).toBe("groq");
    const doGoogle = corpos.filter((c) => c.url.includes("generativelanguage"));
    expect(doGoogle).toHaveLength(1);
    expect(console.error.mock.calls.flat().join(" ")).toMatch(/CREDENCIAL INVALIDA no provedor "gemini"/);
  });

  it("depois de uma chave invalida, o modelo NAO foi marcado como sem reasoning", async () => {
    google((body) => (body.model.startsWith("gemini") ? falha(400, CHAVE_INVALIDA) : ok("groq")));
    await callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI });

    corpos = [];
    fetchSpy.mockRestore();
    google(() => ok());
    await callLlmChatCompletion({ model: "gemini-flash-latest", messages: OI, singleModelOnly: true });
    expect(corpos[0].reasoning_effort).toBe("none");
  });
});

describe("outros provedores nunca recebem o parametro", () => {
  it("Groq", async () => {
    google(() => ok());
    await callLlmChatCompletion({ model: "openai/gpt-oss-120b", messages: OI, singleModelOnly: true });
    expect(corpos[0].url).toContain("api.groq.com");
    expect("reasoning_effort" in corpos[0]).toBe(false);
  });
});
