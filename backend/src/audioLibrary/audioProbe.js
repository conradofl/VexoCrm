// backend/src/audioLibrary/audioProbe.js
//
// Diz, SÓ pelos bytes, se o arquivo é um áudio aceito e quanto tempo ele dura.
// Nome do arquivo e mime informado pelo navegador nunca entram na decisão.
//
// Por que não basta detectFollowupMediaType: ela é a porta de entrada (bloqueia
// executável, reconhece as assinaturas), mas para o contêiner MP4 ela decide
// entre áudio e vídeo olhando a extensão e o mime declarado — um vídeo
// renomeado para .m4a passa como áudio. Aqui a chamada vai sem nome e sem
// mime, e o MP4 é decidido pelas trilhas que existem dentro do arquivo.
//
// A duração também sai dos bytes porque o limite de 3 minutos é regra de
// produto: se o servidor confiasse num número mandado pela tela, qualquer
// chamada direta à API furaria o limite. Formato que não deu para medir é
// recusado com mensagem clara, nunca aceito "no escuro".

import { detectFollowupMediaType } from "../services/storage.js";

export const AUDIO_LIBRARY_FORMATS_MESSAGE =
  "Envie um áudio em OGG, MP3, M4A, AAC ou WAV.";

function probeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// ─── WAV ─────────────────────────────────────────────────────────────────────

function wavDuration(buffer) {
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (id === "fmt " && dataStart + 12 <= buffer.length) {
      byteRate = buffer.readUInt32LE(dataStart + 8);
    } else if (id === "data") {
      if (!byteRate) return null;
      // Gravador que não fecha o cabeçalho deixa 0 ou 0xFFFFFFFF no tamanho:
      // nesse caso vale o que realmente sobrou no arquivo.
      const restante = buffer.length - dataStart;
      const dataSize = size === 0 || size > restante ? restante : size;
      return dataSize / byteRate;
    }
    offset = dataStart + size + (size % 2);
  }
  return null;
}

// ─── OGG (Opus / Vorbis) ─────────────────────────────────────────────────────

function oggDuration(buffer) {
  if (buffer.length < 28) return null;
  const segmentos = buffer[26];
  const inicioPacote = 27 + segmentos;
  if (inicioPacote + 19 > buffer.length) return null;

  let sampleRate = 0;
  let preSkip = 0;
  if (buffer.toString("ascii", inicioPacote, inicioPacote + 8) === "OpusHead") {
    // Opus sempre conta o tempo em 48 kHz, qualquer que seja a taxa original.
    sampleRate = 48000;
    preSkip = buffer.readUInt16LE(inicioPacote + 10);
  } else if (
    buffer[inicioPacote] === 0x01 &&
    buffer.toString("ascii", inicioPacote + 1, inicioPacote + 7) === "vorbis"
  ) {
    sampleRate = buffer.readUInt32LE(inicioPacote + 12);
  }
  if (!sampleRate) return null;

  // A posição da última página diz quantas amostras o arquivo tem. Página
  // cujo granule é -1 não fecha nenhum pacote: volta para a anterior.
  let pos = buffer.length;
  while (pos > 0) {
    pos = buffer.lastIndexOf("OggS", pos - 1, "ascii");
    if (pos < 0) return null;
    if (pos + 14 > buffer.length) continue;
    const granule = buffer.readBigUInt64LE(pos + 6);
    if (granule === 0xffffffffffffffffn) continue;
    const amostras = Number(granule) - preSkip;
    return amostras > 0 ? amostras / sampleRate : null;
  }
  return null;
}

// ─── MP4 / M4A ───────────────────────────────────────────────────────────────

const MP4_CONTAINERS = new Set(["moov", "trak", "mdia"]);

