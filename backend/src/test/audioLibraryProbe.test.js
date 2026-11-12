// Medidor da Biblioteca de Áudios: tipo e duração decididos SÓ pelos bytes.
// Nada é dublado — os buffers são áudios reais montados em helpers/audioFixtures.js.

import { describe, expect, it } from "vitest";
import { probeAudioBuffer } from "../audioLibrary/audioProbe.js";
import { validateAudioBuffer, AUDIO_LIBRARY_MAX_BYTES } from "../audioLibrary/service.js";
import {
  makeWav,
  makeOggOpus,
  makeMp3,
  makeAdtsAac,
  makeMp4,
  PDF_BYTES,
  EXE_BYTES,
} from "./helpers/audioFixtures.js";

function codeOf(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return err.code;
  }
}

describe("probeAudioBuffer — formato e duração pelos bytes", () => {
  it("WAV", () => {
    expect(probeAudioBuffer(makeWav({ seconds: 2 }))).toEqual({ mimeType: "audio/wav", extension: "wav", durationSeconds: 2 });
  });

  it("OGG Opus desconta o pre-skip", () => {
    expect(probeAudioBuffer(makeOggOpus({ seconds: 5 }))).toEqual({ mimeType: "audio/ogg", extension: "ogg", durationSeconds: 5 });
  });

  it("MP3 soma quadro a quadro, com e sem tag ID3", () => {
    const semTag = probeAudioBuffer(makeMp3({ seconds: 3 }));
    const comTag = probeAudioBuffer(makeMp3({ seconds: 3, withId3: true }));
    expect(semTag.mimeType).toBe("audio/mpeg");
    expect(semTag.extension).toBe("mp3");
    expect(semTag.durationSeconds).toBeGreaterThanOrEqual(3);
    expect(semTag.durationSeconds).toBeLessThan(3.05);
    expect(comTag.durationSeconds).toBe(semTag.durationSeconds);
  });

  it("AAC cru (ADTS) não é confundido com MP3", () => {
    const probe = probeAudioBuffer(makeAdtsAac({ seconds: 2 }));
    expect(probe.mimeType).toBe("audio/aac");
    expect(probe.extension).toBe("aac");
    expect(probe.durationSeconds).toBeGreaterThanOrEqual(2);
    expect(probe.durationSeconds).toBeLessThan(2.05);
  });

  it("M4A de iPhone (marca M4A)", () => {
    expect(probeAudioBuffer(makeMp4({ seconds: 4, brand: "M4A " }))).toEqual({ mimeType: "audio/mp4", extension: "m4a", durationSeconds: 4 });
  });

  it("M4A de Android (marca isom, só trilha de som) é áudio — decide a trilha, não a marca", () => {
    expect(probeAudioBuffer(makeMp4({ seconds: 4, brand: "isom" })).mimeType).toBe("audio/mp4");
  });

  it("vídeo MP4 com marca de áudio (renomeado para .m4a) é recusado", () => {
    expect(codeOf(() => probeAudioBuffer(makeMp4({ brand: "M4A ", video: true })))).toBe("INVALID_AUDIO_TYPE");
  });

  it("MP4 sem trilha de som é recusado", () => {
    expect(codeOf(() => probeAudioBuffer(makeMp4({ audio: false })))).toBe("INVALID_AUDIO_TYPE");
  });

  it("PDF e executável são recusados", () => {
    expect(codeOf(() => probeAudioBuffer(PDF_BYTES))).toBe("INVALID_AUDIO_TYPE");
    expect(codeOf(() => probeAudioBuffer(EXE_BYTES))).toBe("INVALID_AUDIO_TYPE");
  });

  it("áudio que não dá para medir é recusado, nunca aceito no escuro", () => {
    // Cabeçalho de MP3 seguido de lixo: assinatura bate, mas não há quadros.
    const lixo = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(300, 0x41)]);
    expect(codeOf(() => probeAudioBuffer(lixo))).toBe("AUDIO_DURATION_UNKNOWN");
    // OGG só com o cabeçalho, sem página final.
    const soCabecalho = makeOggOpus({ seconds: 5 }).subarray(0, 47);
    expect(codeOf(() => probeAudioBuffer(soCabecalho))).toBe("AUDIO_DURATION_UNKNOWN");
  });
});

describe("validateAudioBuffer — limites de produto", () => {
  it("aceita exatamente 3 minutos e recusa 3:01", () => {
    expect(validateAudioBuffer(makeWav({ seconds: 180 })).durationSeconds).toBe(180);
    let erro;
    try {
      validateAudioBuffer(makeWav({ seconds: 181 }));
    } catch (err) {
      erro = err;
    }
    expect(erro?.code).toBe("AUDIO_TOO_LONG");
    expect(erro?.message).toBe("O áudio tem 3:01. O limite é 3 minutos.");
  });

  it("recusa acima de 5 MB antes de olhar o conteúdo", () => {
    const grande = makeWav({ seconds: 60, sampleRate: 96000 });
    expect(grande.length).toBeGreaterThan(AUDIO_LIBRARY_MAX_BYTES);
    expect(codeOf(() => validateAudioBuffer(grande))).toBe("FILE_TOO_LARGE");
  });
});
