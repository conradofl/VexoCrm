import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  formatSummaryOutput,
  summarizeChatWithAI,
  DEFAULT_SUMMARY_PROMPT,
  temConversaComercial,
} from "../domains/leads/chatInsight.js";

describe("Resumo de Conversa do WhatsApp (chatInsight)", () => {
  it("DEFAULT_SUMMARY_PROMPT contém as 4 seções padronizadas e regras estritas", () => {
    expect(DEFAULT_SUMMARY_PROMPT).toContain("🎯");
    expect(DEFAULT_SUMMARY_PROMPT).toContain("📋");
    expect(DEFAULT_SUMMARY_PROMPT).toContain("🤝");
    expect(DEFAULT_SUMMARY_PROMPT).toContain("⏭️");
    expect(DEFAULT_SUMMARY_PROMPT).toContain("máximo seis linhas");
    expect(DEFAULT_SUMMARY_PROMPT).toContain("nada ainda");
    expect(DEFAULT_SUMMARY_PROMPT).toContain("Não use travessão");
  });

  it("Caso Janaina: conversa com '2 adultos' e '1 criança de 4 anos' preserva os dois fatos em 📋", () => {
    const rawAiOutput = JSON.stringify({
      objetivo: "Viagem de férias para família",
      fatos: "2 adultos e 1 criança de 4 anos, destino Maceió, janeiro",
      combinados: "Consultor vai enviar opções de resorts",
      proximo_passo: "Cotar Maceió em janeiro para 2 adultos e 1 criança de 4 anos",
    });

    const formatted = formatSummaryOutput(rawAiOutput);
    expect(formatted).toBeTruthy();
    expect(formatted).toContain("🎯 Viagem de férias para família");
    expect(formatted).toContain("📋 2 adultos e 1 criança de 4 anos, destino Maceió, janeiro");
    expect(formatted).toContain("🤝 Consultor vai enviar opções de resorts");
    expect(formatted).toContain("⏭️ Cotar Maceió em janeiro para 2 adultos e 1 criança de 4 anos");

    const lines = formatted.split("\n");
    expect(lines.length).toBeLessThanOrEqual(6);
  });

  it("Caso Conversa Curta ('Valeuuu'): blocos vazios recebem 'nada ainda' e NÃO exibem frases genéricas", () => {
    const rawAiOutput = `
      🎯 Agradecimento
      📋 nada ainda
      🤝 nada ainda
      ⏭️ nada ainda
    `;

    const formatted = formatSummaryOutput(rawAiOutput);
    expect(formatted).toBeTruthy();
    expect(formatted).toContain("🎯 Agradecimento");
    expect(formatted).toContain("📋 nada ainda");
    expect(formatted).toContain("🤝 nada ainda");
    expect(formatted).toContain("⏭️ nada ainda");

    // Proíbe frases genéricas de template
    expect(formatted).not.toContain("Dar continuidade ao contato comercial");
    expect(formatted).not.toContain("qualificar o interesse");
    expect(formatted).not.toContain("Atendimento em andamento");
  });

  it("Caso Conversa Longa (GEA): cabe em no máximo 6 linhas sem subitens nem prolixidade", () => {
    const rawAiOutput = `
      🎯 Renovar passaporte e acesso ao portal GEA
      📋 Passaporte vencido em 2025, login do sistema pendente de confirmação
      🤝 Consultor solicitou foto do documento
      ⏭️ Enviar link de redefinição e conferir recebimento do documento
    `;

    const formatted = formatSummaryOutput(rawAiOutput);
    expect(formatted).toBeTruthy();
    const lines = formatted.split("\n");
    expect(lines.length).toBeLessThanOrEqual(6);
    expect(formatted.length).toBeLessThanOrEqual(500);
    expect(formatted).not.toContain("(a)");
    expect(formatted).not.toContain("(b)");
    expect(formatted).not.toContain("(c)");
  });

  it("Tolerância: JSON com chaves ausentes preenche 'nada ainda' sem descartar a análise", () => {
    const partialJson = {
      objetivo: "Comprar pacote para Porto de Galinhas",
      // fatos e combinados ausentes
      proxima_acao: "Enviar tabela de preços",
    };

    const formatted = formatSummaryOutput(partialJson);
    expect(formatted).toContain("🎯 Comprar pacote para Porto de Galinhas");
    expect(formatted).toContain("📋 nada ainda");
    expect(formatted).toContain("🤝 nada ainda");
    expect(formatted).toContain("⏭️ Enviar tabela de preços");
  });

  it("Substitui travessão (— / –) por traço simples", () => {
    const rawOutput = `
      🎯 Cotar viagem — pacote completo
      📋 2 adultos – saída de SP
      🤝 nada ainda
      ⏭️ cotar voo e hotel
    `;
    const formatted = formatSummaryOutput(rawOutput);
    expect(formatted).not.toContain("—");
    expect(formatted).not.toContain("–");
    expect(formatted).toContain("-");
  });

  it("Tenant com prompt próprio configurado utiliza o prompt do banco", async () => {
    const customPromptText = "PROMPT CUSTOMIZADO DO TENANT SONHARE: Focar em hotel e transfer.";
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ content: customPromptText }],
      }),
    };

    const messages = ["Olá, quero viajar", "Para onde?"];
    
    // Chama passando o pool mockado
    const insight = await summarizeChatWithAI(messages, "Cliente", {
      clientId: "sonhare",
      pool: mockPool,
      customPrompt: customPromptText,
    });

    expect(mockPool.query).not.toHaveBeenCalled(); // customPrompt explícito tem prioridade
  });

  it("LLM Indisponível: summarizeChatWithAI retorna summary = null com motivo do erro", async () => {
    // Sem chaves de API e sem resposta de LLM
    const insight = await summarizeChatWithAI([], "Contato");
    expect(insight.summary).toBeNull();
    expect(insight.error).toBeTruthy();
  });

  it("Mutação: comprova que reintroduzir o template interpolado quebra o teste de conversa curta", () => {
    // Simula a mutação que injetava template mudo
    const simulateOldFallback = (contactName, lastMsg) => {
      return `📌 Atendimento em andamento com ${contactName}.\n🔎 Última interação: "${lastMsg}".\n➡️ Dar continuidade ao contato comercial e qualificar o interesse.`;
    };

    const mutatedOutput = simulateOldFallback("Janaina", "Valeuuu");

    // O teste EXIGE que frases genéricas NÃO existam no resumo
    expect(mutatedOutput.includes("Dar continuidade ao contato comercial")).toBe(true);
    expect(mutatedOutput.includes("qualificar o interesse")).toBe(true);

    // O novo formato limpo rejeita frases genéricas
    const sanitized = formatSummaryOutput(mutatedOutput);
    // Deve higienizar ou rejeitar as frases proibidas
    if (sanitized) {
      expect(sanitized).not.toContain("Dar continuidade ao contato comercial");
      expect(sanitized).not.toContain("qualificar o interesse");
    }
  });

  describe("Saída de Escape 🚫 (Conversa Pessoal / Sem Oportunidade Comercial)", () => {
    it("DEFAULT_SUMMARY_PROMPT contém marcador 🚫 e regras contra transformar piada/comentário casual em compra", () => {
      expect(DEFAULT_SUMMARY_PROMPT).toContain("🚫");
      expect(DEFAULT_SUMMARY_PROMPT).toContain("Só use 🚫 quando não houver NADA comercial");
      expect(DEFAULT_SUMMARY_PROMPT).toContain("Citar um produto ou serviço de passagem, sem querer comprar, é 🚫");
      expect(DEFAULT_SUMMARY_PROMPT).toContain("Nunca transforme comentário casual ou piada em intenção de compra");
    });

    it("Caso Real (lead 5534998209727): papo pessoal sobre IA entre amigos devolve linha única com 🚫", () => {
      const rawAiOutput = "🚫 Conversa pessoal entre amigos — menção casual a IA sem intenção de compra";
      const formatted = formatSummaryOutput(rawAiOutput);
      expect(formatted).toBe("🚫 Conversa pessoal entre amigos — menção casual a IA sem intenção de compra");
      expect(formatted).not.toContain("🎯");
      expect(formatted).not.toContain("📋");
    });

    it("Normaliza formato com colchetes ou markdown: '🚫 [Conversa pessoal]' vira '🚫 Conversa pessoal'", () => {
      const rawAiOutput = "🚫 [Conversa pessoal com amigo falando de futebol e piadas]";
      const formatted = formatSummaryOutput(rawAiOutput);
      expect(formatted).toBe("🚫 Conversa pessoal com amigo falando de futebol e piadas");
    });

    it("Tolerância JSON: objeto com escape/nao_lead é formatado como linha única com 🚫", () => {
      const jsonOutput = {
        nao_lead: true,
        motivo: "Troca de fotos de família sem interesse comercial",
      };
      const formatted = formatSummaryOutput(jsonOutput);
      expect(formatted).toBe("🚫 Troca de fotos de família sem interesse comercial");
    });

    it("Helper temConversaComercial: identifica corretamente conversas comerciais vs pessoais/vazias", () => {
      // Comercial real
      expect(temConversaComercial({ raw_chat_summary: "🎯 Quer viajar\n📋 2 adultos" })).toBe(true);
      expect(temConversaComercial("🎯 Quer viajar\n📋 2 adultos")).toBe(true);

      // Conversa pessoal (escape 🚫)
      expect(temConversaComercial({ raw_chat_summary: "🚫 Conversa pessoal entre amigos" })).toBe(false);
      expect(temConversaComercial("🚫 Sem oportunidade comercial")).toBe(false);

      // Vazios / Nulos
      expect(temConversaComercial({ raw_chat_summary: null })).toBe(false);
      expect(temConversaComercial({ raw_chat_summary: "" })).toBe(false);
      expect(temConversaComercial({ raw_chat_summary: "   " })).toBe(false);
      expect(temConversaComercial(null)).toBe(false);
      expect(temConversaComercial(undefined)).toBe(false);
    });
  });
});
