import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateSpeechAudio,
  resolveVoiceDecision,
  isSupportedVoice,
  SUPPORTED_OPENAI_VOICES,
  EDGE_VOICE_MAP,
} from "../services/voiceService.js";
import { EdgeTTS } from "@travisvn/edge-tts";

vi.mock("@travisvn/edge-tts", () => {
  const MockEdgeTTS = vi.fn().mockImplementation(function (text, voice, options) {
    this.text = text;
    this.voice = voice;
    this.options = options;
    this.synthesize = vi.fn().mockResolvedValue({
      audio: {
        arrayBuffer: async () => new Uint8Array([10, 20, 30, 40, 50, 60]).buffer,
      },
      subtitle: [],
    });
  });
  return { EdgeTTS: MockEdgeTTS };
});

describe("voiceService — Marco 4: Microsoft Edge Neural TTS Gratuito (pt-BR)", () => {
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

  describe("2. Catálogo e Mapeamento de Vozes PT-BR", () => {
    it("reconhece as 6 vozes neurais e mapeia para vozes pt-BR da Microsoft", () => {
      const canonical = ["nova", "echo", "shimmer", "alloy", "onyx", "fable"];
      for (const v of canonical) {
        expect(isSupportedVoice(v)).toBe(true);
        expect(isSupportedVoice(v.toUpperCase())).toBe(true);
      }
      expect(SUPPORTED_OPENAI_VOICES.length).toBe(6);

      expect(EDGE_VOICE_MAP.nova).toBe("pt-BR-FranciscaNeural");
      expect(EDGE_VOICE_MAP.echo).toBe("pt-BR-AntonioNeural");
      expect(EDGE_VOICE_MAP.shimmer).toBe("pt-BR-ThalitaNeural");
      expect(EDGE_VOICE_MAP.alloy).toBe("pt-BR-ManuelaNeural");
      expect(EDGE_VOICE_MAP.onyx).toBe("pt-BR-FabioNeural");
      expect(EDGE_VOICE_MAP.fable).toBe("pt-BR-DonatoNeural");
    });

    it("rejeita vozes inválidas ou inexistentes", () => {
      expect(isSupportedVoice("voz_inventada")).toBe(false);
      expect(isSupportedVoice("")).toBe(false);
      expect(isSupportedVoice(null)).toBe(false);
    });
  });

  describe("3. Síntese de Áudio com EdgeTTS (generateSpeechAudio)", () => {
    it("retorna null se o texto for vazio ou conter apenas espaços", async () => {
      const res1 = await generateSpeechAudio({ text: "" });
      const res2 = await generateSpeechAudio({ text: "   \n\t  " });
      const res3 = await generateSpeechAudio({ text: null });
      expect(res1).toBeNull();
      expect(res2).toBeNull();
      expect(res3).toBeNull();
    });

    it("executa síntese via EdgeTTS com voz pt-BR mapeada, velocidade convertida e formato mp3", async () => {
      const expectedBase64 = Buffer.from(new Uint8Array([10, 20, 30, 40, 50, 60]).buffer).toString("base64");

      const result = await generateSpeechAudio({
        text: "Olá! Como posso ajudar você hoje?",
        voice: "echo",
        speed: 1.1,
      });

      expect(EdgeTTS).toHaveBeenCalledWith(
        "Olá! Como posso ajudar você hoje?",
        "pt-BR-AntonioNeural",
        { rate: "+10%" }
      );

      expect(result).not.toBeNull();
      expect(result.mimetype).toBe("audio/mpeg");
      expect(result.format).toBe("mp3");
      expect(result.base64).toBe(expectedBase64);
    });

    it("usa FranciscaNeural (+0%) como voz padrão quando voz não for informada", async () => {
      await generateSpeechAudio({
        text: "Mensagem de teste",
      });

      expect(EdgeTTS).toHaveBeenCalledWith(
        "Mensagem de teste",
        "pt-BR-FranciscaNeural",
        { rate: "+0%" }
      );
    });

    it("Fallback de Ouro: retorna null sem estourar exceção quando o EdgeTTS falha", async () => {
      vi.mocked(EdgeTTS).mockImplementationOnce(function () {
        this.synthesize = vi.fn().mockRejectedValue(new Error("Falha na conexão com Microsoft TTS"));
      });

      const result = await generateSpeechAudio({
        text: "Teste de erro",
        voice: "nova",
      });

      expect(result).toBeNull();
    });

    it("Fallback de Ouro: retorna null quando o retorno de áudio é nulo", async () => {
      vi.mocked(EdgeTTS).mockImplementationOnce(function () {
        this.synthesize = vi.fn().mockResolvedValue({ audio: null });
      });

      const result = await generateSpeechAudio({
        text: "Teste de audio nulo",
        voice: "nova",
      });

      expect(result).toBeNull();
    });
  });
});
