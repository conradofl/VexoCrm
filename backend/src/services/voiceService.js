/**
 * voiceService.js
 * 
 * Camada de serviço pura para síntese de voz (Text-to-Speech) humanizada via Microsoft Edge Neural TTS.
 * 100% gratuito e sem necessidade de API key.
 * Permite que o robô do WhatsApp responda leads usando notas de voz nativas (PTT)
 * com forma de onda, suportando o modo "Espelhar o Lead" e fallback de ouro para texto.
 */

import { EdgeTTS } from "@travisvn/edge-tts";

export const VOICE_SYNTHESIS_TIMEOUT_MS = 10000;

export const EDGE_VOICE_MAP = {
  nova: "pt-BR-FranciscaNeural",
  echo: "pt-BR-AntonioNeural",
  shimmer: "pt-BR-ThalitaNeural",
  alloy: "pt-BR-ManuelaNeural",
  onyx: "pt-BR-FabioNeural",
  fable: "pt-BR-DonatoNeural",
};

export const SUPPORTED_OPENAI_VOICES = [
  { id: "nova", name: "Nova (Francisca)", edgeVoice: "pt-BR-FranciscaNeural", gender: "feminina", style: "Feminina Expressiva (Padrão)" },
  { id: "echo", name: "Echo (Antônio)", edgeVoice: "pt-BR-AntonioNeural", gender: "masculina", style: "Masculina Natural" },
  { id: "shimmer", name: "Shimmer (Thalita)", edgeVoice: "pt-BR-ThalitaNeural", gender: "feminina", style: "Feminina Jovem" },
  { id: "alloy", name: "Alloy (Manuela)", edgeVoice: "pt-BR-ManuelaNeural", gender: "feminina", style: "Feminina Suave" },
  { id: "onyx", name: "Onyx (Fábio)", edgeVoice: "pt-BR-FabioNeural", gender: "masculina", style: "Masculina Corporativa" },
  { id: "fable", name: "Fable (Donato)", edgeVoice: "pt-BR-DonatoNeural", gender: "masculina", style: "Masculina Encorpada" },
];

const VALID_VOICE_IDS = new Set(SUPPORTED_OPENAI_VOICES.map((v) => v.id));

export function isSupportedVoice(voice) {
  if (!voice || typeof voice !== "string") return false;
  return VALID_VOICE_IDS.has(voice.trim().toLowerCase());
}

/**
 * Decide se a resposta atual deve ser enviada como áudio ou texto.
 *
 * @param {object} params
 * @param {'disabled'|'mirror'|'always'} params.voiceMode
 * @param {boolean} params.leadSentAudio
 * @returns {boolean}
 */
export function resolveVoiceDecision({ voiceMode = "disabled", leadSentAudio = false } = {}) {
  const mode = String(voiceMode || "disabled").trim().toLowerCase();
  if (mode === "always") return true;
  if (mode === "mirror" && Boolean(leadSentAudio)) return true;
  return false;
}

/**
 * Sintetiza texto em áudio usando Microsoft Edge Neural TTS (100% gratuito).
 *
 * @param {object} params
 * @param {string} params.text - Texto a ser falado
 * @param {string} [params.voice='nova'] - Identificador da voz
 * @param {number} [params.speed=1.0] - Velocidade de reprodução (0.25 a 4.0)
 * @param {number} [params.timeoutMs=10000] - Timeout limite em milissegundos
 * @returns {Promise<{ base64: string, mimetype: string, format: string } | null>} Retorna null em caso de erro (Fallback de Ouro)
 */
export async function generateSpeechAudio({
  text,
  voice = "nova",
  speed = 1.0,
  timeoutMs = VOICE_SYNTHESIS_TIMEOUT_MS,
} = {}) {
  if (!text || typeof text !== "string" || !text.trim()) {
    return null;
  }

  const voiceKey = isSupportedVoice(voice) ? voice.trim().toLowerCase() : "nova";
  const mappedVoice = EDGE_VOICE_MAP[voiceKey] || EDGE_VOICE_MAP.nova;

  const numSpeed = Number(speed);
  const sanitizedSpeed = !isNaN(numSpeed) && numSpeed >= 0.25 && numSpeed <= 4.0 ? numSpeed : 1.0;
  const ratePercent = Math.round((sanitizedSpeed - 1) * 100);
  const rate = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`;

  const cleanText = text.trim().slice(0, 4000);

  const startMs = Date.now();
  try {
    const tts = new EdgeTTS(cleanText, mappedVoice, { rate });
    
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout na síntese de voz")), timeoutMs)
    );

    const { audio } = await Promise.race([tts.synthesize(), timeoutPromise]);

    if (!audio) {
      console.warn("[voiceService] Nenhum áudio retornado pelo EdgeTTS");
      return null;
    }

    const arrayBuffer = await audio.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const durationMs = Date.now() - startMs;
    console.log(`[voiceService] Áudio sintetizado via EdgeTTS (${mappedVoice}, ${rate}, ${durationMs}ms, ${base64.length} chars)`);

    return {
      base64,
      mimetype: "audio/mpeg",
      format: "mp3",
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    console.warn(`[voiceService] Falha na síntese de áudio (${durationMs}ms):`, err.message);
    return null;
  }
}
