import { describe, it, expect, vi } from "vitest";
import {
  generateCampaignTemplateVariants,
  extractUrlsFromText,
} from "../campaign-ai.js";
import {
  buildTextPayload,
  resolveStepTextForLead,
  normalizeCampaignAnalyticsMeta,
} from "../campaign-outbound.js";
import * as chatbotAiEngine from "../chatbot-ai-engine.js";

describe("Preservação Estrita e Imutabilidade de URLs no Pipeline de Campanhas", () => {
  describe("1. Extração e Preservação de URLs contra o Motor de Variação de IA", () => {
    it("extractUrlsFromText extrai URLs com precisão sem carregar pontuações finais", () => {
      const text = "Acesse https://vexoia.com/teste, ou veja https://vexoia.com/proposta. Tudo certo!";
      const urls = extractUrlsFromText(text);
      expect(urls).toEqual([
        "https://vexoia.com/teste",
        "https://vexoia.com/proposta",
      ]);
    });

    it("generateCampaignTemplateVariants preserva a URL 100% idêntica à entrada, sem %20, sem caixa alta e sem re-encoding", async () => {
      const prevKey = process.env.GROQ_API_KEY;
      process.env.GROQ_API_KEY = "test-groq-key";

      const spyLlm = vi.spyOn(chatbotAiEngine, "callLlmChatCompletion").mockImplementation(async ({ messages }) => {
        const userPrompt = messages.find((m) => m.role === "user")?.content || "";
        expect(userPrompt).toContain("{{__url_immutable_0__}}");
        expect(userPrompt).not.toContain("https://vexoia.com/proposta-exclusiva");

        return JSON.stringify({
          variants: [
            "Oi {{nome}}, tudo bem? Dá uma olhada nesta oportunidade incrível: {{__url_immutable_0__}}",
            "Olá {{nome}}! Passando para te mostrar a proposta especial que separei: {{__url_immutable_0__}}",
            "Tudo bem {{nome}}? Veja o material completo que preparamos para você aqui: {{__url_immutable_0__}}",
          ],
          rationale: "Variações humanizadas preservando token de link.",
        });
      });

      try {
        const inputUrl = "https://vexoia.com/proposta-exclusiva";
        const result = await generateCampaignTemplateVariants({
          baseText: `Olá {{nome}}, veja nossa proposta em ${inputUrl}`,
          count: 3,
        });

        expect(result.variants).toHaveLength(3);
        for (const variant of result.variants) {
          expect(variant).toContain(inputUrl);
          expect(variant).not.toContain("%20HTTPS");
          expect(variant).not.toContain("%20https");
          expect(variant).not.toContain("HTTPS://");
          expect(variant).not.toContain("{{__url_immutable_0__}}");
        }
      } finally {
        spyLlm.mockRestore();
        process.env.GROQ_API_KEY = prevKey;
      }
    });

    it("Rejeita variações da IA que tentarem corromper, mutar ou encodar a URL", async () => {
      const prevKey = process.env.GROQ_API_KEY;
      process.env.GROQ_API_KEY = "test-groq-key";

      const spyLlm = vi.spyOn(chatbotAiEngine, "callLlmChatCompletion").mockResolvedValue(
        JSON.stringify({
          variants: [
            // Variação corrompida com %20 e maiúscula
            "Oi {{nome}}, link: %20HTTPS://VEXOIA.COM/PROPOSTA",
            // Variação corrompida com protocolo alterado
            "Oi {{nome}}, link: http://vexoia.com/proposta",
            // Variação legítima que respeitou o token
            "Oi {{nome}}, veja o link completo aqui: {{__url_immutable_0__}}",
          ],
        })
      );

      try {
        const inputUrl = "https://vexoia.com/proposta";
        const result = await generateCampaignTemplateVariants({
          baseText: `Olá {{nome}}, proposta: ${inputUrl}`,
          count: 3,
        });

        // Apenas a variação que preservou a URL original íntegra deve ser aceita
        expect(result.variants).toHaveLength(1);
        expect(result.variants[0]).toBe("Oi {{nome}}, veja o link completo aqui: https://vexoia.com/proposta");
      } finally {
        spyLlm.mockRestore();
        process.env.GROQ_API_KEY = prevKey;
      }
    });
  });

  describe("2. Pipeline Completo de Montagem e Envio Outbound com URL", () => {
    it("Passo de campanha do tipo link passa pelo pipeline completo e sai idêntico no payload entregue", () => {
      const inputUrl = "https://vexoia.com/cliente/login?ref=123&origem=campanha";
      const step = {
        id: "step-1",
        type: "link",
        order: 1,
        linkUrl: inputUrl,
        text: "Olá {{nome}}, acesse seu painel aqui:",
        enabled: true,
      };

      const lead = {
        id: "lead-1",
        phone: "5511999990001",
        name: "Carlos Eduardo",
        lead_name: "Carlos Eduardo",
      };

      const payload = buildTextPayload(lead.phone, step, { lead });

      expect(payload).toBeDefined();
      expect(payload.type).toBe("text");
      expect(payload.stepType).toBe("link");
      // Garante que a URL original exata está contida no texto final sem adulteração
      expect(payload.text).toContain(inputUrl);
      expect(payload.text).not.toContain("%20");
      expect(payload.text).not.toContain("HTTPS://");
      expect(payload.text).toBe(`Olá Carlos Eduardo, acesse seu painel aqui:\n\n${inputUrl}`);
    });

    it("Passo de texto simples contendo URL preserva a URL idêntica sem modificações", () => {
      const inputUrl = "https://vexoia.com/artigo-tecnico";
      const step = {
        id: "step-1",
        type: "text",
        order: 1,
        text: `Olá {{nome}}, recomendo ler ${inputUrl} para entender mais.`,
        enabled: true,
      };

      const lead = {
        id: "lead-2",
        phone: "5511999990002",
        name: "Renata",
        lead_name: "Renata",
      };

      const payload = buildTextPayload(lead.phone, step, { lead });

      expect(payload).toBeDefined();
      expect(payload.text).toBe(`Olá Renata, recomendo ler ${inputUrl} para entender mais.`);
      expect(payload.text).toContain(inputUrl);
    });

    it("Rotação de variações de texto pré-geradas (resolveStepTextForLead) entrega a URL intacta para cada lead", () => {
      const inputUrl = "https://vexoia.com/proposta-vip";
      const step = {
        id: "step-3",
        type: "text",
        text: `Oi {{nome}}, veja: ${inputUrl}`,
        textVariants: [
          `Oi {{nome}}, veja: ${inputUrl}`,
          `Olá {{nome}}, confira a novidade: ${inputUrl}`,
          `Tudo bem {{nome}}? Separei isto para você: ${inputUrl}`,
        ],
      };

      for (let i = 0; i < 6; i++) {
        const resolvedText = resolveStepTextForLead(step, i);
        expect(resolvedText).toContain(inputUrl);
        expect(resolvedText).not.toContain("%20");
        expect(resolvedText).not.toContain("HTTPS://");
      }
    });
  });
});
