import { describe, expect, it, vi } from "vitest";
import {
  extractJsonFromLlmText,
  generateCampaignTemplateVariants,
} from "../campaign-ai.js";
import {
  isHighQuotaModel,
  filterLadderOnQuotaExceeded,
  resolveGroqLadder,
} from "../services/llmModels.js";
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

describe("Defeito 2 — Escada de Modelos e Escalada no HTTP 429", () => {
  it("isHighQuotaModel identifica corretamente modelos com >= 70.000 TPM", () => {
    expect(isHighQuotaModel("openai/gpt-oss-120b")).toBe(false);
    expect(isHighQuotaModel("openai/gpt-oss-20b")).toBe(false);
    expect(isHighQuotaModel("qwen/qwen3.6-27b")).toBe(false);
    expect(isHighQuotaModel("groq/compound")).toBe(true);
    expect(isHighQuotaModel("groq/compound-mini")).toBe(true);
  });

  it("filterLadderOnQuotaExceeded descarta modelos de 8.000 TPM e pula direto para modelos de alta cota", () => {
    const escadaOriginal = [
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3.6-27b",
      "groq/compound",
      "groq/compound-mini",
    ];

    // Quando gpt-oss-120b estoura a cota, os restantes são [gpt-oss-20b, qwen, compound, compound-mini]
    const remaining = escadaOriginal.slice(1);
    const escalados = filterLadderOnQuotaExceeded("openai/gpt-oss-120b", remaining);

    // Deve conter APENAS compound e compound-mini, pulando gpt-oss-20b e qwen3.6-27b
    expect(escalados).toEqual(["groq/compound", "groq/compound-mini"]);
    expect(escalados).not.toContain("openai/gpt-oss-20b");
    expect(escalados).not.toContain("qwen/qwen3.6-27b");
  });

  it("callLlmChatCompletion pula modelos de 8.000 TPM no 429 e tenta modelo de alta cota", async () => {
    const prevKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "gsk_fake_key_for_test";

    const modelosChamados = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = vi.fn().mockImplementation(async (url, options) => {
      const body = JSON.parse(options.body);
      modelosChamados.push(body.model);

      if (body.model === "openai/gpt-oss-120b") {
        return {
          ok: false,
          status: 429,
          text: async () =>
            JSON.stringify({
              error: {
                message: "Rate limit reached on tokens per minute (TPM): Limit 8000, Used 7070",
                type: "tokens",
                code: "rate_limit_exceeded",
              },
            }),
        };
      }

      if (body.model === "groq/compound") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '{"status":"ok"}' } }],
          }),
        };
      }

      return {
        ok: false,
        status: 500,
        text: async () => "Internal Error",
      };
    });

    try {
      const res = await chatbotEngine.callLlmChatCompletion({
        model: "openai/gpt-oss-120b",
        messages: [{ role: "user", content: "oi" }],
      });

      expect(res).toBe('{"status":"ok"}');
      // Verificação crítica: chamou 120b, estourou 429, pulou 20b e qwen, foi direto para groq/compound
      expect(modelosChamados).toEqual(["openai/gpt-oss-120b", "groq/compound"]);
      expect(modelosChamados).not.toContain("openai/gpt-oss-20b");
      expect(modelosChamados).not.toContain("qwen/qwen3.6-27b");
    } finally {
      globalThis.fetch = originalFetch;
      process.env.GROQ_API_KEY = prevKey;
    }
  });

  it("se todos os modelos (incluindo alta cota) retornarem 429, lança erro LLM_QUOTA_EXCEEDED", async () => {
    const prevKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "gsk_fake_key_for_test";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url, options) => {
      return {
        ok: false,
        status: 429,
        text: async () =>
          JSON.stringify({
            error: {
              message: "Rate limit reached on tokens per minute (TPM): Limit 8000, Used 8000",
              code: "rate_limit_exceeded",
            },
          }),
      };
    });

    try {
      await expect(
        chatbotEngine.callLlmChatCompletion({
          model: "openai/gpt-oss-120b",
          messages: [{ role: "user", content: "oi" }],
        })
      ).rejects.toThrow(/cota de IA/i);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.GROQ_API_KEY = prevKey;
    }
  });
});

