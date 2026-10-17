import { describe, it, expect, vi } from "vitest";
import {
  normalizeCampaignAnalyticsMeta,
  validateCampaignAnalyticsMeta,
  getEnabledCampaignSteps,
} from "../campaign-outbound.js";
import { sendTextMessageViaEvolution } from "../services/evolution.js";

describe("Link Preview Nativo e Passo de Envio de Link", () => {
  describe("Normalização e Validação de Passos do Tipo Link", () => {
    it("Normaliza passo do tipo 'link' preservando linkUrl e tipo", () => {
      const rawMeta = {
        sequence: [
          {
            id: "step-link-1",
            type: "link",
            order: 1,
            linkUrl: "https://vexo.com.br/proposta-comercial",
            text: "Olá {{nome}}, veja nossa proposta exclusiva:",
            enabled: true,
          },
        ],
      };

      const normalized = normalizeCampaignAnalyticsMeta(rawMeta);
      expect(normalized.sequence).toHaveLength(1);
      const step = normalized.sequence[0];
      expect(step.type).toBe("link");
      expect(step.linkUrl).toBe("https://vexo.com.br/proposta-comercial");
      expect(step.text).toBe("Olá {{nome}}, veja nossa proposta exclusiva:");
    });

    it("Valida que passo do tipo 'link' sem linkUrl é reprovado", () => {
      const rawMeta = {
        sequence: [
          {
            id: "step-link-empty",
            type: "link",
            order: 1,
            linkUrl: "",
            text: "Acesse nosso link",
            enabled: true,
          },
        ],
      };

      const validation = validateCampaignAnalyticsMeta(rawMeta);
      expect(validation.valid).toBe(false);
      expect(validation.message).toContain("precisa de uma URL de link valida para envio");
    });

    it("Valida que passo do tipo 'link' com linkUrl válido é aprovado", () => {
      const rawMeta = {
        sequence: [
          {
            id: "step-link-valid",
            type: "link",
            order: 1,
            linkUrl: "https://vexo.com.br/demo",
            text: "Confira nossa demo",
            enabled: true,
          },
        ],
      };

      const validation = validateCampaignAnalyticsMeta(rawMeta);
      expect(validation.valid).toBe(true);
    });
  });

  describe("sendTextMessageViaEvolution com detecção automática de Link Preview", () => {
    it("Envia payload com linkPreview: true e generateHighQualityLinkPreview: true quando o texto tem URL", async () => {
      const originalFetch = global.fetch;
      let capturedPayload = null;
      let capturedUrl = null;

      global.fetch = vi.fn(async (url, opts) => {
        capturedUrl = url;
        capturedPayload = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ key: { id: "wa-msg-123" } }),
        };
      });

      try {
        const result = await sendTextMessageViaEvolution({
          instanceName: "chip-vendas",
          number: "5511999990001",
          text: "Olá, segue o catálogo: https://vexo.com.br/catalogo",
          webhookToken: "test-token",
          baseUrl: "https://evo.test.vexo.com",
        });

        expect(result.success).toBe(true);
        expect(result.waMessageId).toBe("wa-msg-123");
        expect(capturedUrl).toBe("https://evo.test.vexo.com/message/sendText/chip-vendas");
        expect(capturedPayload.linkPreview).toBe(true);
        expect(capturedPayload.generateHighQualityLinkPreview).toBe(true);
        expect(capturedPayload.options.linkPreview).toBe(true);
        expect(capturedPayload.options.generateHighQualityLinkPreview).toBe(true);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it("Envia payload com linkPreview: false quando o texto não contém URL", async () => {
      const originalFetch = global.fetch;
      let capturedPayload = null;

      global.fetch = vi.fn(async (url, opts) => {
        capturedPayload = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ key: { id: "wa-msg-456" } }),
        };
      });

      try {
        const result = await sendTextMessageViaEvolution({
          instanceName: "chip-atendimento",
          number: "5511999990002",
          text: "Olá! Tudo bem com você?",
          webhookToken: "test-token",
          baseUrl: "https://evo.test.vexo.com",
        });

        expect(result.success).toBe(true);
        expect(capturedPayload.linkPreview).toBe(false);
        expect(capturedPayload.generateHighQualityLinkPreview).toBe(false);
        expect(capturedPayload.options.linkPreview).toBe(false);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
