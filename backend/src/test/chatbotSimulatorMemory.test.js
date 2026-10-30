// backend/src/test/chatbotSimulatorMemory.test.js
//
// Simulador "Testar antes de soltar": a memória da conversa vem da TELA
// (simulationState), não de um lead no banco. Antes, todo teste do tenant
// lia e gravava o lead de telefone fixo 5500000000000 — um fantasma que
// aparecia na lista do Banco, entrava em "selecionar todos" e era o mesmo
// para todos os agentes e usuários do tenant.
//
// Aqui o motor roda de verdade; só o que sai do processo é dublado: o banco
// (supabase falso que registra cada tabela tocada) e a chamada HTTP ao LLM.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { processBatch } from "../chatbot-ai-engine.js";
import * as n8nSettingsService from "../services/n8nSettings.js";

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || "chave-de-teste";

const CLIENT_ID = "bia-do-spazio";
const PHONE = "5500000000000";

let fetchCalls = [];

function mockLlm(content) {
  return async (_url, options) => {
    if (options?.body) {
      try { fetchCalls.push(JSON.parse(options.body)); } catch { fetchCalls.push({ raw: options.body }); }
    }
    const text = JSON.stringify(content);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: text } }] }),
      text: async () => text,
    };
  };
}

// O lead fantasma que existe hoje em produção: se o motor o ler, a conversa
// antiga dele ("consórcio") vaza para o prompt.
const LEAD_FANTASMA = {
  id: "lead-fantasma-5500",
  dados: { nome: "Fantasma" },
  historico: [
    { role: "user", content: "Quero saber do consórcio antigo" },
    { role: "assistant", content: "Claro, sobre o consórcio antigo..." },
  ],
  status: "cold",
  updated_at: new Date().toISOString(),
};

function makeSupabase() {
  const tabelasTocadas = [];
  const escritas = [];
  const api = {
    tabelasTocadas,
    escritas,
    from: (table) => {
      tabelasTocadas.push(table);
      if (table === "chatbot_prompts" || table === "lead_client_prompts" || table === "chatbot_templates") {
        const row = table === "chatbot_templates" ? null : { content: "Você é a assistente da Loja Teste.", prompt: "Você é a assistente da Loja Teste." };
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => Promise.resolve({ data: row }),
                maybeSingle: () => Promise.resolve({ data: row }),
              }),
            }),
          }),
        };
      }
      return api;
    },
    select: () => api,
    order: () => api,
    eq: () => api,
    in: () => api,
    limit: () => Promise.resolve({ data: [LEAD_FANTASMA] }),
    insert: (payload) => { escritas.push(["insert", payload]); return Promise.resolve({ error: null }); },
    update: (payload) => {
      escritas.push(["update", payload]);
      const chain = { eq: () => chain, then: (resolve) => resolve({ error: null }) };
      return chain;
    },
    maybeSingle: () => Promise.resolve({ data: null }),
    single: () => Promise.resolve({ data: null }),
  };
  return api;
}

const HISTORICO_DA_TELA = [
  { role: "user", content: "Oi, meu nome é Ana" },
  { role: "assistant", content: "Olá Ana! Em que posso ajudar?" },
];

const RESPOSTA_LLM = {
  mensagem: "Perfeito, Ana. Qual produto te interessa?",
  status_conversa: "em_atendimento",
  classificacao: "MORNO",
  dados: { interesse: "sofá" },
  finalizado: false,
};

function mensagensEnviadasAoModelo() {
  return (fetchCalls.at(-1)?.messages || []).map((m) => String(m.content || "")).join("\n---\n");
}

describe("processBatch com simulationState (memória do simulador vem da tela)", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchCalls = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(n8nSettingsService, "getLeadClientN8nSettings").mockResolvedValue({});
    global.fetch = vi.fn(mockLlm(RESPOSTA_LLM));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("[TESTE OBRIGATÓRIO] S1 não lê nem grava a tabela leads — o fantasma 5500 nem é consultado", async () => {
    const supabase = makeSupabase();
    await processBatch({
      clientId: CLIENT_ID,
      phone: PHONE,
      messages: [{ text: "Quero um sofá", type: "text" }],
      supabase,
      simulationState: { historico: HISTORICO_DA_TELA, dados: { nome: "Ana" } },
    });

    expect(supabase.tabelasTocadas).not.toContain("leads");
    expect(supabase.escritas).toEqual([]);
  });

  it("[TESTE OBRIGATÓRIO] S2 o modelo recebe o histórico da TELA, nunca o do lead fantasma", async () => {
    const supabase = makeSupabase();
    await processBatch({
      clientId: CLIENT_ID,
      phone: PHONE,
      messages: [{ text: "Quero um sofá", type: "text" }],
      supabase,
      simulationState: { historico: HISTORICO_DA_TELA, dados: { nome: "Ana" } },
    });

    const enviado = mensagensEnviadasAoModelo();
    expect(enviado).toContain("Oi, meu nome é Ana");
    expect(enviado).toContain("Quero um sofá");
    expect(enviado).not.toContain("consórcio antigo");
  });

  it("[TESTE OBRIGATÓRIO] S3 devolve a memória do próximo turno: histórico com o turno novo e dados acumulados", async () => {
    const supabase = makeSupabase();
    const result = await processBatch({
      clientId: CLIENT_ID,
      phone: PHONE,
      messages: [{ text: "Quero um sofá", type: "text" }],
      supabase,
      simulationState: { historico: HISTORICO_DA_TELA, dados: { nome: "Ana" } },
    });

    expect(result._history).toEqual([
      ...HISTORICO_DA_TELA,
      { role: "user", content: "Quero um sofá" },
      { role: "assistant", content: RESPOSTA_LLM.mensagem },
    ]);
    expect(result._dados).toEqual(expect.objectContaining({ nome: "Ana", interesse: "sofá" }));
  });

  it("[TESTE OBRIGATÓRIO] S4 conversa vazia (recém-limpa) começa do zero", async () => {
    const supabase = makeSupabase();
    const result = await processBatch({
      clientId: CLIENT_ID,
      phone: PHONE,
      messages: [{ text: "Oi", type: "text" }],
      supabase,
      simulationState: { historico: [], dados: {} },
    });

    expect(mensagensEnviadasAoModelo()).not.toContain("consórcio antigo");
    expect(result._history).toEqual([
      { role: "user", content: "Oi" },
      { role: "assistant", content: RESPOSTA_LLM.mensagem },
    ]);
  });

  it("S5 conversa em andamento no simulador não vira 'reengajamento' (o teste é ao vivo, não lead sumido há horas)", async () => {
    const supabase = makeSupabase();
    await processBatch({
      clientId: CLIENT_ID,
      phone: PHONE,
      messages: [{ text: "Quero um sofá", type: "text" }],
      supabase,
      simulationState: { historico: HISTORICO_DA_TELA, dados: {} },
    });

    expect(mensagensEnviadasAoModelo()).not.toContain("REENGAJAMENTO");
  });

  it("S6 sem simulationState o comportamento antigo segue intacto (lê o lead do banco)", async () => {
    const supabase = makeSupabase();
    await processBatch({
      clientId: CLIENT_ID,
      phone: PHONE,
      messages: [{ text: "Quero um sofá", type: "text" }],
      supabase,
      isSimulation: true,
    });

    expect(supabase.tabelasTocadas).toContain("leads");
    expect(mensagensEnviadasAoModelo()).toContain("consórcio antigo");
  });
});
