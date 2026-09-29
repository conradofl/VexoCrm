// frontend/src/test/funnelBlocks234.test.ts
//
// Suíte de Testes Automatizados Frontend — Item 12: Funil de Vendas (Blocos 2, 3 e 4)
// Cobrindo:
// 1. Vocabulário customizável e fallbacks (formatStageLabel, formatStageColor)
// 2. Canonicalização bidirecional de chaves legadas e canônicas
// 3. Classificação semântica pura de mensagens (isomórfica)
// 4. Detecção de sugestão inteligente de estágio com justificativa contextual (detectStageSuggestion)

import { describe, expect, it } from "vitest";
import {
  canonicalizeStageKey,
  formatStageLabel,
  formatStageColor,
  DEFAULT_FUNNEL_VOCABULARY,
  classifyLeadMessages,
  detectStageSuggestion,
  FunnelVocabulary,
} from "../hooks/useFunnelVocabulary";

describe("Frontend — Item 12: Funil de Vendas (Blocos 2, 3 e 4)", () => {
  describe("Bloco 3: Vocabulário e Canonicalização", () => {
    it("canonicalizeStageKey normaliza chaves e apelidos legados", () => {
      expect(canonicalizeStageKey("novo")).toBe("cold");
      expect(canonicalizeStageKey("frio")).toBe("cold");
      expect(canonicalizeStageKey("cold")).toBe("cold");

      expect(canonicalizeStageKey("em_atendimento")).toBe("inquiry");
      expect(canonicalizeStageKey("atendimento")).toBe("inquiry");
      expect(canonicalizeStageKey("inquiry")).toBe("inquiry");

      expect(canonicalizeStageKey("qualificado")).toBe("open_budget");
      expect(canonicalizeStageKey("orcamento")).toBe("open_budget");
      expect(canonicalizeStageKey("proposta")).toBe("open_budget");
      expect(canonicalizeStageKey("open_budget")).toBe("open_budget");

      expect(canonicalizeStageKey("fechado")).toBe("buyer");
      expect(canonicalizeStageKey("comprador")).toBe("buyer");
      expect(canonicalizeStageKey("buyer")).toBe("buyer");

      expect(canonicalizeStageKey("perdido")).toBe("lost");
      expect(canonicalizeStageKey("lost")).toBe("lost");
    });

    it("formatStageLabel retorna rótulo do vocabulário customizado quando disponível", () => {
      const customVocab: Partial<FunnelVocabulary> = {
        cold: { label: "Lead Descoberto", color: "slate" },
        inquiry: { label: "Consulta Agendada", color: "blue" },
        buyer: { label: "Paciente Matriculado", color: "emerald" },
      };

      expect(formatStageLabel("cold", customVocab)).toBe("Lead Descoberto");
      expect(formatStageLabel("novo", customVocab)).toBe("Lead Descoberto");
      expect(formatStageLabel("inquiry", customVocab)).toBe("Consulta Agendada");
      expect(formatStageLabel("buyer", customVocab)).toBe("Paciente Matriculado");
      expect(formatStageLabel("fechado", customVocab)).toBe("Paciente Matriculado");

      // Fallback para default quando não customizado
      expect(formatStageLabel("open_budget", customVocab)).toBe(DEFAULT_FUNNEL_VOCABULARY.open_budget.label);
    });

    it("formatStageColor retorna cores padrão e customizadas", () => {
      const customVocab: Partial<FunnelVocabulary> = {
        buyer: { label: "Fechado", color: "purple" },
      };

      expect(formatStageColor("buyer", customVocab)).toBe("purple");
      expect(formatStageColor("cold", customVocab)).toBe("slate");
    });
  });

  describe("Bloco 2 & 4B: Classificação Isomórfica e Sugestão Inteligente", () => {
    it("classifyLeadMessages detecta intenção de compra e confirmação de pagamento", () => {
      const classification = classifyLeadMessages([
        "Boa tarde!",
        "Acabei de fazer a transferência, segue o comprovante do pix.",
      ]);

      expect(classification.stage).toBe("buyer");
      expect(classification.intent).toBe("purchase");
      expect(classification.temperature).toBe("hot");
      expect(classification.reason).toContain("comprovante");
    });

    it("classifyLeadMessages detecta objeção de preço e atribui motivo lost_reason = 'preco'", () => {
      const classification = classifyLeadMessages([
        "Achei muito caro, está bem fora do meu orçamento agora.",
      ]);

      expect(classification.stage).toBe("lost");
      expect(classification.lost_reason).toBe("preco");
      expect(classification.temperature).toBe("cold");
    });

    it("detectStageSuggestion sugere avanço de estágio quando mensagens divergem do estágio atual", () => {
      const messages = [
        { body: "Qual o valor do tratamento completo?" },
        { body: "Vocês tem desconto para pagamento à vista?" },
      ];

      // Lead ainda em 'cold' ou 'inquiry'
      const suggestion = detectStageSuggestion(messages, "inquiry");

      expect(suggestion).not.toBeNull();
      expect(suggestion?.suggestedStage).toBe("open_budget");
      expect(suggestion?.reason).toContain("orçamento");
    });

    it("detectStageSuggestion NÃO sugere mudança se o lead já estiver no estágio detectado", () => {
      const messages = [
        { body: "Manda a tabela de preços e orçamento" },
      ];

      // Lead já está em open_budget
      const suggestion = detectStageSuggestion(messages, "open_budget");
      expect(suggestion).toBeNull();
    });

    it("detectStageSuggestion NÃO sugere mudança quando mensagens não têm sinais comerciais", () => {
      const messages = [
        { body: "Olá" },
        { body: "Tudo bem com você?" },
      ];

      const suggestion = detectStageSuggestion(messages, "cold");
      expect(suggestion).toBeNull();
    });

    it("detectStageSuggestion sugere avanço para 'buyer' quando comprovante é enviado", () => {
      const messages = [
        { body: "Paguei o boleto hoje de manhã, segue comprovante em anexo." },
      ];

      const suggestion = detectStageSuggestion(messages, "open_budget");
      expect(suggestion).not.toBeNull();
      expect(suggestion?.suggestedStage).toBe("buyer");
    });
  });
});
