// backend/src/test/ragEngineTransfer.test.js
//
// Testes do wiring da Base de Conhecimento RAG dentro de processBatch
// (Etapa 5, Leva 2, Commit 3). Só findRagContextForQuestion é mockado — o
// resto (buildRagContextBlock, parseAIResponse, o fluxo normal do
// processBatch) roda de verdade, igual chatbotAiRecontact.test.js.
//
// Cobre:
// 1. applies:false → zero mudança de comportamento (modelo chamado normal,
//    sem bloco RAG no prompt, precisa_humano false)
// 2. applies:true, chunks:[] (nenhum trecho bateu) → o modelo AINDA é chamado,
//    sem bloco de contexto — conversa normal, sem transferência automática.
//    Ausência de trecho não é "não sei": "oi", "bom dia", "obrigado" nunca vão
//    bater com nada da base, e não são perguntas sobre o negócio.
// 3. o caso que quebraria sem a correção: base configurada, lead manda "oi" —
//    a resposta não pode ser a frase de transferência.
// 4. applies:true, chunks com conteúdo → o trecho entra no prompt enviado ao
//    modelo, e a regra dura (responder só com o que está ali, ou marcar
//    precisa_humano) fica a cargo do próprio modelo, via buildJsonInstruction.
// 5. busca RAG falha (rede/banco) → segue sem RAG neste turno, não trava

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || "chave-de-teste";

const chatSearchMock = { findRagContextForQuestion: vi.fn() };
vi.mock("../rag/chatSearch.js", async () => {
  const actual = await vi.importActual("../rag/chatSearch.js");
  return {
    ...actual,
    findRagContextForQuestion: (...args) => chatSearchMock.findRagContextForQuestion(...args),
  };
});

const { processBatch } = await import("../chatbot-ai-engine.js");
const n8nSettingsService = await import("../services/n8nSettings.js");

const CLIENT_ID = "geracao-digital";
const PHONE = "5534999991234";

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
        choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
      }),
      text: async () => (typeof content === "string" ? content : JSON.stringify(content)),
    };
  };
}

function makeSupabase() {
  const updates = [];
  const inserts = [];
  const api = {
    updates,
    inserts,
    from: (table) => {
      if (table === "chatbot_prompts" || table === "lead_client_prompts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: { content: "Você é um assistente da Empresa Solar ABC.", prompt: "Você é um assistente da Empresa Solar ABC." } }),
                maybeSingle: () => Promise.resolve({ data: { content: "Você é um assistente da Empresa Solar ABC.", prompt: "Você é um assistente da Empresa Solar ABC." } }),
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
        return { insert: (payload) => { inserts.push(payload); return Promise.resolve({ error: null }); } };
      }
      return api;
    },
    select: () => api,
    order: () => api,
    limit: () => Promise.resolve({ data: [] }), // sem lead existente: fluxo normal, sem recontato
    insert: (payload) => { inserts.push(payload); return Promise.resolve({ error: null }); },
    update: (payload) => {
      updates.push(payload);
      const chain = { eq: () => chain, then: (resolve) => resolve({ error: null }) };
      return chain;
    },
    eq: () => api,
    maybeSingle: () => Promise.resolve({ data: null }),
    single: () => Promise.resolve({ data: null }),
  };
  return api;
}

