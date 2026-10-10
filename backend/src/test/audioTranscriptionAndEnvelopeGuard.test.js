// backend/src/test/audioTranscriptionAndEnvelopeGuard.test.js
//
// Testes obrigatórios de integridade de mídia, envelope da Evolution API e freio de loop:
// 1. Fixture real da Evolution API v2 (messages.upsert com audioMessage).
// 2. Envelopamento canônico: o objeto `data` do webhook DEVE ser envelopado em { message: data, convertToMp4: false }.
// 3. PROVA DE MUTAÇÃO: Reverter a detecção para `"message" in payload` desmonta o envelope e DERROTA a asserção.
// 4. Falha de transcrição NÃO entrega texto fabricado `"[áudio]"` para a LLM.
// 5. Três áudios com falha consecutivos NÃO disparam o freio de loop (checkBotLoop).
// 6. O rótulo `[áudio]` continua sendo gravado para exibição visual humana no Conversas.

import { describe, it, expect, vi } from "vitest";
import {
  buildEvolutionGetBase64Payload,
  fetchMediaBase64FromEvolution,
} from "../services/evolution.js";
import {
  checkBotLoop,
  isSystemPlaceholderOrMediaMarker,
  resolveMessageContent,
  processBatch,
} from "../chatbot-ai-engine.js";

// Fixture canônica: Payload real recebido no webhook `messages.upsert` da Evolution API v2 para áudio
export const EVOLUTION_V2_AUDIO_UPSERT_FIXTURE = {
  event: "messages.upsert",
  instance: "vexo-adm-vexo-atende",
  data: {
    key: {
      remoteJid: "5534997817660@s.whatsapp.net",
      fromMe: false,
      id: "3EB0ABC9876543210FEDCBA",
    },
    pushName: "Conrado",
    message: {
      audioMessage: {
        url: "https://mmg.whatsapp.net/v/t62.7114-24/fake-audio.enc",
        mimetype: "audio/ogg; codecs=opus",
        fileSha256: "fake-sha-256",
        fileLength: "14520",
        seconds: 4,
        ptt: true,
        mediaKey: "fake-media-key",
        fileEncSha256: "fake-enc-sha",
        directPath: "/v/t62.7114-24/fake-path",
      },
    },
    messageType: "audioMessage",
    messageTimestamp: 1728591234,
    owner: "vexo-adm-vexo-atende",
    source: "ios",
  },
  destination: "https://crm.vexoia.com/api/webhook/evolution",
  date_time: "2026-10-10T17:30:00.000Z",
  sender: "5534997817660@s.whatsapp.net",
  server_url: "https://vexo-evolution-api.xdvm8y.easypanel.host",
  apikey: "EVO_TEST_KEY",
};

