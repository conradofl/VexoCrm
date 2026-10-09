/**
 * voiceService.js
 * 
 * Camada de serviço pura para síntese de voz (Text-to-Speech) humanizada via OpenAI TTS.
 * Permite que o robô do WhatsApp responda leads usando notas de voz nativas (PTT)
 * com forma de onda, suportando o modo "Espelhar o Lead" e fallback de ouro para texto.
 */

export const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
export const VOICE_SYNTHESIS_TIMEOUT_MS = 8000;

export const SUPPORTED_OPENAI_VOICES = [
  { id: "nova", name: "Nova", gender: "feminina", style: "Expressiva e enérgica (Padrão Recomendada)" },
  { id: "shimmer", name: "Shimmer", gender: "feminina", style: "Suave e acolhedora" },
  { id: "alloy", name: "Alloy", gender: "neutra", style: "Equilibrada e profissional" },
  { id: "echo", name: "Echo", gender: "masculina", style: "Natural e dinâmica" },
  { id: "onyx", name: "Onyx", gender: "masculina", style: "Encorpada e confiante" },
  { id: "fable", name: "Fable", gender: "expressiva", style: "Expressiva e marcante" },
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
 * Sintetiza texto em áudio usando OpenAI Audio Speech API (TTS-1).
 *
 * @param {object} params
 * @param {string} params.text - Texto a ser falado
 * @param {string} [params.voice='nova'] - Identificador da voz OpenAI
 * @param {number} [params.speed=1.0] - Velocidade de reprodução (0.25 a 4.0)
 * @param {string} [params.apiKey=null] - Chave da OpenAI opcional (default: process.env.OPENAI_API_KEY)
 * @param {number} [params.timeoutMs=8000] - Timeout limite em milissegundos
 * @returns {Promise<{ base64: string, mimetype: string, format: string } | null>} Retorna null em caso de erro (Fallback de Ouro)
 */
export async function generateSpeechAudio({
  text,
  voice = "nova",
  speed = 1.0,
  apiKey = null,
  timeoutMs = VOICE_SYNTHESIS_TIMEOUT_MS,
} = {}) {
  if (!text || typeof text !== "string" || !text.trim()) {
    return null;
  }

  const effectiveKey = apiKey || process.env.OPENAI_API_KEY;
  if (!effectiveKey) {
    console.warn("[voiceService] OPENAI_API_KEY não configurada no servidor — síntese de áudio ignorada");
    return null;
  }

  const sanitizedVoice = isSupportedVoice(voice) ? voice.trim().toLowerCase() : "nova";
  const numSpeed = Number(speed);
  const sanitizedSpeed = !isNaN(numSpeed) && numSpeed >= 0.25 && numSpeed <= 4.0 ? numSpeed : 1.0;

  // Limite razoável para prevenir erros da API (OpenAI suporta até 4096 caracteres)
  const cleanText = text.trim().slice(0, 4000);

  const startMs = Date.now();
  try {
    const response = await fetch(OPENAI_TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${effectiveKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: cleanText,
        voice: sanitizedVoice,
        response_format: "opus",
        speed: sanitizedSpeed,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const durationMs = Date.now() - startMs;

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.warn(`[voiceService] Falha na síntese de áudio (${response.status}, ${durationMs}ms):`, errText.slice(0, 200));
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    return {
      base64,
      mimetype: "audio/ogg; codecs=opus",
      format: "opus",
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    console.warn(`[voiceService] Falha na síntese de áudio (${durationMs}ms):`, err.message);
    return null;
  }
}
