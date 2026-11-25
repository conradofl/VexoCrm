import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { processBatch, buildRecontactInstruction } from "../chatbot-ai-engine.js";
import * as n8nSettingsService from "../services/n8nSettings.js";

const CLIENT_ID = "geracao-digital";
const PHONE = "5534999991234";

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || "chave-de-teste";

let fetchCalls = [];

function mockFetchResponse(content) {
  return async (url, options) => {
    if (options?.body) {
      try {
        fetchCalls.push(JSON.parse(options.body));
      } catch {
        fetchCalls.push({ raw: options.body });
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: typeof content === "string" ? content : JSON.stringify(content),
            },
          },
        ],
      }),
      text: async () => (typeof content === "string" ? content : JSON.stringify(content)),
    };
  };
}

function makeSupabase({ leadRow, promptRow }) {
  const updates = [];
  const inserts = [];
  const filters = [];
  const api = {
    updates,
    inserts,
    filters,
    from: (table) => {
      if (table === "chatbot_prompts" || table === "lead_client_prompts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: promptRow || { content: "Você é um assistente da Empresa Solar ABC.", prompt: "Você é um assistente da Empresa Solar ABC." } }),
                maybeSingle: () => Promise.resolve({ data: promptRow || { content: "Você é um assistente da Empresa Solar ABC.", prompt: "Você é um assistente da Empresa Solar ABC." } }),
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
                single: () => Promise.resolve({ data: null }),
                maybeSingle: () => Promise.resolve({ data: null }),
              }),
            }),
          }),
        };
      }
      if (table === "lead_messages") {
        return {
          insert: (payload) => {
            inserts.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }
      return api;
    },
    select: () => api,
    order: () => api,
    limit: () => Promise.resolve({ data: leadRow ? [leadRow] : [] }),
    insert: (payload) => {
      inserts.push(payload);
      return Promise.resolve({ error: null });
    },
    update: (payload) => {
      updates.push(payload);
      const chain = {
        eq: (col, val) => {
          filters.push([col, val]);
          return chain;
        },
        then: (resolve) => resolve({ error: null }),
      };
      return chain;
    },
    eq: () => api, in: () => api,
    maybeSingle: () => Promise.resolve({ data: null }),
    single: () => Promise.resolve({ data: null }),
  };
  return api;
}

function leadFinalizado(dados = {}, overrides = {}) {
  return {
    id: "lead-finalizado-1",
    dados,
    historico: [
      { sender: "user", text: "Tenho interesse em placas solares", created_at: "2026-08-20T10:00:00Z" },
      { sender: "bot", text: "Perfeito! Qual sua média de conta de luz?", created_at: "2026-08-20T10:01:00Z" },
      { sender: "user", text: "R$ 800 por mês", created_at: "2026-08-20T10:02:00Z" },
      { sender: "bot", text: "Ótimo, nosso consultor entrará em contato!", created_at: "2026-08-20T10:03:00Z" },
    ],
    status_conversa: "finalizado",
    finalizado: true,
    updated_at: new Date().toISOString(),
    lead_temperature: "QUENTE",
    ...overrides,
  };
}

