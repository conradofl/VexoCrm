// backend/src/test/magicCampaignCreator.test.js
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  generateMagicCampaign,
  getFallbackMagicCampaign,
} from "../services/magicCampaignCreator.js";
import * as chatbotEngine from "../chatbot-ai-engine.js";

describe("magicCampaignCreator", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("getFallbackMagicCampaign - contingência heurística", () => {
    it("gera fallback bem estruturado para nicho imobiliária com 3 passos", () => {
      const res = getFallbackMagicCampaign({
        prompt: "Lançamento de apartamentos na planta",
        niche: "imobiliaria",
        tone: "consultivo",
      });

      expect(res.campaignName).toContain("Lançamento de apartamentos");
      expect(res.rationale).toBeDefined();
      expect(res.steps).toHaveLength(3);

      // Passo 1: Imediato, texto
      expect(res.steps[0].order).toBe(1);
      expect(res.steps[0].type).toBe("text");
      expect(res.steps[0].triggerMode).toBe("immediate");
      expect(res.steps[0].text).toContain("{{primeiro_nome}}");

      // Passo 2: Pós-resposta com botões
      expect(res.steps[1].order).toBe(2);
      expect(res.steps[1].type).toBe("text");
      expect(res.steps[1].triggerMode).toBe("after_reply");
      expect(res.steps[1].buttons).toHaveLength(2);
      expect(res.steps[1].buttons[0].type).toBe("reply");

      // Passo 3: Pós-resposta com link
      expect(res.steps[2].order).toBe(3);
      expect(res.steps[2].type).toBe("link");
      expect(res.steps[2].triggerMode).toBe("after_reply");
      expect(res.steps[2].linkUrl).toBe("{{scheduling_link}}");
      expect(res.steps[2].text).toContain("👉");

      // Agent prompt
      expect(res.agentPrompt).toBeDefined();
      expect(res.agentPrompt.length).toBeGreaterThan(20);
    });

    it("gera fallback para nichos estética, academia, veículos, varejo, b2b e geral", () => {
      const niches = ["estetica", "academia", "veiculos", "varejo", "b2b", "geral"];
      for (const niche of niches) {
        const res = getFallbackMagicCampaign({ niche });
        expect(res.steps).toHaveLength(3);
        expect(res.steps[0].triggerMode).toBe("immediate");
        expect(res.steps[1].triggerMode).toBe("after_reply");
        expect(res.steps[1].buttons).toBeDefined();
        expect(res.steps[2].triggerMode).toBe("after_reply");
        expect(res.steps[2].linkUrl).toBe("{{scheduling_link}}");
      }
    });

    it("adapta tom de voz no agentPrompt", () => {
      const resDescontraido = getFallbackMagicCampaign({ tone: "descontraido" });
      expect(resDescontraido.agentPrompt).toContain("amigável");

      const resPersuasivo = getFallbackMagicCampaign({ tone: "persuasivo" });
      expect(resPersuasivo.agentPrompt).toContain("persuasivo");
    });
  });

  describe("generateMagicCampaign - integração LLM e resiliência", () => {
    it("faz parsing correto de resposta válida da LLM", async () => {
      const mockLlmResponse = JSON.stringify({
        campaignName: "Apartamentos Reserva Nobre",
        rationale: "Curiosidade sobre valorização na região seguida de agendamento VIP.",
        steps: [
          {
            order: 1,
            type: "text",
            triggerMode: "immediate",
            text: "Oi {{primeiro_nome}}, tudo bem? Saiu uma condição inédita para investidores no bairro.",
          },
          {
            order: 2,
            type: "text",
            triggerMode: "after_reply",
            text: "Sensacional! São unidades exclusivas com fluxo direto com a construtora.",
            buttons: [
              { type: "reply", displayText: "1 - Quero conferir", replyText: "1 - Quero conferir" },
              { type: "reply", displayText: "2 - Agora não", replyText: "2 - Agora não" },
            ],
          },
          {
            order: 3,
            type: "link",
            triggerMode: "after_reply",
            linkUrl: "{{scheduling_link}}",
            text: "👉 Acesse o link oficial para escolher o horário da visita:",
          },
        ],
        agentPrompt: "Atenda o lead explicando os diferenciais das plantas e convença a visitar o stand.",
      });

      vi.spyOn(chatbotEngine, "callLlmChatCompletion").mockResolvedValue(mockLlmResponse);

      const result = await generateMagicCampaign({
        prompt: "Lançamento no bairro nobre",
        niche: "imobiliaria",
        tone: "persuasivo",
      });

      expect(result.campaignName).toBe("Apartamentos Reserva Nobre");
      expect(result.rationale).toContain("Curiosidade sobre valorização");
      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].text).toContain("Oi {{primeiro_nome}}");
      expect(result.steps[1].buttons[0].displayText).toBe("1 - Quero conferir");
      expect(result.steps[2].linkUrl).toBe("{{scheduling_link}}");
      expect(result.agentPrompt).toContain("Atenda o lead");
    });

    it("recorre ao fallback heurístico quando a LLM lança exceção ou timeout", async () => {
      vi.spyOn(chatbotEngine, "callLlmChatCompletion").mockRejectedValue(new Error("Groq timeout 504"));

      const result = await generateMagicCampaign({
        prompt: "Clínica de Estética Botox Day",
        niche: "estetica",
        tone: "descontraido",
      });

      expect(result.campaignName).toContain("Clínica de Estética");
      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].triggerMode).toBe("immediate");
      expect(result.steps[1].triggerMode).toBe("after_reply");
      expect(result.steps[2].triggerMode).toBe("after_reply");
    });

    it("recorre ao fallback heurístico quando a LLM devolve resposta sem JSON válido", async () => {
      vi.spyOn(chatbotEngine, "callLlmChatCompletion").mockResolvedValue("Desculpe, não consigo gerar JSON agora.");

      const result = await generateMagicCampaign({
        prompt: "Crossfit Desafio 30 Dias",
        niche: "academia",
      });

      expect(result.campaignName).toContain("Crossfit Desafio 30 Dias");
      expect(result.steps).toHaveLength(3);
      expect(result.steps[2].linkUrl).toBe("{{scheduling_link}}");
    });
  });
});
