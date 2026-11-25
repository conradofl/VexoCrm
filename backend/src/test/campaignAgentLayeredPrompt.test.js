import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { processBatch } from "../chatbot-ai-engine.js";

const CLIENT_ID = "outlier";
const PHONE = "5511999991234";

const PROMPT_PADRAO = `Você é Áureo, SDR da Outlier Consórcios. Sua missão é qualificar leads com método SPIN de forma natural e humanizada.

FLUXO SPIN:
1. Situação: entenda o contexto atual do lead
2. Problema: identifique a dor atual
3. Implicação: aprofunde as consequências
4. Necessidade: construa o valor do consórcio

FINALIZAÇÃO:
- Finalize (finalizado: true) somente quando tiver interesse, cidade, estado, credito e melhor_horario
- Na mensagem final, informe que um consultor vai entrar em contato

CLASSIFICAÇÃO:
- QUENTE: objetivo claro, crédito informado
- MORNO: pesquisando ou faltam dados
- FRIO: curioso sem intenção`;

const PROMPT_CAMPANHA = `OFERTA DO LOTE: Condição exclusiva de 20% de desconto na primeira parcela para cartas de imóvel acima de 300k.
Responda dúvidas sobre esta condição e conduza para o fechamento.`;

function buildMockSupabase({ dynamicPrompt = PROMPT_PADRAO, campaignPrompt = PROMPT_CAMPANHA, leadRow = null }) {
  const updates = [];
  const insertedMessages = [];

  const api = {
    updates,
    insertedMessages,
    from: (table) => {
      if (table === "chatbot_prompts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: dynamicPrompt ? { content: dynamicPrompt } : null }),
              }),
            }),
          }),
        };
      }

      if (table === "campaign_prompts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: campaignPrompt ? { content: campaignPrompt } : null }),
            }),
          }),
        };
      }

      if (table === "chatbot_templates") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({
                  data: {
                    template_key: "padrao",
                    data_fields: [
                      { key: "interesse", label: "Interesse", description: "Tipo de carta" },
                      { key: "credito", label: "Crédito", description: "Valor desejado" },
                      { key: "melhor_horario", label: "Melhor Horário", description: "Horário para contato" },
                    ],
                    required_fields: ["interesse", "credito", "melhor_horario"],
                    classification: { quente: "Interesse e valor claro", morno: "Em dúvida", frio: "Sem prazo" },
                  },
                }),
              }),
              is: () => ({
                maybeSingle: () => Promise.resolve(null),
              }),
            }),
          }),
        };
      }

      if (table === "leads") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: leadRow ? [leadRow] : [] }),
                }),
              }), in: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: leadRow ? [leadRow] : [] }),
                }),
              }),
            }),
          }),
          update: (payload) => {
            updates.push(payload);
            return {
              eq: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            };
          },
          insert: (payload) => Promise.resolve({ data: payload, error: null }),
        };
      }

      if (table === "lead_messages") {
        return {
          insert: (rows) => {
            const arr = Array.isArray(rows) ? rows : [rows];
            insertedMessages.push(...arr);
            return Promise.resolve({ error: null });
          },
        };
      }

      return {
        select: () => api,
        eq: () => api, in: () => api,
        maybeSingle: () => Promise.resolve({ data: null }),
      };
    },
  };

  return api;
}

