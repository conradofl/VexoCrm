/**
 * voiceService.js
 * 
 * Camada de serviço pura para síntese de voz (Text-to-Speech) humanizada via Google Gemini 2.0 Audio
 * com vozes neurais masculinas e femininas em pt-BR e fallback resiliente via Google Speech HTTP MP3.
 * Permite que o robô do WhatsApp responda leads usando notas de voz nativas (PTT)
 * com forma de onda, suportando o modo "Espelhar o Lead" e fallback de ouro para texto.
 */

export const VOICE_SYNTHESIS_TIMEOUT_MS = 8000;

export const GEMINI_VOICE_MAP = {
  nova: "Aoede",     // Feminina Expressiva
  echo: "Charon",    // Masculina Natural
  shimmer: "Kore",   // Feminina Suave
  alloy: "Puck",     // Neutra / Dinâmica
  onyx: "Fenrir",    // Masculina Corporativa / Encorpada
  fable: "Aoede",    // Expressiva
};

export const SUPPORTED_VOICES = [
  { id: "nova", name: "Nova", gender: "feminina", style: "Feminina Expressiva (Padrão)", geminiVoice: "Aoede" },
  { id: "echo", name: "Echo", gender: "masculina", style: "Masculina Natural", geminiVoice: "Charon" },
  { id: "shimmer", name: "Shimmer", gender: "feminina", style: "Feminina Suave", geminiVoice: "Kore" },
  { id: "alloy", name: "Alloy", gender: "neutra", style: "Equilibrada & Profissional", geminiVoice: "Puck" },
  { id: "onyx", name: "Onyx", gender: "masculina", style: "Masculina Corporativa", geminiVoice: "Fenrir" },
  { id: "fable", name: "Fable", gender: "expressiva", style: "Expressiva & Marcante", geminiVoice: "Aoede" },
];

export const SUPPORTED_OPENAI_VOICES = SUPPORTED_VOICES;

const VALID_VOICE_IDS = new Set(SUPPORTED_VOICES.map((v) => v.id));

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

export function splitTextIntoChunks(text, maxChunkLen = 180) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length <= maxChunkLen) {
      current = (current + " " + word).trim();
    } else {
      if (current) chunks.push(current);
      current = word;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Fallback via Google Speech HTTP TTS em pt-BR.
 */
async function generateSpeechAudioFallback(cleanText, timeoutMs) {
  const chunks = splitTextIntoChunks(cleanText);
  if (chunks.length === 0) return null;

  const startMs = Date.now();
  try {
    const buffers = [];
    for (const chunk of chunks) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=pt-BR&client=tw-ob`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        console.warn(`[voiceService] Falha no chunk de áudio (${response.status})`);
        return null;
      }

      const ab = await response.arrayBuffer();
      buffers.push(Buffer.from(ab));
    }

    const fullBuffer = Buffer.concat(buffers);
    const base64 = fullBuffer.toString("base64");
    const durationMs = Date.now() - startMs;
    console.log(`[voiceService] Áudio sintetizado via Google Speech HTTP (${durationMs}ms, ${fullBuffer.length} bytes)`);

    return {
      base64,
      mimetype: "audio/mpeg",
      format: "mp3",
    };
  } catch (err) {
    const durationMs = Date.now() - startMs;
    console.warn(`[voiceService] Falha na síntese fallback Google Speech (${durationMs}ms):`, err.message);
    return null;
  }
}

/**
 * Sintetiza texto em áudio usando Google Gemini 2.0 Audio com vozes neurais e fallback automático.
 *
 * @param {object} params
 * @param {string} params.text - Texto a ser falado
 * @param {string} [params.voice='nova'] - Identificador da voz
 * @param {number} [params.speed=1.0] - Velocidade de reprodução
 * @param {number} [params.timeoutMs=8000] - Timeout limite em milissegundos
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

  const cleanText = text.trim().slice(0, 3000);
  const voiceKey = isSupportedVoice(voice) ? voice.trim().toLowerCase() : "nova";
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (geminiKey) {
    const geminiVoice = GEMINI_VOICE_MAP[voiceKey] || "Aoede";
    const startMs = Date.now();
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
      const payload = {
        contents: [{
          role: "user",
          parts: [{
            text: "Leia o seguinte texto com entonação comercial natural em português do Brasil, exatamente como escrito, sem introduções:\n\n" + cleanText,
          }],
        }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: geminiVoice,
              },
            },
          },
        },
      };

      const response = await fetch(geminiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.ok) {
        const data = await response.json();
        const inlineData = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (inlineData?.data) {
          const durationMs = Date.now() - startMs;
          const mimeType = inlineData.mimeType || "audio/wav";
          const format = mimeType.includes("mp3") || mimeType.includes("mpeg") ? "mp3" : "wav";
          console.log(`[voiceService] Áudio sintetizado via Gemini 2.0 Audio (${geminiVoice}, ${durationMs}ms, ${inlineData.data.length} chars)`);
          return {
            base64: inlineData.data,
            mimetype: mimeType,
            format,
          };
        }
      } else {
        const errBody = await response.text().catch(() => "");
        console.warn(`[voiceService] Falha na síntese Gemini (${response.status}):`, errBody.slice(0, 200));
      }
    } catch (geminiErr) {
      console.warn("[voiceService] Erro ao chamar Gemini 2.0 Audio, ativando fallback:", geminiErr.message);
    }
  }

  // Fallback para Google Speech HTTP MP3
  return generateSpeechAudioFallback(cleanText, timeoutMs);
}