function walkMp4Boxes(buffer, start, end, visit, depth = 0) {
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return;
      size = Number(buffer.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) return;
    const payloadStart = offset + header;
    const payloadEnd = offset + size;
    visit(type, payloadStart, payloadEnd);
    if (MP4_CONTAINERS.has(type) && depth < 4) {
      walkMp4Boxes(buffer, payloadStart, payloadEnd, visit, depth + 1);
    }
    offset += size;
  }
}

function inspectMp4(buffer) {
  const handlers = [];
  let duration = null;
  walkMp4Boxes(buffer, 0, buffer.length, (type, start, end) => {
    if (type === "hdlr" && start + 12 <= end) {
      handlers.push(buffer.toString("latin1", start + 8, start + 12));
    }
    if (type === "mvhd" && start + 20 <= end) {
      const version = buffer[start];
      if (version === 1 && start + 32 <= end) {
        const timescale = buffer.readUInt32BE(start + 20);
        const dur = Number(buffer.readBigUInt64BE(start + 24));
        if (timescale > 0) duration = dur / timescale;
      } else if (version === 0) {
        const timescale = buffer.readUInt32BE(start + 12);
        const dur = buffer.readUInt32BE(start + 16);
        if (timescale > 0) duration = dur / timescale;
      }
    }
  });
  return {
    hasVideo: handlers.includes("vide"),
    hasAudio: handlers.includes("soun"),
    duration,
  };
}

// ─── MP3 e AAC cru (ADTS) ────────────────────────────────────────────────────

const MP3_BITRATES = {
  // [versão][camada] -> kbps por índice
  v1l1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  v1l2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2l1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  v2l23: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_SAMPLE_RATES = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};
const ADTS_SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

function skipId3v2(buffer) {
  if (buffer.length >= 10 && buffer.toString("ascii", 0, 3) === "ID3") {
    const size =
      ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
    return 10 + size;
  }
  return 0;
}