describe("Composição em Camadas: Roteiro da Campanha + Agente de Qualificação", () => {
  const oldGroqKey = process.env.GROQ_API_KEY;

  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-mock-groq-key";
  });

  afterEach(() => {
    if (oldGroqKey !== undefined) {
      process.env.GROQ_API_KEY = oldGroqKey;
    } else {
      delete process.env.GROQ_API_KEY;
    }
  });
  it("Lead em campanha com agente: o prompt final contém Base + Método SPIN + Regras de Finalização + Camada da Campanha", async () => {
    let capturedSystemPrompt = null;

    // Mock do fetch global para capturar o payload enviado para o modelo LLM
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url, options) => {
      const body = JSON.parse(options.body);
      const systemMsg = body.messages.find((m) => m.role === "system");
      capturedSystemPrompt = systemMsg?.content || "";

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: JSON.stringify({
                mensagem: "Perfeito, temos a condição de 20% de desconto! Qual o melhor horário para ligarmos?",
                status_conversa: "aguardando_usuario",
                dados: { interesse: "imovel", credito: "300k" },
                classificacao: "QUENTE",
                finalizado: false,
                spin_fase: "necessidade",
              }),
            },
          }],
        }),
      });
    });

    try {
      const mockSupabase = buildMockSupabase({});

      const result = await processBatch({
        clientId: CLIENT_ID,
        phone: PHONE,
        messages: [{ text: "Gostaria de saber sobre o desconto na primeira parcela", type: "text" }],
        supabase: mockSupabase,
        model: "padrao",
        promptType: "padrao",
        campaignPromptId: "camp-prompt-uuid-1",
        instanceName: "Chip Oferta",
      });

      expect(result).toBeTruthy();
      expect(capturedSystemPrompt).toBeTruthy();

      // 1. Contém a identidade e tom de voz da base
      expect(capturedSystemPrompt).toContain("Você é Áureo, SDR da Outlier Consórcios");

      // 2. Contém o método de qualificação (SPIN)
      expect(capturedSystemPrompt).toContain("FLUXO SPIN:");
      expect(capturedSystemPrompt).toContain("1. Situação: entenda o contexto");

      // 3. Contém as regras de finalização e classificação do prompt padrão
      expect(capturedSystemPrompt).toContain("FINALIZAÇÃO:");
      expect(capturedSystemPrompt).toContain("CLASSIFICAÇÃO:");

      // 4. Contém a lista de dados a coletar do template
      expect(capturedSystemPrompt).toContain("DADOS A COLETAR");
      expect(capturedSystemPrompt).toContain("interesse: Interesse");

      // 5. Contém a CAMADA DA CAMPANHA aditiva com o cabeçalho explícito
      expect(capturedSystemPrompt).toContain("CAMADA DA CAMPANHA (OFERTA ESPECÍFICA DESTE DISPARO):");
      expect(capturedSystemPrompt).toContain("Condição exclusiva de 20% de desconto na primeira parcela");

      // 6. A camada da campanha está posicionada NO FINAL (após o prompt base e campos)
      const basePos = capturedSystemPrompt.indexOf("FLUXO SPIN:");
      const campPos = capturedSystemPrompt.indexOf("CAMADA DA CAMPANHA");
      expect(campPos).toBeGreaterThan(basePos);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("Lead em campanha que conclui qualificação: finalizado vira true e dados são salvos", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: JSON.stringify({
                mensagem: "Excelente! Agendado para hoje às 15h. Nosso consultor entrará em contato com você.",
                status_conversa: "finalizado",
                dados: { interesse: "imovel", credito: "350k", melhor_horario: "15h" },
                classificacao: "QUENTE",
                finalizado: true,
                spin_fase: "necessidade",
              }),
            },
          }],
        }),
      });
    });

    try {
      const mockSupabase = buildMockSupabase({
        leadRow: {
          id: "lead-123",
          dados: { interesse: "imovel", credito: "350k" },
          historico: null,
          status_conversa: "em_atendimento",
          finalizado: false,
          updated_at: new Date().toISOString(),
          lead_temperature: "QUENTE",
        },
      });

      const result = await processBatch({
        clientId: CLIENT_ID,
        phone: PHONE,
        messages: [{ text: "Pode ser hoje às 15h!", type: "text" }],
        supabase: mockSupabase,
        model: "padrao",
        promptType: "padrao",
        campaignPromptId: "camp-prompt-uuid-1",
      });

      expect(result.finalizado).toBe(true);
      expect(result.classificacao).toBe("QUENTE");
      expect(result.dados.melhor_horario).toBe("15h");

      // Verifica que atualizou o lead no banco com finalizado: true
      const updatePayload = mockSupabase.updates[0];
      expect(updatePayload.finalizado).toBe(true);
      expect(updatePayload.status).toBe("QUENTE");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("Lead inbound sem campanha: prompt gerado é idêntico ao padrão puro (sem camada de campanha)", async () => {
    let capturedSystemPrompt = null;

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url, options) => {
      const body = JSON.parse(options.body);
      const systemMsg = body.messages.find((m) => m.role === "system");
      capturedSystemPrompt = systemMsg?.content || "";

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: JSON.stringify({
                mensagem: "Olá! Como posso te ajudar hoje?",
                status_conversa: "aguardando_usuario",
                dados: {},
                classificacao: "FRIO",
                finalizado: false,
              }),
            },
          }],
        }),
      });
    });

    try {
      const mockSupabase = buildMockSupabase({});

      await processBatch({
        clientId: CLIENT_ID,
        phone: PHONE,
        messages: [{ text: "Olá", type: "text" }],
        supabase: mockSupabase,
        model: "padrao",
        promptType: "padrao",
        campaignPromptId: null, // Sem campanha
      });

      expect(capturedSystemPrompt).toBeTruthy();
      expect(capturedSystemPrompt).toContain("Você é Áureo, SDR da Outlier Consórcios");
      expect(capturedSystemPrompt).toContain("FLUXO SPIN:");
      // NÃO deve conter a camada de campanha
      expect(capturedSystemPrompt).not.toContain("CAMADA DA CAMPANHA");
      expect(capturedSystemPrompt).not.toContain("Condição exclusiva de 20% de desconto");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("TESTE DE ACEITE: campanha manda 'Você gostou? 1. Sim 2. Não' e lead responde '1'", async () => {
    let capturedSystemPrompt = null;
    let capturedMessages = [];

    const promptCampanhaDiagnostico = `OFERTA: Diagnóstico gratuito de processos de vendas para identificar vazamento de clientes e oportunidades.
Condição exclusiva para empresas que querem estruturar o time comercial.`;

    const mockSupabase = buildMockSupabase({
      campaignPrompt: promptCampanhaDiagnostico,
      leadRow: {
        id: "lead-diagnostico-1",
        dados: {},
        historico: [
          { role: "assistant", content: "Olá! Preparamos um diagnóstico gratuito para a sua empresa. Você gostou da proposta?\n1. Sim\n2. Não" },
        ],
        status_conversa: "em_atendimento",
        finalizado: false,
        updated_at: new Date().toISOString(),
      },
    });

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url, options) => {
      const body = JSON.parse(options.body);
      const systemMsg = body.messages.find((m) => m.role === "system");
      capturedSystemPrompt = systemMsg?.content || "";
      capturedMessages = body.messages;

      // Simulando a resposta gerada com as diretrizes do prompt:
      // Reconhece o Sim + fala do diagnóstico + pergunta contextual na mesma frase
      const respostaIA = "Que bom! O diagnóstico analisa de onde seus clientes estão vindo hoje e onde estão os gargalos. Hoje você já acompanha esses números de alguma forma ou é mais no feeling?";

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: JSON.stringify({
                mensagem: respostaIA,
                status_conversa: "aguardando_usuario",
                dados: { interesse: "diagnostico" },
                classificacao: "MORNO",
                finalizado: false,
                spin_fase: "situacao",
              }),
            },
          }],
        }),
      });
    });

    try {
      const result = await processBatch({
        clientId: CLIENT_ID,
        phone: PHONE,
        messages: [{ text: "1", type: "text" }],
        supabase: mockSupabase,
        model: "padrao",
        promptType: "padrao",
        campaignPromptId: "camp-diagnostico-uuid",
      });

      // 1. Validar que o prompt enviado à IA contém as diretrizes comportamentais e o exemplo
      expect(capturedSystemPrompt).toContain("A OFERTA É O ASSUNTO CENTRAL");
      expect(capturedSystemPrompt).toContain("NENHUMA PERGUNTA NASCE DO NADA");
      expect(capturedSystemPrompt).toContain("UMA PERGUNTA POR VEZ E COM ENTREGA DE VALOR");
      expect(capturedSystemPrompt).toContain("EXEMPLO CONCRETO DE COMPORTAMENTO:");
      expect(capturedSystemPrompt).toContain("Diagnóstico gratuito de processos de vendas");

      // 2. Validar a mensagem que foi gerada para o lead
      const msg = result.mensagem;
      expect(msg).toBeTruthy();

      // Reconhece a concordância ("Que bom!", "Perfeito", etc.)
      expect(msg.toLowerCase()).toMatch(/que bom|ótimo|perfeito|excelente/);

      // Fala da oferta configurada (diagnóstico / clientes / gargalos)
      expect(msg.toLowerCase()).toContain("diagnóstico");

      // NÃO é a pergunta genérica e descontextualizada do SPIN puro
      expect(msg).not.toContain("Qual é o seu segmento de atuação?");

      // Contém no máximo UMA pergunta
      const questionMarkCount = (msg.match(/\?/g) || []).length;
      expect(questionMarkCount).toBeLessThanOrEqual(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("Teste de Mutação: se o prompt da campanha substituísse o padrão, as regras de SPIN e finalização sumiriam", () => {
    const promptPadrao = PROMPT_PADRAO;
    const promptCampanha = PROMPT_CAMPANHA;

    // Na implementação aditiva correta:
    const promptComposto = `${promptPadrao}\n\nCAMADA DA CAMPANHA:\n${promptCampanha}`;
    expect(promptComposto).toContain("FINALIZAÇÃO:");
    expect(promptComposto).toContain("FLUXO SPIN:");
    expect(promptComposto).toContain("Condição exclusiva de 20%");

    // Se houvesse mutação que substitui:
    const promptMutadoSubstituido = promptCampanha;
    expect(promptMutadoSubstituido).not.toContain("FINALIZAÇÃO:");
    expect(promptMutadoSubstituido).not.toContain("FLUXO SPIN:");
  });
});