describe("Recontato com IA no Chatbot Engine", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchCalls = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("buildRecontactInstruction constrói instrução de recontato contextualizada sem menção a consórcio", () => {
    const instruction = buildRecontactInstruction({
      lead: {
        lead_temperature: "QUENTE",
        dados: { interesse: "energia solar", conta_luz: "800" },
      },
      historyText: "Lead: Tenho interesse\nBot: Qual sua conta?",
    });

    expect(instruction).toContain("CONTEXTO DE RECONTATO");
    expect(instruction).toContain("QUENTE");
    expect(instruction).toContain("energia solar");
    expect(instruction).toContain("800");
    expect(instruction).toContain("NÃO RECOMECE A QUALIFICAÇÃO DO ZERO");
    expect(instruction).not.toContain("consórcio");
    expect(instruction).not.toContain("consorcio");
  });

  it("recontato dinâmico com IA: chama LLM com instrução de recontato e marca recontato_avisado_em", async () => {
    vi.spyOn(n8nSettingsService, "getLeadClientN8nSettings").mockResolvedValue({
      recontact_message: null, // sem mensagem literal configurada
    });

    global.fetch = vi.fn(mockFetchResponse({
      mensagem: "Olá! Vi que você já falou conosco sobre energia solar. Em que posso te ajudar hoje?",
      status_conversa: "finalizado",
      dados: { interesse: "energia solar" },
      classificacao: "QUENTE",
      finalizado: true,
    }));

    const lead = leadFinalizado({ interesse: "energia solar" });
    const supabase = makeSupabase({ leadRow: lead });

    const result = await processBatch({
      clientId: CLIENT_ID,
      phone: PHONE,
      messages: [{ text: "Olá, tenho uma dúvida sobre a instalação" }],
      supabase,
      model: "padrao",
      llmModel: "openai/gpt-oss-120b",
    });

    expect(result._recontato).toBe(true);
    expect(result.mensagem).toContain("energia solar");
    
    // Verifica que o prompt enviado ao modelo continha a instrução de recontato
    const systemMessage = fetchCalls.at(-1)?.messages?.find((m) => m.role === "system")?.content || "";
    expect(systemMessage).toContain("CONTEXTO DE RECONTATO");
    expect(systemMessage).toContain("energia solar");

    // Verifica que recontato_avisado_em foi gravado no banco
    const patch = supabase.updates.find((u) => u.dados?.recontato_avisado_em);
    expect(patch).toBeTruthy();
    expect(patch.dados.recontato_avisado_em).toBeTruthy();
  });

  it("recontato literal: quando recontact_message está configurado, usa texto literal sem chamar LLM", async () => {
    vi.spyOn(n8nSettingsService, "getLeadClientN8nSettings").mockResolvedValue({
      recontact_message: "Olá! Nosso especialista em energia solar entrará em contato em breve.",
    });

    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const lead = leadFinalizado({ interesse: "energia solar" });
    const supabase = makeSupabase({ leadRow: lead });

    const result = await processBatch({
      clientId: CLIENT_ID,
      phone: PHONE,
      messages: [{ text: "Olá!" }],
      supabase,
      model: "padrao",
      llmModel: "openai/gpt-oss-120b",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result._recontato).toBe(true);
    expect(result.mensagem).toBe("Olá! Nosso especialista em energia solar entrará em contato em breve.");
    expect(supabase.updates.find((u) => u.dados?.recontato_avisado_em)).toBeTruthy();
  });

  it("reabertura na segunda mensagem após recontato_avisado_em", async () => {
    const lead = leadFinalizado(
      { interesse: "energia solar", recontato_avisado_em: "2026-08-24T10:00:00Z" },
      { finalizado: true }
    );
    const supabase = makeSupabase({ leadRow: lead });

    vi.spyOn(n8nSettingsService, "getLeadClientN8nSettings").mockResolvedValue({
      recontact_message: null,
    });

    global.fetch = vi.fn(mockFetchResponse({
      mensagem: "Claro! Vamos verificar isso agora.",
      status_conversa: "aguardando_usuario",
      dados: { interesse: "energia solar" },
      classificacao: "QUENTE",
      finalizado: false,
    }));

    const result = await processBatch({
      clientId: CLIENT_ID,
      phone: PHONE,
      messages: [{ text: "Vocês atendem no bairro Centro?" }],
      supabase,
      model: "padrao",
      llmModel: "openai/gpt-oss-120b",
    });

    // Não deve ser marcado como _recontato
    expect(result._recontato).toBeFalsy();

    // Deve ter reaberto o lead no banco
    const reabertura = supabase.updates.find((u) => u.finalizado === false);
    expect(reabertura).toBeTruthy();
    expect(reabertura.status_conversa).toBe("em_atendimento");
    expect(reabertura.dados.recontato_avisado_em).toBeNull();
    expect(reabertura.dados.recontato_reaberto_em).toBeTruthy();
  });
});
