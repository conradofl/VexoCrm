import { describe, expect, it, vi } from "vitest";
import {
  extractJsonFromLlmText,
  generateCampaignTemplateVariants,
} from "../campaign-ai.js";
import { dropOnRequestTooLarge } from "../services/llmModels.js";
import * as chatbotEngine from "../chatbot-ai-engine.js";

describe("Defeito 1 — Extração Resiliente de JSON e Erro Honesto", () => {
  it("extrai JSON quando embrulhado em markdown com texto antes e depois", () => {
    const raw = `Aqui estão as variações solicitadas:
\`\`\`json
{
  "variants": [
    "Olá {{nome}}, tudo bem?",
    "Oi {{nome}}, como vai?"
  ],
  "rationale": "Variações humanizadas"
}
\`\`\`
Espero ter ajudado!`;

    const parsed = extractJsonFromLlmText(raw);
    expect(parsed.variants).toEqual(["Olá {{nome}}, tudo bem?", "Oi {{nome}}, como vai?"]);
    expect(parsed.rationale).toBe("Variações humanizadas");
  });

  it("remove blocos <think> do modelo Qwen antes do parse", () => {
    const raw = `<think>
Vou pensar aqui nas variações de WhatsApp...
Preciso manter as variáveis.
</think>
{
  "variants": [
    "Olá {{nome}}, oportunidade especial para você.",
    "Oi {{nome}}, confira nossa novidade!"
  ],
  "rationale": "qwen reasoning"
}`;

    const parsed = extractJsonFromLlmText(raw);
    expect(parsed.variants).toHaveLength(2);
    expect(parsed.rationale).toBe("qwen reasoning");
  });

  it("sanitiza aspas inteligentes / tipográficas e trailing commas", () => {
    const raw = `{
  “variants”: [
    “Olá {{nome}}, tudo bem?”,
    “Oi {{nome}}, como está?”,
  ],
  “rationale”: “aspas curvas”,
}`;

    const parsed = extractJsonFromLlmText(raw);
    expect(parsed.variants).toEqual(["Olá {{nome}}, tudo bem?", "Oi {{nome}}, como está?"]);
    expect(parsed.rationale).toBe("aspas curvas");
  });

  it("sanitiza quebras de linha literais dentro de strings JSON", () => {
    const raw = `{\n  "variants": [\n    "Mensagem com\nquebra de linha {{nome}}",\n    "Outra mensagem {{nome}}"\n  ],\n  "rationale": "quebras"\n}`;
    const parsed = extractJsonFromLlmText(raw);
    expect(parsed.variants[0]).toContain("Mensagem com\nquebra de linha {{nome}}");
  });

  it("extrai variants via fallback cirúrgico se JSON estiver parcialmente quebrado", () => {
    const raw = `Texto explicativo da IA:
"variants": [
  "Primeira variação {{nome}}!",
  "Segunda variação {{nome}}!"
]
"rationale": "extração por regex"`;

    const parsed = extractJsonFromLlmText(raw);
    expect(parsed.variants).toEqual([
      "Primeira variação {{nome}}!",
      "Segunda variação {{nome}}!",
    ]);
  });

  it("REGRA DURA: lixo ou resposta corrompida lança 502 GROQ_INVALID_JSON e NUNCA inventa variantes", () => {
    expect(() => extractJsonFromLlmText("LIXO TOTAL SEM NENHUM JSON")).toThrow(
      "A IA da Groq retornou um formato JSON inválido."
    );
  });
});

const CHAVES_DE_AMBIENTE = [
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "LLM_MODEL_LADDER",
  "GROQ_CAMPAIGN_AI_MODEL",
];

function salvarEnv() {
  const salvo = Object.fromEntries(CHAVES_DE_AMBIENTE.map((k) => [k, process.env[k]]));
  return () => {
    for (const k of CHAVES_DE_AMBIENTE) {
      if (salvo[k] === undefined) delete process.env[k];
      else process.env[k] = salvo[k];
    }
  };
}

describe("Defeito 2 — Escada de Modelos e Escalada no HTTP 413/429", () => {
  it("413 descarta os modelos do mesmo provedor com teto igual ou menor e mantem os outros provedores", () => {
    const restantes = ["openai/gpt-oss-20b", "qwen/qwen3.8-27b", "gemini-flash-latest", "gemini-flash-lite-latest"];
    expect(dropOnRequestTooLarge("openai/gpt-oss-120b", restantes)).toEqual([
      "gemini-flash-latest",
      "gemini-flash-lite-latest",
    ]);
  });

  it("413 em modelo de teto desconhecido so descarta o proprio modelo", () => {
    const restantes = ["gemini-flash-latest", "gemini-flash-lite-latest", "openai/gpt-oss-20b"];
    expect(dropOnRequestTooLarge("gemini-flash-latest", restantes)).toEqual([
      "gemini-flash-lite-latest",
      "openai/gpt-oss-20b",
    ]);
  });

  it("callLlmChatCompletion no 413 da Groq pula os outros de 8.000 TPM e cai no Gemini", async () => {
    const restaurarEnv = salvarEnv();
    process.env.GROQ_API_KEY = "gsk_fake_key_for_test";
    process.env.GEMINI_API_KEY = "gemini_fake_key_for_test";
    process.env.LLM_MODEL_LADDER = "openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3.8-27b,gemini-flash-latest";
    delete process.env.GROQ_CAMPAIGN_AI_MODEL;

    const modelosChamados = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
      const body = JSON.parse(options.body);
      modelosChamados.push(body.model);
      if (String(url).includes("api.groq.com")) {
        return {
          ok: false,
          status: 413,
          text: async () =>
            "Request too large for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Requested 9431",
        };
      }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"status":"ok"}' } }] }) };
    });

    try {
      const res = await chatbotEngine.callLlmChatCompletion({
        model: "openai/gpt-oss-120b",
        messages: [{ role: "user", content: "oi" }],
      });
      expect(res).toBe('{"status":"ok"}');
      expect(modelosChamados).toEqual(["openai/gpt-oss-120b", "gemini-flash-latest"]);
    } finally {
      fetchSpy.mockRestore();
      restaurarEnv();
    }
  });

  it("se todos os modelos retornarem 429, lança erro LLM_QUOTA_EXCEEDED", async () => {
    const restaurarEnv = salvarEnv();
    process.env.GROQ_API_KEY = "gsk_fake_key_for_test";
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LLM_MODEL_LADDER;

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 429,
      text: async () =>
        JSON.stringify({
          error: {
            message: "Rate limit reached on tokens per minute (TPM): Limit 8000, Used 8000",
            code: "rate_limit_exceeded",
          },
        }),
    }));

    try {
      const erro = await chatbotEngine
        .callLlmChatCompletion({ model: "openai/gpt-oss-120b", messages: [{ role: "user", content: "oi" }] })
        .catch((e) => e);
      expect(erro.code).toBe("LLM_QUOTA_EXCEEDED");
      expect(erro.message).toMatch(/cota de IA/i);
    } finally {
      fetchSpy.mockRestore();
      restaurarEnv();
    }
  });
});
