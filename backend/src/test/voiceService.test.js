import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateSpeechAudio,
  resolveVoiceDecision,
  isSupportedVoice,
  SUPPORTED_VOICES,
  splitTextIntoChunks,
} from "../services/voiceService.js";

describe("voiceService — Motor Nativo Google Speech HTTP MP3 (pt-BR)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Regras de Decisão de Voz (resolveVoiceDecision)", () => {
    it("mantém voz desativada (false) quando voiceMode = 'disabled', mesmo se lead mandou áudio", () => {
      expect(resolveVoiceDecision({ voiceMode: "disabled", leadSentAudio: true })).toBe(false);
      expect(resolveVoiceDecision({ voiceMode: "disabled", leadSentAudio: false })).toBe(false);
    });

    it("ativa voz (true) no modo 'mirror' APENAS quando o lead enviou áudio", () => {
      expect(resolveVoiceDecision({ voiceMode: "mirror", leadSentAudio: true })).toBe(true);
      expect(resolveVoiceDecision({ voiceMode: "mirror", leadSentAudio: false })).toBe(false);
    });

    it("ativa voz (true) no modo 'always' independente do formato da mensagem do lead", () => {
      expect(resolveVoiceDecision({ voiceMode: "always", leadSentAudio: false })).toBe(true);
      expect(resolveVoiceDecision({ voiceMode: "always", leadSentAudio: true })).toBe(true);
    });

    it("assume 'disabled' como padrão seguro quando parâmetros forem nulos ou inválidos", () => {
      expect(resolveVoiceDecision()).toBe(false);
      expect(resolveVoiceDecision({ voiceMode: null, leadSentAudio: true })).toBe(false);
      expect(resolveVoiceDecision({ voiceMode: "desconhecido", leadSentAudio: true })).toBe(false);
    });
  });

  describe("2. Catálogo e Validação de Vozes", () => {
    it("reconhece as 6 vozes neurais canônicas", () => {
      const canonical = ["nova", "echo", "shimmer", "alloy", "onyx", "fable"];
      for (const v of canonical) {
        expect(isSupportedVoice(v)).toBe(true);
        expect(isSupportedVoice(v.toUpperCase())).toBe(true);
      }
      expect(SUPPORTED_VOICES.length).toBe(6);
    });

    it("rejeita vozes inválidas ou inexistentes", () => {
      expect(isSupportedVoice("voz_inventada")).toBe(false);
      expect(isSupportedVoice("")).toBe(false);
      expect(isSupportedVoice(null)).toBe(false);
    });
  });

  describe("3. Divisão de Texto em Chunks (splitTextIntoChunks)", () => {
    it("divide frases longas respeitando o limite sem cortar palavras ao meio", () => {
      const longText = "Esta é uma frase de teste com várias palavras longas e descrições detalhadas para verificar a divisão inteligente em partes menores para síntese de voz.";
      const chunks = splitTextIntoChunks(longText, 50);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(50);
      }
      expect(chunks.join(" ")).toBe(longText);
    });

    it("retorna array vazio para texto vazio", () => {
      expect(splitTextIntoChunks("")).toEqual([]);
      expect(splitTextIntoChunks("   ")).toEqual([]);
      expect(splitTextIntoChunks(null)).toEqual([]);
    });
  });

  describe("4. Síntese de Áudio HTTP MP3 (generateSpeechAudio)", () => {
    it("retorna null se o texto for vazio ou conter apenas espaços", async () => {
      const res1 = await generateSpeechAudio({ text: "" });
      const res2 = await generateSpeechAudio({ text: "   \n\t  " });
      const res3 = await generateSpeechAudio({ text: null });
      expect(res1).toBeNull();
      expect(res2).toBeNull();
      expect(res3).toBeNull();
    });

    it("executa requisição HTTP para o Google TTS e retorna MP3 em base64", async () => {
      const chunkBytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => chunkBytes.buffer,
      });
      global.fetch = fetchMock;

      const result = await generateSpeechAudio({
        text: "Olá! Como posso ajudar você hoje?",
        voice: "nova",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain("https://translate.google.com/translate_tts");
      expect(url).toContain("tl=pt-BR");
      expect(url).toContain("client=tw-ob");
      expect(options.headers["User-Agent"]).toContain("Mozilla/5.0");

      expect(result).not.toBeNull();
      expect(result.mimetype).toBe("audio/mpeg");
      expect(result.format).toBe("mp3");
      expect(result.base64).toBe(Buffer.from(chunkBytes).toString("base64"));
    });

    it("Fallback de Ouro: retorna null quando a API retorna erro HTTP sem estourar exceção", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      });
      global.fetch = fetchMock;

      const result = await generateSpeechAudio({
        text: "Teste de erro",
      });

      expect(result).toBeNull();
    });

    it("Fallback de Ouro: retorna null quando ocorre erro de rede ou timeout", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("Timeout"));
      global.fetch = fetchMock;

      const result = await generateSpeechAudio({
        text: "Teste de timeout",
      });

      expect(result).toBeNull();
    });
  });
});
