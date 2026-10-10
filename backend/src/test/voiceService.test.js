import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateSpeechAudio,
  resolveVoiceDecision,
  isSupportedVoice,
  SUPPORTED_VOICES,
  VOICE_PROFILES,
} from "../services/voiceService.js";

// Mock de node-edge-tts e fs/promises
const mockTtsPromise = vi.fn();
vi.mock("node-edge-tts", () => {
  return {
    EdgeTTS: vi.fn().mockImplementation(function (options) {
      this.options = options;
      this.ttsPromise = mockTtsPromise;
    }),
  };
});

vi.mock("fs/promises", () => {
  return {
    default: {
      readFile: vi.fn().mockResolvedValue(Buffer.from("fake-audio-mp3-bytes")),
      unlink: vi.fn().mockResolvedValue(undefined),
    },
    readFile: vi.fn().mockResolvedValue(Buffer.from("fake-audio-mp3-bytes")),
    unlink: vi.fn().mockResolvedValue(undefined),
  };
});

describe("voiceService — Motor Gratuito node-edge-tts com Vozes Neurais Brasileiras", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTtsPromise.mockResolvedValue(undefined);
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

  describe("2. Catálogo e Perfis das 6 Vozes Neurais Brasileiras (VOICE_PROFILES)", () => {
    it("reconhece as 6 vozes neurais canônicas", () => {
      const canonical = ["nova", "echo", "shimmer", "alloy", "onyx", "fable"];
      for (const v of canonical) {
        expect(isSupportedVoice(v)).toBe(true);
        expect(isSupportedVoice(v.toUpperCase())).toBe(true);
      }
      expect(SUPPORTED_VOICES.length).toBe(6);
    });

    it("configura as vozes masculinas e femininas reais com ajustes de pitch e rate", () => {
      expect(VOICE_PROFILES.nova).toEqual({
        voice: "pt-BR-FranciscaNeural",
        pitch: "0Hz",
        baseRate: "0%",
        label: "Nova (Francisca - Feminina Expressiva)",
      });
      expect(VOICE_PROFILES.echo).toEqual({
        voice: "pt-BR-AntonioNeural",
        pitch: "0Hz",
        baseRate: "0%",
        label: "Echo (Antônio - Masculina Natural)",
      });
      expect(VOICE_PROFILES.shimmer).toEqual({
        voice: "pt-BR-ThalitaMultilingualNeural",
        pitch: "0Hz",
        baseRate: "0%",
        label: "Shimmer (Thalita - Feminina Jovem)",
      });
      expect(VOICE_PROFILES.alloy).toEqual({
        voice: "pt-BR-FranciscaNeural",
        pitch: "+20Hz",
        baseRate: "-5%",
        label: "Alloy (Manuela - Feminina Suave)",
      });
      expect(VOICE_PROFILES.onyx).toEqual({
        voice: "pt-BR-AntonioNeural",
        pitch: "-20Hz",
        baseRate: "-5%",
        label: "Onyx (Fábio - Masculina Encorpada)",
      });
      expect(VOICE_PROFILES.fable).toEqual({
        voice: "pt-BR-ThalitaMultilingualNeural",
        pitch: "+10Hz",
        baseRate: "+10%",
        label: "Fable (Donato - Expressiva Marcante)",
      });
    });

    it("rejeita vozes inválidas ou inexistentes", () => {
      expect(isSupportedVoice("voz_inventada")).toBe(false);
      expect(isSupportedVoice("")).toBe(false);
      expect(isSupportedVoice(null)).toBe(false);
    });
  });

  describe("3. Síntese via node-edge-tts (generateSpeechAudio)", () => {
    it("retorna null se o texto for vazio ou conter apenas espaços", async () => {
      const res1 = await generateSpeechAudio({ text: "" });
      const res2 = await generateSpeechAudio({ text: "   \n\t  " });
      const res3 = await generateSpeechAudio({ text: null });
      expect(res1).toBeNull();
      expect(res2).toBeNull();
      expect(res3).toBeNull();
    });

    it("sintetiza áudio masculino com voz Echo (pt-BR-AntonioNeural)", async () => {
      const { EdgeTTS } = await import("node-edge-tts");

      const result = await generateSpeechAudio({
        text: "Olá! Como posso ajudar você hoje?",
        voice: "echo",
        speed: 1.0,
      });

      expect(EdgeTTS).toHaveBeenCalledWith(
        expect.objectContaining({
          voice: "pt-BR-AntonioNeural",
          pitch: "0Hz",
          rate: "0%",
        })
      );
      expect(mockTtsPromise).toHaveBeenCalledTimes(1);
      expect(result).not.toBeNull();
      expect(result.mimetype).toBe("audio/mpeg");
      expect(result.format).toBe("mp3");
      expect(result.base64).toBe(Buffer.from("fake-audio-mp3-bytes").toString("base64"));
    });

    it("sintetiza áudio feminino com voz Nova (pt-BR-FranciscaNeural)", async () => {
      const { EdgeTTS } = await import("node-edge-tts");

      const result = await generateSpeechAudio({
        text: "Olá! Sou a assistente virtual.",
        voice: "nova",
        speed: 1.15,
      });

      expect(EdgeTTS).toHaveBeenCalledWith(
        expect.objectContaining({
          voice: "pt-BR-FranciscaNeural",
          pitch: "0Hz",
          rate: "+15%",
        })
      );
      expect(mockTtsPromise).toHaveBeenCalledTimes(1);
      expect(result).not.toBeNull();
      expect(result.mimetype).toBe("audio/mpeg");
      expect(result.format).toBe("mp3");
    });

    it("sintetiza áudio encorpado com voz Onyx (pt-BR-AntonioNeural com pitch -20Hz)", async () => {
      const { EdgeTTS } = await import("node-edge-tts");

      const result = await generateSpeechAudio({
        text: "Mensagem corporativa institucional.",
        voice: "onyx",
      });

      expect(EdgeTTS).toHaveBeenCalledWith(
        expect.objectContaining({
          voice: "pt-BR-AntonioNeural",
          pitch: "-20Hz",
          rate: "-5%",
        })
      );
      expect(result).not.toBeNull();
    });

    it("Fallback de Ouro: retorna null quando ocorre erro durante a síntese sem estourar exceção", async () => {
      mockTtsPromise.mockRejectedValueOnce(new Error("Connection error"));

      const result = await generateSpeechAudio({
        text: "Teste de erro",
        voice: "nova",
      });

      expect(result).toBeNull();
    });
  });
});