describe("processBatch — wiring da Base de Conhecimento RAG (Etapa 5, Leva 2, Commit 3)", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchCalls = [];
    chatSearchMock.findRagContextForQuestion.mockReset();
    vi.spyOn(n8nSettingsService, "getLeadClientN8nSettings").mockResolvedValue({});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("applies:false (sem documento pronto pro tenant/agente): zero mudança de comportamento — chama o modelo normal, sem bloco RAG, precisa_humano false", async () => {
    chatSearchMock.findRagContextForQuestion.mockResolvedValue({ applies: false, chunks: [], needsReindexDocumentIds: [] });

    global.fetch = vi.fn(mockFetchResponse({
      mensagem: "Olá! Como posso ajudar?",
      status_conversa: "aguardando_usuario",
      dados: {},
      classificacao: "novo",
      finalizado: false,
    }));

    const supabase = makeSupabase();
    const result = await processBatch({
      clientId: CLIENT_ID,
      phone: PHONE,
      messages: [{ text: "Oi, vocês vendem energia solar?" }],
      supabase,
      model: "padrao",
      llmModel: "openai/gpt-oss-120b",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.precisa_humano).toBe(false);
    expect(result.mensagem).toBe("Olá! Como posso ajudar?");

    // "BASE DE CONHECIMENTO" sozinho não serve de marcador: o parágrafo
    // instrucional fixo (buildJsonInstruction) sempre menciona esse título,
    // mesmo sem RAG. O bloco de CONTEXTO injetado (buildRagContextBlock) é que
    // não pode aparecer quando applies:false.
    const systemMessage = fetchCalls.at(-1)?.messages?.find((m) => m.role === "system")?.content || "";
    expect(systemMessage).not.toContain("CONTEXTO RECUPERADO PARA ESTA PERGUNTA");
  });

  it("applies:true e nenhum trecho acima do limiar: o modelo AINDA é chamado, sem bloco de contexto — conversa normal, sem transferência automática", async () => {
    chatSearchMock.findRagContextForQuestion.mockResolvedValue({ applies: true, chunks: [], needsReindexDocumentIds: [] });

    global.fetch = vi.fn(mockFetchResponse({
      mensagem: "Pode sim, qual o seu interesse?",
      status_conversa: "aguardando_usuario",
      dados: {},
      classificacao: "novo",
      finalizado: false,
      precisa_humano: false,
    }));

    const supabase = makeSupabase();
    const result = await processBatch({
      clientId: CLIENT_ID,
      phone: PHONE,
      messages: [{ text: "Qual o CNPJ de vocês?" }],
      supabase,
      model: "padrao",
      llmModel: "openai/gpt-oss-120b",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.mensagem).toBe("Pode sim, qual o seu interesse?");
    expect(result.mensagem).not.toBe("Não tenho essa informação aqui. Vou passar para um especialista que já te responde.");

    const systemMessage = fetchCalls.at(-1)?.messages?.find((m) => m.role === "system")?.content || "";
    expect(systemMessage).not.toContain("CONTEXTO RECUPERADO PARA ESTA PERGUNTA");
  });

  it("[caso que quebraria sem a correção] base configurada, lead manda 'oi': resposta não é a frase de transferência", async () => {
    // "oi" nunca bate com nenhum trecho de documento — a busca real devolveria
    // applies:true, chunks:[]. Simula exatamente esse retorno.
    chatSearchMock.findRagContextForQuestion.mockResolvedValue({ applies: true, chunks: [], needsReindexDocumentIds: [] });

    global.fetch = vi.fn(mockFetchResponse({
      mensagem: "Oi! Tudo bem? Em que posso te ajudar hoje?",
      status_conversa: "aguardando_usuario",
      dados: {},
      classificacao: "novo",
      finalizado: false,
      precisa_humano: false,
    }));

    const supabase = makeSupabase();
    const result = await processBatch({
      clientId: CLIENT_ID,
      phone: PHONE,
      messages: [{ text: "oi" }],
      supabase,
      model: "padrao",
      llmModel: "openai/gpt-oss-120b",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.precisa_humano).toBe(false);
    expect(result.mensagem).not.toBe("Não tenho essa informação aqui. Vou passar para um especialista que já te responde.");
    expect(result.mensagem).toContain("Oi!");
  });

  it("applies:true com trecho relevante: o conteúdo do trecho entra no prompt, e a regra dura passa a valer (decisão do modelo, via buildJsonInstruction)", async () => {
    chatSearchMock.findRagContextForQuestion.mockResolvedValue({
      applies: true,
      chunks: [{ document_id: "doc-1", content: "Parcelamos em até 12x sem juros no cartão de crédito.", similarity: 0.91 }],
      needsReindexDocumentIds: [],
    });

    global.fetch = vi.fn(mockFetchResponse({
      mensagem: "Parcelamos em até 12x sem juros!",
      status_conversa: "aguardando_usuario",
      dados: {},
      classificacao: "novo",
      finalizado: false,
      precisa_humano: false,
    }));

    const supabase = makeSupabase();
    const result = await processBatch({
      clientId: CLIENT_ID,
      phone: PHONE,
      messages: [{ text: "Vocês parcelam em quantas vezes?" }],
      supabase,
      model: "padrao",
      llmModel: "openai/gpt-oss-120b",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.precisa_humano).toBe(false);
    expect(result.mensagem).toBe("Parcelamos em até 12x sem juros!");

    const systemMessage = fetchCalls.at(-1)?.messages?.find((m) => m.role === "system")?.content || "";
    expect(systemMessage).toContain("CONTEXTO RECUPERADO PARA ESTA PERGUNTA");
    expect(systemMessage).toContain("Parcelamos em até 12x sem juros no cartão de crédito.");
  });

  it("busca RAG falha (erro de rede/banco): segue sem RAG neste turno, não trava o atendimento", async () => {
    chatSearchMock.findRagContextForQuestion.mockRejectedValue(new Error("ECONNREFUSED"));

    global.fetch = vi.fn(mockFetchResponse({
      mensagem: "Olá! Tudo bem?",
      status_conversa: "aguardando_usuario",
      dados: {},
      classificacao: "novo",
      finalizado: false,
    }));

    const supabase = makeSupabase();
    const result = await processBatch({
      clientId: CLIENT_ID,
      phone: PHONE,
      messages: [{ text: "Oi!" }],
      supabase,
      model: "padrao",
      llmModel: "openai/gpt-oss-120b",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.precisa_humano).toBe(false);
    expect(result.mensagem).toBe("Olá! Tudo bem?");
  });

  it("companyId é repassado à busca RAG (escopo por agente/chip)", async () => {
    chatSearchMock.findRagContextForQuestion.mockResolvedValue({ applies: false, chunks: [], needsReindexDocumentIds: [] });
    global.fetch = vi.fn(mockFetchResponse({ mensagem: "Oi!", status_conversa: "aguardando_usuario", dados: {}, classificacao: "novo", finalizado: false }));

    const supabase = makeSupabase();
    await processBatch({
      clientId: CLIENT_ID,
      phone: PHONE,
      messages: [{ text: "Oi!" }],
      supabase,
      model: "padrao",
      llmModel: "openai/gpt-oss-120b",
      companyId: "empresa-xyz",
    });

    expect(chatSearchMock.findRagContextForQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: CLIENT_ID, companyId: "empresa-xyz" })
    );
  });
});
