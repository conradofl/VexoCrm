// Recontato de lead finalizado: a temperatura passa a ser reclassificada do zero e
// persistida em lead_temperature. Antes saia `existing.lead_temperature || "QUENTE"`,
// e como a coluna esta vazia em toda a base o `||` sempre disparava.
//
// Exercita processBatch REAL com supabase mockado. Sem banco e sem LLM: o caminho de
// recontato retorna antes de qualquer chamada de modelo.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { processBatch } from "../chatbot-ai-engine.js";
import * as n8nSettingsService from "../services/n8nSettings.js";

const CLIENT_ID = "geracao-digital";
const PHONE = "5511999998888";

// Dados que qualifyLead classifica como QUENTE: interesse "sim", credito bom, >= 6 campos.
const DADOS_QUENTE = {
  interesse: "sim, quero fechar",
  crédito: "excelente",
  nome: "Fulano",
  cidade: "Uberlandia",
  melhor_horario: "manha",
  valor: "50000",
  profissao: "autonomo",
};
// 4 campos, sem interesse explicito → MORNO.
const DADOS_MORNO = { nome: "Ciclano", cidade: "Uberaba", valor: "20000", profissao: "clt" };
// Vazio → FRIO.
const DADOS_FRIO = {};

function makeSupabase({ leadRow, updateError = null }) {
  const updates = [];
  const filters = [];
  const api = {
    updates,
    filters,
    from: () => api,
    select: () => api,
    order: () => api,
    limit: () => Promise.resolve({ data: leadRow ? [leadRow] : [] }),
    update: (payload) => {
      updates.push(payload);
      const chain = {
        eq: (col, val) => {
          filters.push([col, val]);
          return chain;
        },
        then: (resolve) => resolve({ error: updateError }),
      };
      return chain;
    },
    eq: () => api, in: () => api,
  };
  return api;
}

async function runRecontact({ dados, leadTemperature, updateError = null }) {
  const supabase = makeSupabase({
    leadRow: {
      id: "lead-1",
      dados,
      historico: null,
      status_conversa: "finalizado",
      finalizado: true,
      updated_at: new Date().toISOString(),
      lead_temperature: leadTemperature,
    },
    updateError,
  });

  const result = await processBatch({
    clientId: CLIENT_ID,
    phone: PHONE,
    messages: [{ text: "oi, voltei" }],
    supabase,
    model: "padrao",
    llmModel: "llama-3.3-70b-versatile",
  });

  return { result, supabase };
}

describe("recontato: temperatura reclassificada, sem fallback QUENTE", () => {
  let logSpy;
  let warnSpy;

  beforeEach(() => {
    vi.spyOn(n8nSettingsService, "getLeadClientN8nSettings").mockResolvedValue({
      recontact_message: "Nosso consultor vai entrar em contato.",
    });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("lead SEM classificacao: sai do conteudo, nao do default", async () => {
    // Com o bug antigo, dados MORNO + coluna vazia dariam "QUENTE".
    const { result, supabase } = await runRecontact({ dados: DADOS_MORNO, leadTemperature: null });

    expect(result._recontato).toBe(true);
    expect(result.classificacao).toBe("MORNO");
    expect(result.classificacao).not.toBe("QUENTE");
    // Persistiu na coluna que este caminho le.
    expect(supabase.updates).toHaveLength(1);
    expect(supabase.updates[0].lead_temperature).toBe("MORNO");
    // UPDATE escopado por tenant.
    expect(supabase.filters).toContainEqual(["client_id", CLIENT_ID]);
    expect(supabase.filters).toContainEqual(["id", "lead-1"]);
  });

  it("lead sem dado nenhum vira FRIO, nao QUENTE", async () => {
    const { result, supabase } = await runRecontact({ dados: DADOS_FRIO, leadTemperature: null });
    expect(result.classificacao).toBe("FRIO");
    expect(supabase.updates).toHaveLength(1);
    expect(supabase.updates[0].lead_temperature).toBe("FRIO");
  });

  it("lead JA classificado: preserva a temperatura historica", async () => {
    // Estava FRIO no banco → preserva a temperatura histórica existente.
    const { result, supabase } = await runRecontact({ dados: DADOS_QUENTE, leadTemperature: "FRIO" });
    expect(result.classificacao).toBe("FRIO");
    expect(supabase.updates).toHaveLength(1);
    expect(supabase.updates[0]).not.toHaveProperty("lead_temperature");
    expect(supabase.updates[0].dados.recontato_avisado_em).toBeTruthy();
  });

  it("nao escreve quando a classificacao nao mudou", async () => {
    const { result, supabase } = await runRecontact({ dados: DADOS_QUENTE, leadTemperature: "QUENTE" });
    expect(result.classificacao).toBe("QUENTE");
    // O update agora SEMPRE acontece: grava dados.recontato_avisado_em, a marca que
    // impede o aviso de sair uma segunda vez. O contrato preservado e o outro —
    // temperatura igual nao e reescrita.
    expect(supabase.updates).toHaveLength(1);
    expect(supabase.updates[0]).not.toHaveProperty("lead_temperature");
    expect(supabase.updates[0].dados.recontato_avisado_em).toBeTruthy();
  });

  it("falha no UPDATE nao derruba o recontato", async () => {
    const { result } = await runRecontact({
      dados: DADOS_MORNO,
      leadTemperature: null,
      updateError: { message: "connection terminated" },
    });
    expect(result._recontato).toBe(true);
    expect(result.classificacao).toBe("MORNO");
  });

  it("so grava valores do dominio do CHECK (QUENTE|MORNO|FRIO)", async () => {
    for (const dados of [DADOS_QUENTE, DADOS_MORNO, DADOS_FRIO]) {
      const { result } = await runRecontact({ dados, leadTemperature: null });
      expect(["QUENTE", "MORNO", "FRIO"]).toContain(result.classificacao);
    }
  });
});
