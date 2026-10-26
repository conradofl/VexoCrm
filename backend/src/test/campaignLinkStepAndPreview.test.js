import { describe, it, expect, vi } from "vitest";
import {
  normalizeCampaignAnalyticsMeta,
  validateCampaignAnalyticsMeta,
  getEnabledCampaignSteps,
  buildTextPayload,
} from "../campaign-outbound.js";
import { applyMessagePlaceholders } from "../services/messagePlaceholders.js";
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

  describe("Integridade Estrita de URLs no Pipeline de Disparo (Anti-Corrupção)", () => {
    it("URL digitada pelo operador atravessa o pipeline de disparo 100% idêntica (sem uppercase, sem reencode, sem alteração)", () => {
      const originalUrl = "https://vexo.com.br/agenda-exclusiva?ref=Teste_123&utm_source=whatsApp&param=A1B2";
      const step = {
        id: "step-link-exact",
        type: "link",
        linkUrl: originalUrl,
        text: "👉 É aqui, leva 10 minutos:",
      };

      const payload = buildTextPayload("5534996541902", step, {
        lead: { nome: "Conrado", telefone: "5534996541902" },
      });

      expect(payload.text).toBe(`👉 É aqui, leva 10 minutos:\n\n${originalUrl}`);
      expect(payload.text).toContain(originalUrl);
      // Garante que não foi feito uppercase na URL nem no protocolo
      expect(payload.text).not.toContain("HTTPS://");
      expect(payload.text).not.toContain("%20HTTPS");
      expect(payload.text).not.toContain("VEXO.COM.BR");
    });

    it("Prevenção de duplicidade: https://{{scheduling_link}} com URL absoluta resolve sem 'https://https://'", () => {
      const step = {
        id: "step-sched",
        type: "link",
        linkUrl: "https://{{scheduling_link}}",
        text: "Agende sua reunião:",
      };

      const payload = buildTextPayload("5534996541902", step, {
        lead: {
          nome: "Conrado",
          scheduling_link: "https://calendly.com/consultor-spazio/15min",
        },
      });

      expect(payload.text).toBe("Agende sua reunião:\n\nhttps://calendly.com/consultor-spazio/15min");
      expect(payload.text).not.toContain("https://https://");
    });

    it("Deduplica protocolo quando template tem https:// e valor já tem https://", () => {
      const text = "Acesse o link: https://{{scheduling_link}}";
      const resolved = applyMessagePlaceholders(text, {
        scheduling_link: "https://calendly.com/consultor-spazio/15min",
      });

      expect(resolved).toBe("Acesse o link: https://calendly.com/consultor-spazio/15min");
      expect(resolved).not.toContain("https://https://");
    });
  });
});

