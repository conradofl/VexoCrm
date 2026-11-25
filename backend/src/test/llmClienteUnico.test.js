// PR 5 do untangle: o cliente de LLM mora em services/llm/client.js, fora do motor do agente.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as client from "../services/llm/client.js";
import * as engine from "../chatbot-ai-engine.js";

const SRC = resolve(__dirname, "..");
function arquivos(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) return nome === "test" ? [] : arquivos(p);
    return p.endsWith(".js") ? [p] : [];
  });
}
const fontes = arquivos(SRC).map((p) => [p.slice(SRC.length + 1), readFileSync(p, "utf8")]);

describe("cliente de LLM fora do motor do agente", () => {
  it("o motor reexporta o mesmo cliente (quem importava dele continua funcionando)", () => {
    expect(engine.callLlmChatCompletion).toBe(client.callLlmChatCompletion);
    expect(engine.LLM_MODELS).toBe(client.LLM_MODELS);
    expect(engine.detectLlmProvider).toBe(client.detectLlmProvider);
  });

  it("services/llm/client.js não importa o motor do agente", () => {
    const s = fontes.find(([p]) => p === "services/llm/client.js")[1];
    expect(s).not.toMatch(/from\s*"[^"]*chatbot-ai-engine\.js"/);
  });

  it("ninguém fora do motor importa callLlmChatCompletion do motor", () => {
    const achados = fontes
      .filter(([p]) => p !== "chatbot-ai-engine.js")
      .filter(([, s]) => /import\s*\{[^}]*\bcallLlmChatCompletion\b[^}]*\}\s*from\s*"[^"]*chatbot-ai-engine\.js"/.test(s))
      .map(([p]) => p);
    expect(achados).toEqual([]);
  });

  it("STRICT_JSON_MODELS só é definido em services/llmModels.js", () => {
    const achados = fontes.filter(([, s]) => /const\s+STRICT_JSON_MODELS\s*=/.test(s)).map(([p]) => p);
    expect(achados).toEqual(["services/llmModels.js"]);
  });
});
