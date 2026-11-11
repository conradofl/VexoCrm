// backend/src/test/magicCampaignCreator.test.js
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  generateMagicCampaign,
  getFallbackMagicCampaign,
} from "../services/magicCampaignCreator.js";
import * as chatbotEngine from "../chatbot-ai-engine.js";
import { formatStepTextWithButtons } from "../campaign-outbound.js";

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
      expect(result.steps[1].buttons[0].displayText).toBe("Quero conferir");
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

  describe("opções de resposta sem numeração própria: quem numera é a montagem da mensagem", () => {
    const opcoesDaIa = async (rotulos) => {
      const buttons = rotulos.map((r) => ({ type: "reply", displayText: r, replyText: r }));
      vi.spyOn(chatbotEngine, "callLlmChatCompletion").mockResolvedValue(
        JSON.stringify({ steps: [{ text: "a" }, { text: "b", buttons }, { text: "c" }] })
      );
      const result = await generateMagicCampaign({ prompt: "x" });
      return result.steps[1].buttons;
    };

    it.each([
      ["1 - Quero aproveitar", "2 - Agora não"],
      ["1- Quero aproveitar", "2- Agora não"],
      ["1-Quero aproveitar", "2-Agora não"],
      ["1 Quero aproveitar", "2 Agora não"],
      ["1. Quero aproveitar", "2. Agora não"],
      ["1) Quero aproveitar", "2) Agora não"],
      ["1 – Quero aproveitar", "2 — Agora não"],
    ])("(a) IA devolve %j e %j: salva sem número, nos dois campos", async (um, dois) => {
      const buttons = await opcoesDaIa([um, dois]);

      expect(buttons.map((b) => b.displayText)).toEqual(["Quero aproveitar", "Agora não"]);
      expect(buttons.map((b) => b.replyText)).toEqual(["Quero aproveitar", "Agora não"]);
    });

    it("(a) o lead recebe uma numeração só", async () => {
      const buttons = await opcoesDaIa(["1 - Quero aproveitar", "2 - Agora não"]);
      const texto = formatStepTextWithButtons("Oferta", buttons);

      expect(texto).toContain("1. Quero aproveitar");
      expect(texto).toContain("2. Agora não");
      expect(texto).not.toMatch(/\d\.\s*\d/);
    });

    it("(b) IA devolve sem número: salva igual, sem comer caractere", async () => {
      const rotulos = ["Quero aproveitar", "Agora não", "Ok", "A", "Sim - quero", "Plano 2 - anual"];
      const buttons = await opcoesDaIa(rotulos);

      expect(buttons.map((b) => b.displayText)).toEqual(rotulos);
    });

    it.each([
      [["2 pessoas", "10 dias"]],
      [["1 pessoa", "2 pessoas"]],
      [["1 mês", "12 meses"]],
      [["2-3 dias", "4-5 dias"]],
      [["1.5 salário", "2.5 salários"]],
      [["24h", "48h"]],
      [["2 - 3 dias", "1 - 2 dias"]],
      [["10", "20"]],
      [["1 -", "2."]],
      [["2 Pessoas", "1 Pessoa"]],
    ])("(c) opção que começa com número de verdade não é mutilada: %j", async (rotulos) => {
      const buttons = await opcoesDaIa(rotulos);

      expect(buttons.map((b) => b.displayText)).toEqual(rotulos);
    });

    it("o limite de 30 caracteres vale depois de tirar o prefixo", async () => {
      const rotulo = "Quero garantir a minha vaga já";
      expect(rotulo).toHaveLength(30);

      const [botao] = await opcoesDaIa([`1 - ${rotulo}`, "2 - Depois"]);

      expect(botao.displayText).toBe(rotulo);
    });

    it("nenhum exemplo que a IA recebe vem numerado", async () => {
      const chamada = vi.spyOn(chatbotEngine, "callLlmChatCompletion").mockResolvedValue("{}");
      await generateMagicCampaign({ prompt: "x" });

      const sistema = chamada.mock.calls[0][0].messages[0].content;
      expect(sistema).toMatch(/"displayText": "Quero aproveitar"/);
      expect(sistema).not.toMatch(/"(displayText|replyText)": "\d/);
    });

    it.each(["imobiliaria", "estetica", "academia", "veiculos", "varejo", "b2b", "geral"])(
      "contingência do nicho %s não vem numerada",
      (niche) => {
        for (const botao of getFallbackMagicCampaign({ niche }).steps[1].buttons) {
          expect(botao.displayText).not.toMatch(/^\d/);
          expect(botao.replyText).not.toMatch(/^\d/);
        }
      }
    );
  });
});
