import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateSpeechAudio,
  resolveVoiceDecision,
  isSupportedVoice,
  SUPPORTED_VOICES,
  GOOGLE_NEURAL_VOICES,
  GEMINI_VOICE_MAP,
  splitTextIntoChunks,
} from "../services/voiceService.js";

describe("voiceService — Síntese Multimodal Google Neural TTS, Gemini 2.0 Audio & Fallback Nativo (pt-BR)", () => {
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

  describe("2. Catálogo e Mapeamento de Vozes Neurais (GOOGLE_NEURAL_VOICES & GEMINI_VOICE_MAP)", () => {
    it("reconhece as 6 vozes neurais canônicas", () => {
      const canonical = ["nova", "echo", "shimmer", "alloy", "onyx", "fable"];
      for (const v of canonical) {
        expect(isSupportedVoice(v)).toBe(true);
        expect(isSupportedVoice(v.toUpperCase())).toBe(true);
      }
      expect(SUPPORTED_VOICES.length).toBe(6);
    });

    it("mapeia vozes neurais brasileiras com distinção de gênero para Google Cloud Neural TTS", () => {
      expect(GOOGLE_NEURAL_VOICES.nova).toEqual({ name: "pt-BR-Neural2-A", gender: "FEMALE" });
      expect(GOOGLE_NEURAL_VOICES.echo).toEqual({ name: "pt-BR-Neural2-B", gender: "MALE" });
      expect(GOOGLE_NEURAL_VOICES.shimmer).toEqual({ name: "pt-BR-Neural2-C", gender: "FEMALE" });
      expect(GOOGLE_NEURAL_VOICES.alloy).toEqual({ name: "pt-BR-Wavenet-A", gender: "FEMALE" });
      expect(GOOGLE_NEURAL_VOICES.onyx).toEqual({ name: "pt-BR-Wavenet-B", gender: "MALE" });
      expect(GOOGLE_NEURAL_VOICES.fable).toEqual({ name: "pt-BR-Wavenet-C", gender: "FEMALE" });
    });

    it("mapeia atores neurais do Google Gemini", () => {
      expect(GEMINI_VOICE_MAP.nova).toBe("Aoede");
      expect(GEMINI_VOICE_MAP.echo).toBe("Charon");
      expect(GEMINI_VOICE_MAP.shimmer).toBe("Kore");
      expect(GEMINI_VOICE_MAP.alloy).toBe("Puck");
      expect(GEMINI_VOICE_MAP.onyx).toBe("Fenrir");
      expect(GEMINI_VOICE_MAP.fable).toBe("Aoede");
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

  describe("4. Tentativa 0: OpenAI TTS (quando OPENAI_API_KEY configurada)", () => {
    it("sintetiza via OpenAI TTS com voz masculina 'echo'", async () => {
      process.env.OPENAI_API_KEY = "test-openai-key";

      const mockMp3Bytes = new Uint8Array([79, 103, 103, 83]);
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => mockMp3Bytes.buffer,
      });
      global.fetch = fetchMock;

      const result = await generateSpeechAudio({
        text: "Olá! Teste com OpenAI TTS.",
        voice: "echo",
        speed: 1.05,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.openai.com/v1/audio/speech");
      expect(options.headers.Authorization).toBe("Bearer test-openai-key");

      const body = JSON.parse(options.body);
      expect(body.model).toBe("tts-1");
      expect(body.voice).toBe("echo");
      expect(body.speed).toBe(1.05);

      expect(result).toEqual({
        base64: Buffer.from(mockMp3Bytes).toString("base64"),
        mimetype: "audio/mpeg",
        format: "mp3",
      });
    });
  });

  describe("5. Tentativa 1: Google Cloud Neural TTS (texttospeech.googleapis.com)", () => {
    it("sintetiza com voz masculina (pt-BR-Neural2-B / MALE) quando voice='echo'", async () => {
      process.env.GEMINI_API_KEY = "test-api-key";

      const mockBase64Mp3 = "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          audioContent: mockBase64Mp3,
        }),
      });
      global.fetch = fetchMock;

      const result = await generateSpeechAudio({
        text: "Olá! Sou o consultor virtual da empresa.",
        voice: "echo",
        speed: 1.1,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://texttospeech.googleapis.com/v1/text:synthesize?key=test-api-key");
      expect(options.method).toBe("POST");

      const body = JSON.parse(options.body);
      expect(body.input.text).toBe("Olá! Sou o consultor virtual da empresa.");
      expect(body.voice.name).toBe("pt-BR-Neural2-B");
      expect(body.voice.ssmlGender).toBe("MALE");
      expect(body.voice.languageCode).toBe("pt-BR");
      expect(body.audioConfig.audioEncoding).toBe("MP3");
      expect(body.audioConfig.speakingRate).toBe(1.1);

      expect(result).toEqual({
        base64: mockBase64Mp3,
        mimetype: "audio/mpeg",
        format: "mp3",
      });
    });

    it("sintetiza com voz feminina (pt-BR-Neural2-A / FEMALE) quando voice='nova'", async () => {
      process.env.GOOGLE_API_KEY = "test-google-key";

      const mockBase64Mp3 = "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          audioContent: mockBase64Mp3,
        }),
      });
      global.fetch = fetchMock;

      const result = await generateSpeechAudio({
        text: "Olá! Como posso ajudar você hoje?",
        voice: "nova",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.voice.name).toBe("pt-BR-Neural2-A");
      expect(body.voice.ssmlGender).toBe("FEMALE");

      expect(result).toEqual({
        base64: mockBase64Mp3,
        mimetype: "audio/mpeg",
        format: "mp3",
      });
    });
  });

  describe("5. Tentativa 2: Gemini 2.0 Audio (quando Neural TTS falha)", () => {
    it("faz fallback para Gemini 2.0 Audio quando Google Neural TTS retorna erro", async () => {
      process.env.GEMINI_API_KEY = "test-api-key";

      const mockGeminiAudio = "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
      const fetchMock = vi.fn()
        // 1ª chamada: Google Neural TTS falha (403 Forbidden)
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: async () => "TTS API not enabled",
        })
        // 2ª chamada: Gemini 2.0 Audio tem sucesso
        .mockResolvedValueOnce({
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
                        data: mockGeminiAudio,
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
        text: "Olá! Testando fallback para Gemini Audio.",
        voice: "echo",
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [urlTts] = fetchMock.mock.calls[0];
      const [urlGemini, optionsGemini] = fetchMock.mock.calls[1];

      expect(urlTts).toContain("texttospeech.googleapis.com");
      expect(urlGemini).toContain("generativelanguage.googleapis.com");

      const geminiBody = JSON.parse(optionsGemini.body);
      expect(geminiBody.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Charon");

      expect(result).toEqual({
        base64: mockGeminiAudio,
        mimetype: "audio/wav",
        format: "wav",
      });
    });
  });

  describe("6. Fallback Nativo Google Speech HTTP MP3 (sem API Key ou após falhas)", () => {
    it("retorna null se o texto for vazio ou conter apenas espaços", async () => {
      const res1 = await generateSpeechAudio({ text: "" });
      const res2 = await generateSpeechAudio({ text: "   \n\t  " });
      const res3 = await generateSpeechAudio({ text: null });
      expect(res1).toBeNull();
      expect(res2).toBeNull();
      expect(res3).toBeNull();
    });

    it("executa requisição HTTP para o Google TTS quando não há API Key e retorna MP3 em base64", async () => {
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

    it("cai para o fallback Google Speech HTTP se tanto Neural TTS quanto Gemini falharem", async () => {
      process.env.GEMINI_API_KEY = "test-api-key";
      process.env.GEMINI_VOICE_MODEL = "gemini-custom-model";

      const chunkBytes = new Uint8Array([10, 20, 30]);
      const fetchMock = vi.fn((url) => {
        if (String(url).includes("texttospeech.googleapis.com")) {
          return Promise.resolve({
            ok: false,
            status: 500,
            text: async () => "Internal Server Error",
          });
        }
        if (String(url).includes("generativelanguage.googleapis.com")) {
          return Promise.resolve({
            ok: false,
            status: 429,
            text: async () => "Quota exceeded",
          });
        }
        if (String(url).includes("translate.google.com")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            arrayBuffer: async () => chunkBytes.buffer,
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });
      global.fetch = fetchMock;

      const result = await generateSpeechAudio({
        text: "Texto de teste para fallback completo",
        voice: "onyx",
      });

      expect(result).not.toBeNull();
      expect(result.mimetype).toBe("audio/mpeg");
      expect(result.format).toBe("mp3");
      expect(result.base64).toBe(Buffer.from(chunkBytes).toString("base64"));
    });

    it("Fallback de Ouro: retorna null quando todas as tentativas falham sem estourar exceção", async () => {
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

    it("Fallback de Ouro: retorna null quando ocorre erro de rede ou timeout geral", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("Timeout"));
      global.fetch = fetchMock;

      const result = await generateSpeechAudio({
        text: "Teste de timeout",
      });

      expect(result).toBeNull();
    });
  });
});


