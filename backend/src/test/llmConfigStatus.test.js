import { describe, expect, it } from "vitest";
import { computeLlmConfigStatus } from "../services/llmConfigStatus.js";

describe("/health llmConfig", () => {
  it("mostra id de modelo e só sim/não para chave", () => {
    const out = computeLlmConfigStatus({
      GROQ_CAMPAIGN_AI_MODEL: "openai/gpt-oss-20b",
      LLM_MODEL_LADDER: "gemini-flash-latest, openai/gpt-oss-120b",
      GROQ_API_KEY: "gsk_segredo_de_verdade",
      GEMINI_API_KEY: "",
    });
    expect(out.modelos.GROQ_CAMPAIGN_AI_MODEL).toBe("openai/gpt-oss-20b");
    expect(out.modelos.LLM_MODEL_LADDER).toBe("gemini-flash-latest,openai/gpt-oss-120b");
    expect(out.modelos.GROQ_MODEL).toBeNull();
    expect(out.chaves.GROQ_API_KEY).toBe(true);
    expect(out.chaves.GEMINI_API_KEY).toBe(false);
    expect(out.modeloDeCampanhaMorto).toBe(false);
    expect(JSON.stringify(out)).not.toContain("segredo");
  });

  it("valor que não parece modelo vira só true (não vaza)", () => {
    const out = computeLlmConfigStatus({ GROQ_MODEL: "sk-abc def ghi" });
    expect(out.modelos.GROQ_MODEL).toBe(true);
    expect(JSON.stringify(out)).not.toContain("sk-abc");
  });

  it("modelo de campanha morto é sinalizado", () => {
    expect(computeLlmConfigStatus({ GROQ_CAMPAIGN_AI_MODEL: "llama-3.3-70b-versatile" }).modeloDeCampanhaMorto).toBe(true);
    expect(computeLlmConfigStatus({}).modeloDeCampanhaMorto).toBeNull();
  });
});
