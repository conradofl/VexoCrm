// backend/src/test/agentConsolidationEngine.test.js
//
// "Um agente, um dono para cada texto" — Commit 2, efeito no motor. Agente
// consolidado (instructionsConsolidated: true) tem que IGNORAR o template do
// tenant e o prompt padrão do tenant — nem entram no prompt enviado ao
// modelo. Agente NÃO consolidado continua se comportando exatamente como
// hoje (regressão travada).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { processBatch } from "../chatbot-ai-engine.js";

const CLIENT_ID = "geracao-digital";
const PHONE = "5534999991234";

const TENANT_PROMPT_TEXT = "MARCA_TEXTO_PROMPT_PADRAO_DO_TENANT_XYZ";
const TEMPLATE_FIELD_LABEL = "MARCA_CAMPO_TEMPLATE_endereco_completo";

function buildMockSupabase({ agentInboundPrompt }) {
  const api = {
    from: (table) => {
      if (table === "chatbot_prompts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: { content: TENANT_PROMPT_TEXT } }),
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
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      template_key: "generico",
                      data_fields: [{ key: "endereco_completo", label: TEMPLATE_FIELD_LABEL, description: "..." }],
                      required_fields: [],
                    },
                  }),
              }),
              is: () => ({ maybeSingle: () => Promise.resolve(null) }),
            }),
          }),
        };
      }
      if (table === "leads") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({ limit: () => Promise.resolve({ data: [] }) }),
              }),
            }),
          }),
          update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
          insert: (payload) => Promise.resolve({ data: payload, error: null }),
        };
      }
      if (table === "lead_messages") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      return { select: () => api, eq: () => api, maybeSingle: () => Promise.resolve({ data: null }) };
    },
  };
  return api;
}

describe("processBatch — agente consolidado ignora template e prompt padrão do tenant", () => {
  let capturedSystemPrompt = null;
  const originalGroqKey = process.env.GROQ_API_KEY;

  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-mock-groq-key";
    capturedSystemPrompt = null;
    global.fetch = vi.fn().mockImplementation((url, options) => {
      const body = JSON.parse(options.body);
      capturedSystemPrompt = body.messages.find((m) => m.role === "system")?.content || "";
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: JSON.stringify({ mensagem: "ok", status_conversa: "aguardando_usuario", dados: {}, classificacao: "novo", finalizado: false }) } }],
          }),
      });
    });
  });

  afterEach(() => {
    if (originalGroqKey !== undefined) process.env.GROQ_API_KEY = originalGroqKey;
    else delete process.env.GROQ_API_KEY;
    vi.restoreAllMocks();
  });

  it("[TESTE OBRIGATÓRIO] consolidado: o prompt padrão do tenant e os campos do template NÃO aparecem no prompt enviado ao modelo", async () => {
    await processBatch({
      clientId: CLIENT_ID,
      phone: PHONE,
      messages: [{ text: "Oi, quero saber mais" }],
      supabase: buildMockSupabase({ agentInboundPrompt: "PROMPT_PROPRIO_DO_AGENTE_ABC" }),
      model: "padrao",
      promptType: "padrao",
      llmModel: "openai/gpt-oss-120b",
      inboundPrompt: "PROMPT_PROPRIO_DO_AGENTE_ABC",
      instructionsConsolidated: true,
    });

    expect(capturedSystemPrompt).toContain("PROMPT_PROPRIO_DO_AGENTE_ABC");
    expect(capturedSystemPrompt).not.toContain(TENANT_PROMPT_TEXT);
    expect(capturedSystemPrompt).not.toContain(TEMPLATE_FIELD_LABEL);
    expect(capturedSystemPrompt).not.toContain("DADOS A COLETAR");
  });

  it("[regressão travada] NÃO consolidado: continua se comportando exatamente como hoje — template entra no prompt", async () => {
    await processBatch({
      clientId: CLIENT_ID,
      phone: PHONE,
      messages: [{ text: "Oi, quero saber mais" }],
      supabase: buildMockSupabase({ agentInboundPrompt: "PROMPT_PROPRIO_DO_AGENTE_ABC" }),
      model: "padrao",
      promptType: "padrao",
      llmModel: "openai/gpt-oss-120b",
      inboundPrompt: "PROMPT_PROPRIO_DO_AGENTE_ABC",
      // instructionsConsolidated omitido -> false, padrão
    });

    expect(capturedSystemPrompt).toContain("PROMPT_PROPRIO_DO_AGENTE_ABC");
    expect(capturedSystemPrompt).toContain(TEMPLATE_FIELD_LABEL);
    expect(capturedSystemPrompt).toContain("DADOS A COLETAR");
  });
});
