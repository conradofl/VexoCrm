import { describe, expect, it } from "vitest";
import { buildPhoneLookupVariants } from "../services/leadImport.js";
import { extractTextFromBody, detectMessageType } from "../chatbot-ai-engine.js";

describe("TAREFA CONSOLIDADA: Validações Automatizadas", () => {
  describe("PARTE 1: Blindagem de Exclusão e Restauração de Campanhas (Coluna updated_at)", () => {
    it("simula fallback quando coluna updated_at não existe (código 42703)", async () => {
      // Simulação da lógica defensiva implementada nos handlers
      let updateCalls = [];
      const fakeSupabase = {
        from: (table) => ({
          update: (payload) => ({
            eq: (col1, val1) => ({
              eq: async (col2, val2) => {
                updateCalls.push({ table, payload, col1, val1, col2, val2 });
                if (payload.updated_at) {
                  const err = new Error('column "updated_at" of relation "campaigns" does not exist');
                  err.code = "42703";
                  throw err;
                }
                return { error: null };
              },
            }),
          }),
        }),
      };

      const campaignId = "camp-test-123";
      const clientId = "tenant-test";
      const archivePayload = { status: "archived", updated_at: new Date().toISOString() };

      let success = false;
      try {
        await fakeSupabase.from("campaigns").update(archivePayload).eq("id", campaignId).eq("client_id", clientId);
        success = true;
      } catch (err) {
        if (err.code === "42703" || err.message?.includes("updated_at")) {
          const fallbackPayload = { ...archivePayload };
          delete fallbackPayload.updated_at;
          const res = await fakeSupabase.from("campaigns").update(fallbackPayload).eq("id", campaignId).eq("client_id", clientId);
          if (!res.error) success = true;
        }
      }

      expect(success).toBe(true);
      expect(updateCalls.length).toBe(2);
      expect(updateCalls[0].payload.updated_at).toBeDefined();
      expect(updateCalls[1].payload.updated_at).toBeUndefined();
      expect(updateCalls[1].payload.status).toBe("archived");
    });
  });

  describe("PARTE 2: Eliminação de Mensagens 'unknown' no Webhook", () => {
    it("extrai texto de imageMessage com caption", () => {
      const payload = {
        data: {
          message: {
            imageMessage: { caption: "Veja nosso catálogo!", url: "https://r2.storage/foto.jpg" },
          },
        },
      };
      expect(detectMessageType(payload)).toBe("image");
      expect(extractTextFromBody(payload)).toBe("Veja nosso catálogo!");
    });

    it("extrai fallback '[Imagem]' quando imageMessage não tem caption", () => {
      const payload = {
        data: {
          message: {
            imageMessage: { url: "https://r2.storage/foto.jpg" },
          },
        },
      };
      expect(detectMessageType(payload)).toBe("image");
      expect(extractTextFromBody(payload)).toBe("[Imagem]");
    });

    it("extrai texto de videoMessage", () => {
      const payload = {
        data: {
          message: {
            videoMessage: { caption: "Vídeo explicativo" },
          },
        },
      };
      expect(detectMessageType(payload)).toBe("video");
      expect(extractTextFromBody(payload)).toBe("Vídeo explicativo");
    });

    it("extrai fallback '[Vídeo]' quando videoMessage não tem caption", () => {
      const payload = {
        data: {
          message: {
            videoMessage: {},
          },
        },
      };
      expect(detectMessageType(payload)).toBe("video");
      expect(extractTextFromBody(payload)).toBe("[Vídeo]");
    });

    it("extrai '[Áudio]' para áudio e ptt", () => {
      const payload = {
        data: {
          message: {
            audioMessage: { mimetype: "audio/ogg" },
          },
        },
      };
      expect(detectMessageType(payload)).toBe("audio");
      expect(extractTextFromBody(payload)).toBe("[Áudio]");
    });

    it("extrai fileName ou caption de documentMessage", () => {
      const payload = {
        data: {
          message: {
            documentMessage: { fileName: "tabela_precos.pdf" },
          },
        },
      };
      expect(detectMessageType(payload)).toBe("document");
      expect(extractTextFromBody(payload)).toBe("tabela_precos.pdf");
    });

    it("extrai texto de extendedTextMessage", () => {
      const payload = {
        data: {
          message: {
            extendedTextMessage: { text: "Olá, tenho interesse no imóvel!" },
          },
        },
      };
      expect(detectMessageType(payload)).toBe("text");
      expect(extractTextFromBody(payload)).toBe("Olá, tenho interesse no imóvel!");
    });

    it("extrai selectedDisplayText de buttonsResponseMessage", () => {
      const payload = {
        data: {
          message: {
            buttonsResponseMessage: { selectedDisplayText: "Sim, quero agendar" },
          },
        },
      };
      expect(detectMessageType(payload)).toBe("interactive");
      expect(extractTextFromBody(payload)).toBe("Sim, quero agendar");
    });

    it("extrai selectedDisplayText de templateButtonReplyMessage", () => {
      const payload = {
        data: {
          message: {
            templateButtonReplyMessage: { selectedDisplayText: "Falar com atendente" },
          },
        },
      };
      expect(detectMessageType(payload)).toBe("interactive");
      expect(extractTextFromBody(payload)).toBe("Falar com atendente");
    });

    it("extrai title e description de listResponseMessage", () => {
      const payload = {
        data: {
          message: {
            listResponseMessage: { title: "Opção 1", description: "Consórcio Imobiliário" },
          },
        },
      };
      expect(detectMessageType(payload)).toBe("interactive");
      expect(extractTextFromBody(payload)).toBe("Opção 1 - Consórcio Imobiliário");
    });

    it("nunca devolve 'unknown' nem string vazia quando WhatsApp envia conteúdo desconhecido", () => {
      const payload1 = { message: "unknown" };
      expect(extractTextFromBody(payload1)).toBe("[Mensagem]");

      const payload2 = { data: { message: {} } };
      expect(extractTextFromBody(payload2)).toBe("[Mensagem]");
    });
  });

  describe("PARTE 2: Unificação do Histórico com/sem 9º Dígito Brasileiro", () => {
    it("expande número de 12 dígitos (553484400049) para incluir a variação com o 9º dígito (5534984400049)", () => {
      const variants = buildPhoneLookupVariants("553484400049");
      expect(variants).toContain("553484400049");
      expect(variants).toContain("5534984400049");
      expect(variants).toContain("+5534984400049");
    });

    it("expande número de 13 dígitos (5534984400049) para incluir a variação sem o 9º dígito (553484400049)", () => {
      const variants = buildPhoneLookupVariants("5534984400049");
      expect(variants).toContain("5534984400049");
      expect(variants).toContain("553484400049");
      expect(variants).toContain("+553484400049");
    });

    it("expande chatId com JID (553484400049@s.whatsapp.net) para cobrir tanto o número cru quanto as variações com/sem 9", () => {
      const chatId = "553484400049@s.whatsapp.net";
      const rawDigits = chatId.replace(/\D/g, "");
      const baseSet = new Set([chatId, rawDigits, ...buildPhoneLookupVariants(rawDigits)]);
      if (rawDigits.startsWith("55") && rawDigits.length === 12) {
        const ddd = rawDigits.slice(2, 4);
        const rest = rawDigits.slice(4);
        baseSet.add(`55${ddd}9${rest}`);
        baseSet.add(`+55${ddd}9${rest}`);
      }

      const list = Array.from(baseSet);
      for (const v of list) {
        if (!v.includes("@")) {
          baseSet.add(`${v}@s.whatsapp.net`);
          baseSet.add(`${v}@c.us`);
        }
      }

      const phoneVariants = Array.from(baseSet);
      expect(phoneVariants).toContain("553484400049");
      expect(phoneVariants).toContain("5534984400049");
      expect(phoneVariants).toContain("553484400049@s.whatsapp.net");
      expect(phoneVariants).toContain("5534984400049@s.whatsapp.net");
    });
  });
});
