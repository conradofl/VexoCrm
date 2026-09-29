import { describe, expect, it } from "vitest";
import {
  calculateBasePotential,
  getLeadSegment,
  type BasePotentialSummary,
} from "../lib/leads/basePotential";

describe("Funil de 3 Faixas — calculateBasePotential (Potencial da Base)", () => {
  const gmcaSummary: BasePotentialSummary = {
    totalLeads: 2106,
    buyersCount: 2,
    lostCount: 0,
    inNegotiationCount: 6,
    inConversationCount: 206,
    neverContactedCount: 1892,
    activeLeadsCount: 2104,
  };

  it("calcula corretamente os valores monetários quando o ticket médio é configurado (referência GMCA)", () => {
    const result = calculateBasePotential(gmcaSummary, 1000);

    expect(result.isConfigured).toBe(true);
    expect(result.neverContactedCount).toBe(1892);
    expect(result.neverContactedValue).toBe(1892000); // R$ 1.892.000 (Destaque)

    expect(result.inConversationCount).toBe(206);
    expect(result.inConversationValue).toBe(206000); // R$ 206.000 (Linha 2)

    expect(result.inNegotiationCount).toBe(6);
    expect(result.inNegotiationValue).toBe(6000); // R$ 6.000 (Linha 3)

    expect(result.activeLeadsCount).toBe(2104);
    expect(result.totalActiveValue).toBe(2104000); // R$ 2.104.000
  });

  it("os três valores recalculam dinamicamente ao mudar o ticket médio", () => {
    const ticketA = 500;
    const resultA = calculateBasePotential(gmcaSummary, ticketA);
    expect(resultA.neverContactedValue).toBe(1892 * 500);
    expect(resultA.inConversationValue).toBe(206 * 500);
    expect(resultA.inNegotiationValue).toBe(6 * 500);
    expect(resultA.totalActiveValue).toBe(2104 * 500);

    const ticketB = 2500;
    const resultB = calculateBasePotential(gmcaSummary, ticketB);
    expect(resultB.neverContactedValue).toBe(1892 * 2500);
    expect(resultB.inConversationValue).toBe(206 * 2500);
    expect(resultB.inNegotiationValue).toBe(6 * 2500);
    expect(resultB.totalActiveValue).toBe(2104 * 2500);
  });

  it("estado 'ticket não configurado' retorna valores monetários nulos sem inventar número default", () => {
    // Caso null
    const resNull = calculateBasePotential(gmcaSummary, null);
    expect(resNull.isConfigured).toBe(false);
    expect(resNull.neverContactedValue).toBeNull();
    expect(resNull.inConversationValue).toBeNull();
    expect(resNull.inNegotiationValue).toBeNull();
    expect(resNull.totalActiveValue).toBeNull();
    // As contagens continuam presentes para exibição
    expect(resNull.neverContactedCount).toBe(1892);
    expect(resNull.inConversationCount).toBe(206);
    expect(resNull.inNegotiationCount).toBe(6);
    expect(resNull.activeLeadsCount).toBe(2104);

    // Caso undefined
    const resUndef = calculateBasePotential(gmcaSummary, undefined);
    expect(resUndef.isConfigured).toBe(false);
    expect(resUndef.neverContactedValue).toBeNull();

    // Caso zero ou negativo
    const resZero = calculateBasePotential(gmcaSummary, 0);
    expect(resZero.isConfigured).toBe(false);
    expect(resZero.neverContactedValue).toBeNull();

    const resNegative = calculateBasePotential(gmcaSummary, -100);
    expect(resNegative.isConfigured).toBe(false);
    expect(resNegative.neverContactedValue).toBeNull();
  });

  it("lida graciosamente com summary vazio ou nulo", () => {
    const result = calculateBasePotential(null, 1000);
    expect(result.isConfigured).toBe(true);
    expect(result.neverContactedCount).toBe(0);
    expect(result.neverContactedValue).toBe(0);
    expect(result.inConversationCount).toBe(0);
    expect(result.inConversationValue).toBe(0);
    expect(result.inNegotiationCount).toBe(0);
    expect(result.inNegotiationValue).toBe(0);
    expect(result.activeLeadsCount).toBe(0);
    expect(result.totalActiveValue).toBe(0);
  });
});

describe("Classificação de Faixa — getLeadSegment (Potencial da Base)", () => {
  it("lead com stage 'open_budget' ou status 'orcamento' é classificado como in_negotiation", () => {
    expect(getLeadSegment({ stage: "open_budget" })).toBe("in_negotiation");
    expect(getLeadSegment({ status: "orcamento" })).toBe("in_negotiation");
    expect(getLeadSegment({ stage: "open_budget", status: "orcamento" })).toBe("in_negotiation");
    expect(getLeadSegment({ stage: "lead", status: "orcamento" })).toBe("in_negotiation");
  });

  it("lead com stage 'buyer' ou 'lost' fica fora das faixas (retorna null)", () => {
    expect(getLeadSegment({ stage: "buyer" })).toBeNull();
    expect(getLeadSegment({ stage: "lost" })).toBeNull();
    // Mesmo que tenha orçamento ou conversa, buyer/lost tem precedência
    expect(getLeadSegment({ stage: "buyer", status: "orcamento" })).toBeNull();
    expect(getLeadSegment({ stage: "lost", raw_chat_summary: "Cliente interessado" })).toBeNull();
  });

  it("lead com resumo comercial ativo é classificado como in_conversation", () => {
    expect(getLeadSegment({ raw_chat_summary: "Cliente perguntou preços de consultoria" })).toBe("in_conversation");
    expect(getLeadSegment({ chat_summary: "Agendando demonstração" })).toBe("in_conversation");
    expect(getLeadSegment({ summary: "Interesse confirmado" })).toBe("in_conversation");
    expect(getLeadSegment({ dados: { resumo_chat: "Conversa em andamento" } })).toBe("in_conversation");
  });

  it("lead com resumo iniciando por 🚫 (não-comercial) é classificado como never_contacted", () => {
    expect(getLeadSegment({ raw_chat_summary: "🚫 Sem interação comercial relevante" })).toBe("never_contacted");
    expect(getLeadSegment({ chat_summary: "🚫 Mensagem automática do sistema" })).toBe("never_contacted");
  });

  it("lead sem resumo ou com histórico vazio é classificado como never_contacted", () => {
    expect(getLeadSegment({})).toBe("never_contacted");
    expect(getLeadSegment({ stage: "lead" })).toBe("never_contacted");
    expect(getLeadSegment({ raw_chat_summary: "" })).toBe("never_contacted");
    expect(getLeadSegment({ raw_chat_summary: "   " })).toBe("never_contacted");
    expect(getLeadSegment({ raw_chat_summary: null })).toBe("never_contacted");
  });

  it("retorna null para lead nulo ou indefinido", () => {
    expect(getLeadSegment(null)).toBeNull();
    expect(getLeadSegment(undefined)).toBeNull();
  });
});
