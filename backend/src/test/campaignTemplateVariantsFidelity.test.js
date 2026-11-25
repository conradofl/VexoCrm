import { describe, expect, it, vi } from "vitest";
import {
  generateCampaignTemplateVariants,
  getVariableCounts,
  hasSameVariableCounts,
} from "../campaign-ai.js";
// campaign-ai chama o cliente de LLM, não o motor do agente (PR 5 do untangle).
import * as chatbotEngine from "../services/llm/client.js";

describe("generateCampaignTemplateVariants - fidelidade, variaveis e nao-silencio", () => {
  it("devolve variantes vazias se nenhum texto base for fornecido", async () => {
    const res = await generateCampaignTemplateVariants({ baseText: "" });
    expect(res.variants).toEqual([]);
    expect(res.rationale).toBe("Nenhum texto base fornecido.");
  });

  it("getVariableCounts extrai e conta corretamente todas as variaveis", () => {
    const base = "oie {{nome}}, seu telefone é {{telefone}} e link {{scheduling_link}} (confirme {{nome}})";
    const counts = getVariableCounts(base);
    expect(counts).toEqual({
      "{{nome}}": 2,
      "{{telefone}}": 1,
      "{{scheduling_link}}": 1,
    });
  });

  describe("a) hasSameVariableCounts exige correspondencia EXATA de {{nome}}, {{telefone}} E {{scheduling_link}}", () => {
    const base = "Olá {{nome}}, confirmamos seu número {{telefone}} e seu agendamento no link {{scheduling_link}}.";

    it("aceita variação com as 3 variáveis preservadas exatamente 1 vez", () => {
      expect(
        hasSameVariableCounts(
          base,
          "Tudo bem {{nome}}? Confirmando seu contato {{telefone}} e o acesso pelo link {{scheduling_link}}."
        )
      ).toBe(true);
    });

    it("rejeita variação com contagem diferente de {{nome}}", () => {
      // 0x {{nome}}
      expect(
        hasSameVariableCounts(
          base,
          "Tudo bem? Confirmando seu contato {{telefone}} e o acesso pelo link {{scheduling_link}}."
        )
      ).toBe(false);
      // 2x {{nome}}
      expect(
        hasSameVariableCounts(
          base,
          "Olá {{nome}}! Tudo bem {{nome}}? Seu telefone é {{telefone}} e link {{scheduling_link}}."
        )
      ).toBe(false);
    });

    it("rejeita variação com contagem diferente de {{telefone}}", () => {
      // 0x {{telefone}}
      expect(
        hasSameVariableCounts(
          base,
          "Olá {{nome}}, confirmamos seu agendamento no link {{scheduling_link}}."
        )
      ).toBe(false);
      // 2x {{telefone}}
      expect(
        hasSameVariableCounts(
          base,
          "Olá {{nome}}, confirmamos seu número {{telefone}} (ou {{telefone}}) e link {{scheduling_link}}."
        )
      ).toBe(false);
    });

    it("rejeita variação com contagem diferente de {{scheduling_link}}", () => {
      // 0x {{scheduling_link}}
      expect(
        hasSameVariableCounts(
          base,
          "Olá {{nome}}, confirmamos seu número {{telefone}} para o agendamento."
        )
      ).toBe(false);
      // 2x {{scheduling_link}}
      expect(
        hasSameVariableCounts(
          base,
          "Olá {{nome}}, veja seu link {{scheduling_link}} ou acesse {{scheduling_link}} com o telefone {{telefone}}."
        )
      ).toBe(false);
    });

    it("rejeita troca indevida de placeholders (ex: trocar {{scheduling_link}} por {{link}})", () => {
      expect(
        hasSameVariableCounts(
          base,
          "Olá {{nome}}, seu número é {{telefone}} e seu agendamento no link {{link}}."
        )
      ).toBe(false);
    });
  });

  describe("b) e c) deduplicação e rejeição de cópias idênticas ao baseText", () => {
    it("nenhuma variação retornada é idêntica ao baseText nem a outra variação", async () => {
      const prevKey = process.env.GROQ_API_KEY;
      process.env.GROQ_API_KEY = "gsk_fake_key_for_test";

      const baseText = "Olá {{nome}}, temos uma oportunidade especial para você hoje!";

      // Mock da resposta do LLM contendo:
      // 1. Texto idêntico ao baseText (deve ser descartado)
      // 2. Variação 1 legítima
      // 3. Variação 1 duplicada em caixa alta/baixa (deve ser descartada)
      // 4. Variação 2 legítima
      const spy = vi.spyOn(chatbotEngine, "callLlmChatCompletion").mockResolvedValue(
        JSON.stringify({
          variants: [
            "Olá {{nome}}, temos uma oportunidade especial para você hoje!", // idêntica à base
            "Tudo bem {{nome}}? Gostaria de compartilhar uma oportunidade exclusiva contigo.", // variação 1
            "TUDO BEM {{nome}}? GOSTARIA DE COMPARTILHAR UMA OPORTUNIDADE EXCLUSIVA CONTIGO.", // duplicata da 1
            "Oi {{nome}}! Passando para te apresentar uma condição diferenciada hoje.", // variação 2
          ],
          rationale: "Variações humanizadas",
        })
      );

      try {
        const result = await generateCampaignTemplateVariants({ baseText, count: 6 });
        expect(result.variants).toHaveLength(2);
        // Nenhuma é idêntica à base
        for (const v of result.variants) {
          expect(v.toLowerCase()).not.toBe(baseText.toLowerCase());
        }
        // Nenhuma é idêntica entre si
        expect(result.variants[0].toLowerCase()).not.toBe(result.variants[1].toLowerCase());
      } finally {
        spy.mockRestore();
        process.env.GROQ_API_KEY = prevKey;
      }
    });
  });

  describe("d) ⭐ falha de LLM propaga erro e NUNCA gera texto localmente", () => {
    it("sem chave de Groq: FALHA com 503 em vez de inventar cumprimentos locais", async () => {
      const prevKey = process.env.GROQ_API_KEY;
      const prevGroqKey = process.env.GROQ_KEY;
      delete process.env.GROQ_API_KEY;
      delete process.env.GROQ_KEY;

      try {
        await expect(
          generateCampaignTemplateVariants({
            baseText: "oie, tudo bem {{nome}}! Tenho algo muito importante pra falar com voce.",
            count: 6,
          })
        ).rejects.toThrow("Chave da Groq (GROQ_API_KEY) não está configurada no servidor.");
      } finally {
        if (prevKey) process.env.GROQ_API_KEY = prevKey;
        if (prevGroqKey) process.env.GROQ_KEY = prevGroqKey;
      }
    });

    it("quando o provedor LLM lança erro ou fica indisponível: propaga o erro e não faz fallback local", async () => {
      const prevKey = process.env.GROQ_API_KEY;
      process.env.GROQ_API_KEY = "gsk_fake_key_for_test";

      const spy = vi.spyOn(chatbotEngine, "callLlmChatCompletion").mockRejectedValue(
        new Error("Groq API rate limit exceeded / models unavailable")
      );

      try {
        await expect(
          generateCampaignTemplateVariants({
            baseText: "Olá {{nome}}, podemos conversar?",
            count: 6,
          })
        ).rejects.toThrow("Groq API rate limit exceeded / models unavailable");
      } finally {
        spy.mockRestore();
        process.env.GROQ_API_KEY = prevKey;
      }
    });

    it("quando o provedor retorna JSON inválido ou vazio: propaga erro 502", async () => {
      const prevKey = process.env.GROQ_API_KEY;
      process.env.GROQ_API_KEY = "gsk_fake_key_for_test";

      const spy = vi.spyOn(chatbotEngine, "callLlmChatCompletion").mockResolvedValue("RESPOSTA_CORROMPIDA_SEM_JSON");

      try {
        await expect(
          generateCampaignTemplateVariants({
            baseText: "Olá {{nome}}, podemos conversar?",
            count: 6,
          })
        ).rejects.toThrow("A IA da Groq retornou um formato JSON inválido.");
      } finally {
        spy.mockRestore();
        process.env.GROQ_API_KEY = prevKey;
      }
    });
  });

  describe("e) regressão do 'e' órfão e preservação de aberturas coloquiais", () => {
    it.each([
      "oie, tudo bem {{nome}}! Tenho uma proposta imperdível.",
      "Olá {{nome}}, como vai você?",
      "Bom dia {{nome}}! Segue seu agendamento no link {{scheduling_link}}.",
      "E aí {{nome}}, tudo certo?",
    ])("baseText começando com '%s' preserva exatamente as variáveis sem produzir mutilações", (baseText) => {
      const counts = getVariableCounts(baseText);
      expect(counts["{{nome}}"]).toBe(1);

      // Simula uma variação válida retornada
      const variant = `Oi ${baseText.replace(/^(?:oie|Olá|Bom dia|E aí),?\s*/i, "")}`;
      expect(hasSameVariableCounts(baseText, variant)).toBe(true);
      expect(variant).not.toMatch(/^e\s/i); // Não começa com "e " órfão
    });
  });
});
