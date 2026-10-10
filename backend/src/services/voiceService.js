import { EdgeTTS } from "node-edge-tts";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";

export const VOICE_SYNTHESIS_TIMEOUT_MS = 10000;

export const VOICE_PROFILES = {
  nova: { voice: "pt-BR-FranciscaNeural", pitch: "0Hz", baseRate: "0%", label: "Nova (Francisca - Feminina Expressiva)" },
  echo: { voice: "pt-BR-AntonioNeural", pitch: "0Hz", baseRate: "0%", label: "Echo (Antônio - Masculina Natural)" },
  shimmer: { voice: "pt-BR-ThalitaMultilingualNeural", pitch: "0Hz", baseRate: "0%", label: "Shimmer (Thalita - Feminina Jovem)" },
  alloy: { voice: "pt-BR-FranciscaNeural", pitch: "+20Hz", baseRate: "-5%", label: "Alloy (Manuela - Feminina Suave)" },
  onyx: { voice: "pt-BR-AntonioNeural", pitch: "-20Hz", baseRate: "-5%", label: "Onyx (Fábio - Masculina Encorpada)" },
  fable: { voice: "pt-BR-ThalitaMultilingualNeural", pitch: "+10Hz", baseRate: "+10%", label: "Fable (Donato - Expressiva Marcante)" },
};

export const SUPPORTED_VOICES = Object.entries(VOICE_PROFILES).map(([id, p]) => ({
  id,
  name: p.label,
  voice: p.voice,
}));

export const SUPPORTED_OPENAI_VOICES = SUPPORTED_VOICES;

const VALID_VOICE_IDS = new Set(Object.keys(VOICE_PROFILES));

export function isSupportedVoice(voice) {
  if (!voice || typeof voice !== "string") return false;
  return VALID_VOICE_IDS.has(voice.trim().toLowerCase());
}

export function resolveVoiceDecision({ voiceMode = "disabled", leadSentAudio = false } = {}) {
  const mode = String(voiceMode || "disabled").trim().toLowerCase();
  if (mode === "always") return true;
  if (mode === "mirror" && Boolean(leadSentAudio)) return true;
  return false;
}

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
  const profile = VOICE_PROFILES[voiceKey] || VOICE_PROFILES.nova;
  const numSpeed = Number(speed);
  const userRateOffset = !isNaN(numSpeed) && numSpeed >= 0.25 && numSpeed <= 4.0 ? Math.round((numSpeed - 1) * 100) : 0;
  const rate = userRateOffset !== 0 ? `${userRateOffset >= 0 ? "+" : ""}${userRateOffset}%` : profile.baseRate;
  const cleanText = text.trim().slice(0, 3000);
  const tempFile = path.join(os.tmpdir(), `vexo_tts_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.mp3`);
  const startMs = Date.now();

  try {
    const tts = new EdgeTTS({
      voice: profile.voice,
      pitch: profile.pitch,
      rate,
      timeout: timeoutMs,
    });

    await tts.ttsPromise(cleanText, tempFile);
    const audioBuffer = await fs.readFile(tempFile);
    await fs.unlink(tempFile).catch(() => {});
    const durationMs = Date.now() - startMs;
    console.log(`[voiceService] Áudio sintetizado via EdgeTTS (${profile.voice}, pitch: ${profile.pitch}, ${durationMs}ms, ${audioBuffer.length} bytes)`);

    return {
      base64: audioBuffer.toString("base64"),
      mimetype: "audio/mpeg",
      format: "mp3",
    };
  } catch (err) {
    console.warn(`[voiceService] Falha na síntese EdgeTTS (${profile.voice}):`, err.message);
    await fs.unlink(tempFile).catch(() => {});
    return null;
  }
}



