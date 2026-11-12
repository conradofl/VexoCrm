// Áudios de verdade (nos bytes) montados na mão, para os testes da Biblioteca
// de Áudios. Nada aqui é "um buffer qualquer com extensão .mp3": cada função
// escreve a estrutura real do formato, que é justamente o que o medidor
// (audioLibrary/audioProbe.js) lê.

/** WAV PCM 8 bits mono. 8000 Hz => 8000 bytes por segundo. */
export function makeWav({ seconds = 2, sampleRate = 8000 } = {}) {
  const dataSize = Math.round(seconds * sampleRate);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate, 28); // byte rate (8 bits mono)
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);
  // Onda quadrada baixinha: toca de verdade no navegador.
  const data = Buffer.alloc(dataSize);
  for (let i = 0; i < dataSize; i += 1) data[i] = Math.floor(i / 20) % 2 === 0 ? 140 : 116;
  return Buffer.concat([header, data]);
}

function oggPage({ headerType, granule, sequence, packet }) {
  const header = Buffer.alloc(27);
  header.write("OggS", 0, "ascii");
  header[4] = 0;
  header[5] = headerType;
  header.writeBigUInt64LE(BigInt.asUintN(64, BigInt(granule)), 6);
  header.writeUInt32LE(0x1234, 14);
  header.writeUInt32LE(sequence, 18);
  header.writeUInt32LE(0, 22);
  header[26] = 1;
  return Buffer.concat([header, Buffer.from([packet.length]), packet]);
}

/** OGG Opus: página de cabeçalho (OpusHead) + última página com a posição final. */
export function makeOggOpus({ seconds = 5, preSkip = 312 } = {}) {
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0, "ascii");
  head[8] = 1;
  head[9] = 1;
  head.writeUInt16LE(preSkip, 10);
  head.writeUInt32LE(16000, 12);
  return Buffer.concat([
    oggPage({ headerType: 2, granule: 0, sequence: 0, packet: head }),
    oggPage({ headerType: 4, granule: preSkip + Math.round(seconds * 48000), sequence: 1, packet: Buffer.from([0]) }),
  ]);
}

/** MP3 MPEG-1 Layer III, 128 kbps, 44,1 kHz: 417 bytes e ~26 ms por quadro. */
export function makeMp3({ seconds = 3, withId3 = false } = {}) {
  const frames = Math.ceil(seconds / (1152 / 44100));
  const frame = Buffer.alloc(417);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0x00;
  const parts = [];
  if (withId3) {
    const id3 = Buffer.alloc(10 + 32);
    id3.write("ID3", 0, "ascii");
    id3[3] = 3;
    id3[9] = 32; // tamanho syncsafe do corpo da tag
    parts.push(id3);
  }
  for (let i = 0; i < frames; i += 1) parts.push(frame);
  return Buffer.concat(parts);
}

/** AAC cru (ADTS), 44,1 kHz: 1024 amostras por quadro. */
export function makeAdtsAac({ seconds = 2 } = {}) {
  const frames = Math.ceil(seconds / (1024 / 44100));
  const length = 64;
  const frame = Buffer.alloc(length);
  frame[0] = 0xff;
  frame[1] = 0xf1;
  frame[2] = 0x50; // AAC LC, índice 4 (44,1 kHz)
  frame[3] = 0x80 | ((length >> 11) & 0x03);
  frame[4] = (length >> 3) & 0xff;
  frame[5] = ((length & 0x07) << 5) | 0x1f;
  frame[6] = 0xfc;
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

function mp4Box(type, payload) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, payload]);
}

function mp4Track(handler) {
  const hdlr = Buffer.alloc(25);
  hdlr.write(handler, 8, "latin1");
  return mp4Box("trak", mp4Box("mdia", mp4Box("hdlr", hdlr)));
}

/**
 * Contêiner MP4. `brand` é a marca do ftyp ("M4A " no iPhone, "isom"/"mp42" em
 * muito Android). `video: true` inclui trilha de vídeo — é o "vídeo renomeado
 * para .m4a".
 */
export function makeMp4({ seconds = 4, brand = "M4A ", video = false, audio = true } = {}) {
  const ftyp = Buffer.alloc(12);
  ftyp.write(brand, 0, "latin1");
  ftyp.write("isom", 8, "latin1");
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12); // timescale
  mvhd.writeUInt32BE(Math.round(seconds * 1000), 16);
  const tracks = [];
  if (video) tracks.push(mp4Track("vide"));
  if (audio) tracks.push(mp4Track("soun"));
  return Buffer.concat([
    mp4Box("ftyp", ftyp),
    mp4Box("moov", Buffer.concat([mp4Box("mvhd", mvhd), ...tracks])),
    mp4Box("mdat", Buffer.alloc(64)),
  ]);
}

export const PDF_BYTES = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(200, 0x20)]);
export const EXE_BYTES = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(200, 0)]);
