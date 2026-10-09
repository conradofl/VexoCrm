import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateSpeechAudio,
  resolveVoiceDecision,
  isSupportedVoice,
  SUPPORTED_OPENAI_VOICES,
  OPENAI_TTS_URL,
} from "../services/voiceService.js";

describe("voiceService — Marco 4: Mensageria Multimodal & Voz da IA", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
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

  describe("2. Catálogo e Validação de Vozes Suportadas", () => {
    it("reconhece as 6 vozes OpenAI canônicas", () => {
      const canonical = ["nova", "shimmer", "alloy", "echo", "onyx", "fable"];
      for (const v of canonical) {
        expect(isSupportedVoice(v)).toBe(true);
        expect(isSupportedVoice(v.toUpperCase())).toBe(true);
      }
      expect(SUPPORTED_OPENAI_VOICES.length).toBe(6);
    });

    it("rejeita vozes inválidas ou inexistentes", () => {
      expect(isSupportedVoice("voz_inventada")).toBe(false);
      expect(isSupportedVoice("")).toBe(false);
      expect(isSupportedVoice(null)).toBe(false);
    });
  });

  describe("3. Síntese de Áudio com OpenAI TTS (generateSpeechAudio)", () => {
    it("retorna null se o texto for vazio ou conter apenas espaços", async () => {
      process.env.OPENAI_API_KEY = "sk-test-key";
      const res1 = await generateSpeechAudio({ text: "" });
      const res2 = await generateSpeechAudio({ text: "   \n\t  " });
      const res3 = await generateSpeechAudio({ text: null });
      expect(res1).toBeNull();
      expect(res2).toBeNull();
      expect(res3).toBeNull();
    });

    it("retorna null de forma segura se OPENAI_API_KEY não estiver configurada no servidor", async () => {
      delete process.env.OPENAI_API_KEY;
      const res = await generateSpeechAudio({ text: "Olá cliente" });
      expect(res).toBeNull();
    });

    it("dispara requisição para OpenAI com parâmetros corretos e formato opus", async () => {
      process.env.OPENAI_API_KEY = "sk-valid-test-key";

      const uint8 = new Uint8Array([10, 20, 30, 40, 50, 60]);
      const fakeArrayBuffer = uint8.buffer;
      const expectedBase64 = Buffer.from(fakeArrayBuffer).toString("base64");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => fakeArrayBuffer,
      });
      global.fetch = fetchMock;

      const result = await generateSpeechAudio({
        text: "Olá! Como posso ajudar você hoje?",
        voice: "echo",
        speed: 1.1,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = fetchMock.mock.calls[0];

      expect(calledUrl).toBe(OPENAI_TTS_URL);
      expect(calledOptions.method).toBe("POST");
      expect(calledOptions.headers).toMatchObject({
        Authorization: "Bearer sk-valid-test-key",
        "Content-Type": "application/json",
      });

      const body = JSON.parse(calledOptions.body);
      expect(body).toEqual({
        model: "tts-1",
        input: "Olá! Como posso ajudar você hoje?",
        voice: "echo",
        response_format: "opus",
        speed: 1.1,
      });

      expect(result).not.toBeNull();
      expect(result.mimetype).toBe("audio/ogg; codecs=opus");
      expect(result.format).toBe("opus");
      expect(result.base64).toBe(expectedBase64);
    });

    it("Fallback de Ouro: retorna null sem estourar exceção quando a API da OpenAI retorna erro HTTP", async () => {
      process.env.OPENAI_API_KEY = "sk-valid-test-key";

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: { message: "Rate limit exceeded" } }),
      });
      global.fetch = fetchMock;

      const result = await generateSpeechAudio({
        text: "Teste de erro",
        voice: "nova",
      });

      expect(result).toBeNull();
    });

    it("Fallback de Ouro: retorna null quando ocorre timeout ou erro de rede", async () => {
      process.env.OPENAI_API_KEY = "sk-valid-test-key";

      const fetchMock = vi.fn().mockRejectedValue(new Error("Timeout de conexão"));
      global.fetch = fetchMock;

      const result = await generateSpeechAudio({
        text: "Teste de timeout",
        voice: "nova",
      });

      expect(result).toBeNull();
    });
  });
});