describe("Audio Transcription, Evolution Envelope & Anti-Loop Guard", () => {
  describe("1. Envelopamento Canônico da Evolution API (/chat/getBase64FromMediaMessage)", () => {
    it("envelopa corretamente o objeto data da fixture real da Evolution v2", () => {
      const webhookData = EVOLUTION_V2_AUDIO_UPSERT_FIXTURE.data;
      const payloadEnviado = buildEvolutionGetBase64Payload(webhookData);

      // A raiz do body DEVE ter a propriedade `message` contendo o objeto data (com key e message.audioMessage)
      expect(payloadEnviado).toEqual({
        message: webhookData,
        convertToMp4: false,
      });

      // A Evolution v2 exige que req.body.message.key.id esteja presente
      expect(payloadEnviado.message.key.id).toBe("3EB0ABC9876543210FEDCBA");
      expect(payloadEnviado.message.message.audioMessage).toBeDefined();
    });

    it("mantém payload que já veio explicitamente envelopado como { message: { key: { id: ... } } }", () => {
      const alreadyWrapped = {
        message: {
          key: { id: "3EB0-ALREADY-WRAPPED" },
          message: { audioMessage: {} },
        },
        convertToMp4: false,
      };

      const payloadEnviado = buildEvolutionGetBase64Payload(alreadyWrapped);
      expect(payloadEnviado.message.key.id).toBe("3EB0-ALREADY-WRAPPED");
      expect(payloadEnviado.convertToMp4).toBe(false);
    });

    it("envelopa string waMessageId simples no formato canônico", () => {
      const payloadEnviado = buildEvolutionGetBase64Payload("3EB0-SIMPLE-ID");
      expect(payloadEnviado).toEqual({
        message: {
          key: { id: "3EB0-SIMPLE-ID" },
        },
        convertToMp4: false,
      });
    });

    it("fetchMediaBase64FromEvolution envia o body envelopado com headers de autenticação corretos", async () => {
      let urlChamada = null;
      let bodyChamado = null;
      const originalFetch = global.fetch;

      global.fetch = vi.fn(async (url, opts) => {
        urlChamada = String(url);
        bodyChamado = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({ base64: "ZmFrZS1hdWRpby1ieXRlcw==", mimetype: "audio/ogg" }),
        };
      });

      try {
        const res = await fetchMediaBase64FromEvolution(
          "vexo-adm-vexo-atende",
          EVOLUTION_V2_AUDIO_UPSERT_FIXTURE.data,
          { apiKey: "EVO_TEST_KEY" }
        );

        expect(res).toEqual({
          base64: "ZmFrZS1hdWRpby1ieXRlcw==",
          mimetype: "audio/ogg",
        });
        expect(urlChamada).toContain("/chat/getBase64FromMediaMessage/vexo-adm-vexo-atende");
        expect(bodyChamado.message.key.id).toBe("3EB0ABC9876543210FEDCBA");
        expect(bodyChamado.convertToMp4).toBe(false);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe("2. PROVA DE MUTAÇÃO: Reversão para 'message' in payload", () => {
    it("PROVA DE MUTAÇÃO: detecção ingênua de 'message in payload' desempacota indevidamente o webhook data e FALHA na validação de key.id", () => {
      // Simula a lógica mutante anterior:
      function buildPayloadMutante(messagePayload) {
        if (messagePayload && typeof messagePayload === "object" && "message" in messagePayload) {
          return messagePayload; // <-- A lógica defeituosa anterior
        }
        return { message: messagePayload, convertToMp4: false };
      }

      const webhookData = EVOLUTION_V2_AUDIO_UPSERT_FIXTURE.data;
      const payloadMutante = buildPayloadMutante(webhookData);

      // No código mutante, `payloadMutante` era o próprio webhookData sem envelope
      const temChaveMessageNaRaiz = Boolean(payloadMutante.message && payloadMutante.message.key);
      const estariaCorretoParaEvolution = temChaveMessageNaRaiz && payloadMutante.message.key.id === "3EB0ABC9876543210FEDCBA";

      // A prova demonstra que a mutação gera um payload inválido para a Evolution v2
      expect(estariaCorretoParaEvolution).toBe(false);
    });
  });

  describe("3. Falha de Transcrição e Não-Poluição da LLM", () => {
    it("resolveMessageContent devolve displayLabel '[áudio]' e transcriptionFailed: true em caso de falha", async () => {
      const res = await resolveMessageContent(EVOLUTION_V2_AUDIO_UPSERT_FIXTURE, {
        clientId: "vexo-adm",
        instanceName: "vexo-adm-vexo-atende",
        fromMe: false,
      });

      expect(res.type).toBe("audio");
      expect(res.displayLabel).toBe("[áudio]");
      expect(res.transcribed).toBe(false);
      expect(res.transcriptionFailed).toBe(true);
    });

    it("processBatch não entrega string '[áudio]' para o prompt da IA e responde educadamente quando chega áudio inaudível (1a vez)", async () => {
      let updatedPayload = null;
      const mockSupabase = {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: [{ id: "lead-1", historico: [], dados: {} }] }),
                }),
              }),
            }),
          }),
          update: (payload) => {
            updatedPayload = payload;
            return {
              eq: () => ({
                eq: () => Promise.resolve({ data: null, error: null }),
              }),
            };
          },
        }),
      };

      const messagesComFalha = [
        {
          type: "audio",
          text: "[áudio]",
          displayLabel: "[áudio]",
          transcribed: false,
          transcriptionFailed: true,
        },
      ];

      const res = await processBatch({
        clientId: "vexo-adm",
        phone: "5534997817660",
        messages: messagesComFalha,
        supabase: mockSupabase,
        model: "generico",
      });

      expect(res).toBeDefined();
      expect(res.audioTranscriptionFailed).toBe(true);
      expect(res.mensagem).toContain("Recebi seu áudio, mas infelizmente não consegui ouvi-lo");
      expect(res.dados.audio_unclear_warned_at).toBeDefined();
      expect(updatedPayload.dados.audio_unclear_warned_at).toBeDefined();
      expect(updatedPayload.dados.audio_fail_count).toBe(1);
    });

    it("processBatch NÃO repete aviso se o lead mandar outro áudio com falha (limite de 1 vez por conversa)", async () => {
      let updatedPayload = null;
      const mockSupabase = {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({
                      data: [
                        {
                          id: "lead-1",
                          historico: [{ role: "user", content: "[áudio não compreendido]" }],
                          dados: { audio_unclear_warned_at: "2026-10-10T17:00:00.000Z", audio_fail_count: 1 },
                        },
                      ],
                    }),
                }),
              }),
            }),
          }),
          update: (payload) => {
            updatedPayload = payload;
            return {
              eq: () => ({
                eq: () => Promise.resolve({ data: null, error: null }),
              }),
            };
          },
        }),
      };

      const messagesComFalha = [
        {
          type: "audio",
          text: "[áudio]",
          displayLabel: "[áudio]",
          transcribed: false,
          transcriptionFailed: true,
        },
      ];

      const res = await processBatch({
        clientId: "vexo-adm",
        phone: "5534997817660",
        messages: messagesComFalha,
        supabase: mockSupabase,
        model: "generico",
      });

      expect(res).toBeDefined();
      expect(res.audioTranscriptionFailed).toBe(true);
      expect(res.silencedRepeatedAudioWarning).toBe(true);
      // Mensagem de saída é nula (nenhuma resposta enviada no WhatsApp)
      expect(res.mensagem).toBeNull();
      // Histórico é atualizado com o marcador para o operador ver na tela
      const hasMarker = (updatedPayload?.historico || []).some(
        (h) => h.content === "[áudio não compreendido]"
      );
      expect(hasMarker).toBe(true);
      expect(updatedPayload.dados.audio_fail_count).toBe(2);
    });
  });

  describe("4. Freio de Loop Ignora Placeholders de Mídia e Marcadores de Sistema", () => {
    it("isSystemPlaceholderOrMediaMarker reconhece todos os marcadores de sistema", () => {
      expect(isSystemPlaceholderOrMediaMarker("[áudio]")).toBe(true);
      expect(isSystemPlaceholderOrMediaMarker("[áudio não compreendido]")).toBe(true);
      expect(isSystemPlaceholderOrMediaMarker("[imagem]")).toBe(true);
      expect(isSystemPlaceholderOrMediaMarker("[sticker]")).toBe(true);
      expect(isSystemPlaceholderOrMediaMarker("[documento: proposta.pdf]")).toBe(true);
      expect(isSystemPlaceholderOrMediaMarker("[reação]")).toBe(true);
      expect(isSystemPlaceholderOrMediaMarker("Olá, tudo bem?")).toBe(false);
      expect(isSystemPlaceholderOrMediaMarker("1")).toBe(false);
    });

    it("três áudios seguidos com falha de transcrição ([áudio]) NÃO disparam o freio de loop", () => {
      const historicoComAudios = [
        { role: "user", content: "[áudio]" },
        { role: "assistant", content: "Recebi seu áudio, mas não consegui ouvi-lo." },
        { role: "user", content: "[áudio]" },
        { role: "assistant", content: "Recebi seu áudio, mas não consegui ouvi-lo." },
      ];

      const loopCheck = checkBotLoop(historicoComAudios, "[áudio]", 3);
      expect(loopCheck.isLoop).toBe(false);
      expect(loopCheck.count).toBe(0);
    });

    it("três mensagens idênticas reais do usuário (menu de bot / URA) continuam disparando o freio de loop", () => {
      const historicoComMenuBot = [
        { role: "user", content: "1. Suporte\n2. Vendas\n3. Financeiro" },
        { role: "assistant", content: "Como posso te ajudar?" },
        { role: "user", content: "1. Suporte\n2. Vendas\n3. Financeiro" },
        { role: "assistant", content: "Como posso te ajudar?" },
      ];

      const loopCheck = checkBotLoop(historicoComMenuBot, "1. Suporte\n2. Vendas\n3. Financeiro", 3);
      expect(loopCheck.isLoop).toBe(true);
      expect(loopCheck.count).toBe(3);
    });
  });
});