function parseMp3Frame(buffer, offset) {
  if (offset + 4 > buffer.length) return null;
  const b1 = buffer[offset + 1];
  const b2 = buffer[offset + 2];
  if (buffer[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 3;
  const layer = (b1 >> 1) & 3;
  if (version === 1 || layer === 0) return null;
  const bitrateIndex = b2 >> 4;
  const rateIndex = (b2 >> 2) & 3;
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const padding = (b2 >> 1) & 1;
  const sampleRate = MP3_SAMPLE_RATES[version][rateIndex];
  const mpeg1 = version === 3;

  let kbps;
  let samples;
  let size;
  if (layer === 3) {
    // Layer I
    kbps = (mpeg1 ? MP3_BITRATES.v1l1 : MP3_BITRATES.v2l1)[bitrateIndex];
    samples = 384;
    size = (Math.floor((12 * kbps * 1000) / sampleRate) + padding) * 4;
  } else if (layer === 2) {
    // Layer II
    kbps = (mpeg1 ? MP3_BITRATES.v1l2 : MP3_BITRATES.v2l23)[bitrateIndex];
    samples = 1152;
    size = Math.floor((144 * kbps * 1000) / sampleRate) + padding;
  } else {
    // Layer III
    kbps = (mpeg1 ? MP3_BITRATES.v1l3 : MP3_BITRATES.v2l23)[bitrateIndex];
    samples = mpeg1 ? 1152 : 576;
    size = Math.floor(((mpeg1 ? 144 : 72) * kbps * 1000) / sampleRate) + padding;
  }
  if (!size || size < 4) return null;
  return { size, seconds: samples / sampleRate };
}

function parseAdtsFrame(buffer, offset) {
  if (offset + 7 > buffer.length) return null;
  const b1 = buffer[offset + 1];
  // Sincronismo de 12 bits e camada 00 — é o que separa AAC cru de MP3.
  if (buffer[offset] !== 0xff || (b1 & 0xf6) !== 0xf0) return null;
  const rateIndex = (buffer[offset + 2] >> 2) & 0x0f;
  const sampleRate = ADTS_SAMPLE_RATES[rateIndex];
  if (!sampleRate) return null;
  const size =
    ((buffer[offset + 3] & 0x03) << 11) | (buffer[offset + 4] << 3) | (buffer[offset + 5] >> 5);
  if (size < 7) return null;
  const blocos = (buffer[offset + 6] & 0x03) + 1;
  return { size, seconds: (blocos * 1024) / sampleRate };
}

// Soma a duração quadro a quadro (funciona com taxa variável, que estimativa
// por tamanho/bitrate erraria). Exige uma sequência mínima de quadros válidos
// para não tomar lixo por áudio.
function framedDuration(buffer, parseFrame) {
  let offset = skipId3v2(buffer);
  let seconds = 0;
  let frames = 0;
  let saltos = 0;
  const MAX_SALTOS = 64 * 1024;
  while (offset < buffer.length) {
    const frame = parseFrame(buffer, offset);
    if (frame) {
      seconds += frame.seconds;
      frames += 1;
      offset += frame.size;
      continue;
    }
    // ID3v1 no fim do arquivo: acabou o áudio.
    if (buffer.length - offset <= 128 && buffer.toString("ascii", offset, offset + 3) === "TAG") break;
    offset += 1;
    saltos += 1;
    if (saltos > MAX_SALTOS) break;
  }
  return frames >= 3 ? seconds : null;
}

function isAdts(buffer) {
  const start = skipId3v2(buffer);
  return start + 2 <= buffer.length && buffer[start] === 0xff && (buffer[start + 1] & 0xf6) === 0xf0;
}

// ─── Porta única ─────────────────────────────────────────────────────────────

/**
 * @returns {{ mimeType: string, extension: string, durationSeconds: number }}
 * @throws erro com code INVALID_AUDIO_TYPE ou AUDIO_DURATION_UNKNOWN
 */
export function probeAudioBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw probeError("EMPTY_BUFFER", "Arquivo vazio ou não enviado.");
  }

  let detected;
  try {
    // Sem nome e sem mime de propósito: só os bytes decidem.
    detected = detectFollowupMediaType(buffer, "", "");
  } catch {
    throw probeError("INVALID_AUDIO_TYPE", `Este arquivo não é um áudio aceito. ${AUDIO_LIBRARY_FORMATS_MESSAGE}`);
  }

  const isMp4 = buffer.length >= 8 && buffer.toString("ascii", 4, 8) === "ftyp";
  let mimeType = detected.mimeType;
  let extension;
  let duration = null;

  if (isMp4) {
    const info = inspectMp4(buffer);
    if (info.hasVideo || !info.hasAudio) {
      throw probeError(
        "INVALID_AUDIO_TYPE",
        `Este arquivo é um vídeo, não um áudio. ${AUDIO_LIBRARY_FORMATS_MESSAGE}`
      );
    }
    mimeType = "audio/mp4";
    extension = "m4a";
    duration = info.duration;
  } else if (detected.mediaType !== "audio") {
    throw probeError("INVALID_AUDIO_TYPE", `Este arquivo não é um áudio. ${AUDIO_LIBRARY_FORMATS_MESSAGE}`);
  } else if (mimeType === "audio/ogg") {
    extension = "ogg";
    duration = oggDuration(buffer);
  } else if (mimeType === "audio/wav") {
    extension = "wav";
    duration = wavDuration(buffer);
  } else if (isAdts(buffer)) {
    mimeType = "audio/aac";
    extension = "aac";
    duration = framedDuration(buffer, parseAdtsFrame);
  } else {
    mimeType = "audio/mpeg";
    extension = "mp3";
    duration = framedDuration(buffer, parseMp3Frame);
  }

  if (!Number.isFinite(duration) || duration <= 0) {
    throw probeError(
      "AUDIO_DURATION_UNKNOWN",
      "Não foi possível medir a duração deste áudio. Exporte de novo em OGG ou MP3 e envie outra vez."
    );
  }

  return { mimeType, extension, durationSeconds: Math.round(duration * 100) / 100 };
}