// Incidente de 12/10/2026: a Groq descontinuou groq/compound e groq/compound-mini e a conta ficou só com modelos de
// 8.000 TPM. O filtro "só alta cota" passou a devolver [] — o primeiro 429 truncava a escada e o robô silenciava a
// resposta ao lead. Escalar para alta cota é preferência, não condição.
describe("429 sem modelo de alta cota na escada: nunca silenciar", () => {
  const ESCADA_DE_HOJE = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"];

  it("(a) escada de produção hoje: estourando gpt-oss-120b, segue com os outros dois — nunca vazio", () => {
    const resto = filterLadderOnQuotaExceeded("openai/gpt-oss-120b", ESCADA_DE_HOJE.slice(1));
    expect(resto).toEqual(["openai/gpt-oss-20b", "qwen/qwen3.8-27b"]);
    expect(resto.length).toBeGreaterThan(0);
  });

  it("(b) modelo de alta cota estourado sem outro de alta cota na escada: devolve os restantes de cota baixa", () => {
    const resto = filterLadderOnQuotaExceeded("groq/compound", ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
    expect(resto).toEqual(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
  });

  it("(c) o modelo estourado nunca volta na lista, em nenhum caminho", () => {
    const casos = [
      ["openai/gpt-oss-120b", ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]],
      ["openai/gpt-oss-120b", ["openai/gpt-oss-120b", "groq/compound", "openai/gpt-oss-20b"]],
      ["groq/compound", ["groq/compound", "groq/compound-mini", "openai/gpt-oss-20b"]],
      ["groq/compound", ["groq/compound", "openai/gpt-oss-20b"]],
      ["Openai/GPT-OSS-120b", ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]],
    ];
    for (const [estourado, escada] of casos) {
      const resto = filterLadderOnQuotaExceeded(estourado, escada);
      expect(resto.map((m) => m.toLowerCase())).not.toContain(estourado.toLowerCase());
    }
  });

  it("(d) [INCIDENTE REAL] callLlmChatCompletion: escada sem alta cota, 1º modelo dá 429, o 2º É chamado e a resposta chega", async () => {
    const prevKey = process.env.GROQ_API_KEY;
    const prevLadder = process.env.GROQ_MODEL_LADDER;
    process.env.GROQ_API_KEY = "gsk_fake_key_for_test";
    process.env.GROQ_MODEL_LADDER = ESCADA_DE_HOJE.join(",");

    const modelosChamados = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url, options) => {
      const body = JSON.parse(options.body);
      modelosChamados.push(body.model);
      if (body.model === "openai/gpt-oss-120b") {
        return {
          ok: false,
          status: 429,
          text: async () =>
            JSON.stringify({
              error: { message: "Rate limit reached on tokens per minute (TPM): Limit 8000, Used 7070", code: "rate_limit_exceeded" },
            }),
        };
      }
      if (body.model === "openai/gpt-oss-20b") {
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Olá! Posso ajudar." } }] }) };
      }
      return { ok: false, status: 500, text: async () => "não deveria chegar aqui" };
    });

    try {
      const res = await chatbotEngine.callLlmChatCompletion({
        model: "openai/gpt-oss-120b",
        messages: [{ role: "user", content: "oi" }],
      });

      expect(res).toBe("Olá! Posso ajudar.");
      expect(modelosChamados).toEqual(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.GROQ_API_KEY = prevKey;
      if (prevLadder === undefined) delete process.env.GROQ_MODEL_LADDER;
      else process.env.GROQ_MODEL_LADDER = prevLadder;
    }
  });
});
