import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateSpeechAudio,
  resolveVoiceDecision,
  isSupportedVoice,
  SUPPORTED_VOICES,
  GEMINI_VOICE_MAP,
  splitTextIntoChunks,
} from "../services/voiceService.js";

describe("voiceService — Síntese Multimodal Gemini 2.0 Audio & Fallback Nativo (pt-BR)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
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

  describe("2. Catálogo e Mapeamento de Vozes Gemini (GEMINI_VOICE_MAP)", () => {
    it("reconhece as 6 vozes neurais canônicas", () => {
      const canonical = ["nova", "echo", "shimmer", "alloy", "onyx", "fable"];
      for (const v of canonical) {
        expect(isSupportedVoice(v)).toBe(true);
        expect(isSupportedVoice(v.toUpperCase())).toBe(true);
      }
      expect(SUPPORTED_VOICES.length).toBe(6);
    });

    it("mapeia corretamente as vozes femininas e masculinas distintas para os atores do Gemini", () => {
      expect(GEMINI_VOICE_MAP.nova).toBe("Aoede");     // Feminina Expressiva
      expect(GEMINI_VOICE_MAP.echo).toBe("Charon");    // Masculina Natural
      expect(GEMINI_VOICE_MAP.shimmer).toBe("Kore");   // Feminina Suave
      expect(GEMINI_VOICE_MAP.alloy).toBe("Puck");     // Neutra / Dinâmica
      expect(GEMINI_VOICE_MAP.onyx).toBe("Fenrir");    // Masculina Corporativa
      expect(GEMINI_VOICE_MAP.fable).toBe("Aoede");    // Expressiva
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

  describe("4. Síntese com Google Gemini 2.0 Audio (Multimodal)", () => {
    it("chama o endpoint gemini-2.0-flash com voz masculina (Charon) quando voice='echo'", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";

      const mockBase64Audio = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "audio/wav",
                      data: mockBase64Audio,
                    },
                  },
                ],
              },
            },
          ],
        }),
      });
      global.fetch = fetchMock;

      const result = await generateSpeechAudio({
        text: "Olá! Aqui é o consultor comercial.",
        voice: "echo",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=test-gemini-key");
      expect(options.method).toBe("POST");

      const body = JSON.parse(options.body);
      expect(body.generationConfig.responseModalities).toEqual(["AUDIO"]);
      expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Charon");
      expect(body.contents[0].parts[0].text).toContain("Olá! Aqui é o consultor comercial.");

      expect(result).toEqual({
        base64: mockBase64Audio,
        mimetype: "audio/wav",
        format: "wav",
      });
    });

    it("chama o endpoint com voz feminina (Aoede) quando voice='nova'", async () => {
      process.env.GOOGLE_API_KEY = "test-google-key";

      const mockBase64Audio = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "audio/wav",
                      data: mockBase64Audio,
                    },
                  },
                ],
              },
            },
          ],
        }),
      });
      global.fetch = fetchMock;

      const result = await generateSpeechAudio({
        text: "Olá! Como posso te ajudar?",
        voice: "nova",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Aoede");
      expect(result.format).toBe("wav");
      expect(result.base64).toBe(mockBase64Audio);
    });

    it("faz fallback automático para Google Speech HTTP quando Gemini falha (status != 200)", async () => {
      process.env.GEMINI_API_KEY = "test-gemini-key";

      const chunkBytes = new Uint8Array([10, 20, 30]);
      const fetchMock = vi.fn()
        // 1ª chamada: Gemini falha
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => "Rate limit exceeded",
        })
        // 2ª chamada: Fallback Google Speech tem sucesso
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          arrayBuffer: async () => chunkBytes.buffer,
        });
      global.fetch = fetchMock;

      const result = await generateSpeechAudio({
        text: "Mensagem de teste para fallback",
        voice: "onyx",
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result).not.toBeNull();
      expect(result.mimetype).toBe("audio/mpeg");
      expect(result.format).toBe("mp3");
      expect(result.base64).toBe(Buffer.from(chunkBytes).toString("base64"));
    });
  });

  describe("5. Fallback Nativo Google Speech HTTP MP3 (sem API Key)", () => {
    it("retorna null se o texto for vazio ou conter apenas espaços", async () => {
      const res1 = await generateSpeechAudio({ text: "" });
      const res2 = await generateSpeechAudio({ text: "   \n\t  " });
      const res3 = await generateSpeechAudio({ text: null });
      expect(res1).toBeNull();
      expect(res2).toBeNull();
      expect(res3).toBeNull();
    });

    it("executa requisição HTTP para o Google TTS quando não há GEMINI_API_KEY e retorna MP3 em base64", async () => {
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

