import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolveLlmModel, LLM_MODELS } from "../chatbot-ai-engine.js";
import { defaultLlmModel } from "../services/llmModels.js";
import { maskN8nSettings, resolveSingleLeadClientSettings } from "../services/n8nSettings.js";

describe("Persistência e Fallback do Modelo de IA (LLM)", () => {
  let logSpy;
  let warnSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  describe("DEFEITO 1: campo vazio ou modelo morto NUNCA cala o agente", () => {
    it("tenant sem modelo configurado (null) usa o primeiro modelo da escada e loga o fallback", () => {
      const padrao = defaultLlmModel();
      const modelo = resolveLlmModel(null);
      expect(modelo).toBe(padrao);
      expect(modelo).toBeTruthy();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("tenant sem modelo LLM configurado — usando modelo padrão da escada")
      );
    });

    it("tenant com string vazia ou espaços usa o primeiro modelo da escada e loga o fallback", () => {
      const padrao = defaultLlmModel();
      expect(resolveLlmModel("")).toBe(padrao);
      expect(resolveLlmModel("   ")).toBe(padrao);
      expect(resolveLlmModel(undefined)).toBe(padrao);
    });

    it("tenant com modelo morto (ex: llama-3.3-70b-versatile) usa o primeiro da escada com warning", () => {
      const padrao = defaultLlmModel();
      const modelo = resolveLlmModel("llama-3.3-70b-versatile");
      expect(modelo).toBe(padrao);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("modelo \"llama-3.3-70b-versatile\" nao esta disponivel")
      );
    });

    it("tenant com modelo válido escolhido usa o modelo escolhido sem warning", () => {
      const escolhido = "openai/gpt-oss-120b";
      expect(resolveLlmModel(escolhido)).toBe(escolhido);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("o padrao de quem nao escolheu modelo e o Gemini, por apelido", () => {
      expect(resolveLlmModel(null)).toBe("gemini-flash-latest");
    });

    it("tenant com versao fixa do Gemini que morreu (gemini-2.0-flash) cai no padrao vivo", () => {
      // Caso da Container Led em 30/10/2026: o id salvo voltava 404 no Google.
      expect(resolveLlmModel("gemini-2.0-flash")).toBe(defaultLlmModel());
      expect(resolveLlmModel("gemini-1.5-pro")).toBe(defaultLlmModel());
    });

    it("tenant com modelo da Groq salvo continua na Groq", () => {
      for (const id of ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]) {
        expect(resolveLlmModel(id)).toBe(id);
      }
    });

    it("a lista nao oferece modelo sem chave nem modelo que a conta nao tem mais", () => {
      const ids = LLM_MODELS.map((m) => m.id);
      expect(LLM_MODELS.some((m) => m.provider === "openai")).toBe(false);
      for (const morto of ["groq/compound", "groq/compound-mini", "qwen/qwen3.6-27b", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"]) {
        expect(ids, `${morto} ainda selecionavel`).not.toContain(morto);
      }
      expect(LLM_MODELS[0].provider).toBe("gemini");
    });

    it("todos os modelos em LLM_MODELS resolvem para si mesmos", () => {
      for (const m of LLM_MODELS) {
        expect(resolveLlmModel(m.id)).toBe(m.id);
      }
    });
  });

  describe("DEFEITO 2: valor escolhido sobrevive a leitura e refresh", () => {
    it("maskN8nSettings preserva chatbot_llm_model gravado no banco", () => {
      const row = {
        client_id: "geracao-digital",
        active: true,
        chatbot_enabled: true,
        chatbot_model: "generico",
        chatbot_llm_model: "openai/gpt-oss-120b",
      };
      const masked = maskN8nSettings(row);
      expect(masked.chatbot_llm_model).toBe("openai/gpt-oss-120b");
    });

    it("maskN8nSettings devolve null se chatbot_llm_model não estiver preenchido", () => {
      const row = {
        client_id: "geracao-digital",
        active: true,
        chatbot_enabled: true,
        chatbot_model: "generico",
        chatbot_llm_model: null,
      };
      const masked = maskN8nSettings(row);
      expect(masked.chatbot_llm_model).toBeNull();
    });

    it("maskN8nSettings para row nula devolve defaultLlmModel", () => {
      const masked = maskN8nSettings(null);
      expect(masked.chatbot_llm_model).toBe(defaultLlmModel());
    });

    it("resolveSingleLeadClientSettings preserva chatbot_llm_model", () => {
      const rawRow = {
        client_id: "geracao-digital",
        active: true,
        chatbot_enabled: true,
        chatbot_model: "generico",
        chatbot_llm_model: "qwen/qwen3.8-27b",
      };
      const resolved = resolveSingleLeadClientSettings(rawRow, []);
      expect(resolved.chatbot_llm_model).toBe("qwen/qwen3.8-27b");
    });
  });

  describe("Mutação: provar que modelo vazio/morto não silencia o agente", () => {
    it("resolveLlmModel garante retorno não-vazio para qualquer entrada corrompida", () => {
      const entradasInvalidas = [
        null,
        undefined,
        "",
        "   ",
        "modelo-inventado-que-nao-existe-404",
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
        {},
        123,
        false,
      ];

      for (const entrada of entradasInvalidas) {
        const resultado = resolveLlmModel(entrada);
        expect(typeof resultado).toBe("string");
        expect(resultado.length).toBeGreaterThan(0);
        expect(LLM_MODELS.some((m) => m.id === resultado)).toBe(true);
      }
    });
  });
});
