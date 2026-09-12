// backend/src/test/storageEnvironmentGuard.test.js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  resolveStorageProvider,
  saveMediaBuffer,
  getMediaBuffer,
  getStorageStatus,
  buildMediaStorageKey,
  deriveExtensionFromMimetype,
  R2_MAX_SIZES,
  _clearMediaCache,
  _getMediaCacheStats,
} from "../services/storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Guarda de Ambiente e Resiliência do Storage (storage.js)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    _clearMediaCache();
    process.env = { ...originalEnv };
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    _clearMediaCache();
  });

  it("1. Em PRODUÇÃO sem credenciais R2: recusa salvar em disco local e reporta provider: none", async () => {
    process.env.NODE_ENV = "production";

    const config = resolveStorageProvider();
    expect(config.configured).toBe(false);
    expect(config.provider).toBe("none");
    expect(config.error).toContain("Missing Cloudflare R2 credentials in production");

    const status = getStorageStatus();
    expect(status.status).toBe("unconfigured");
    expect(status.provider).toBe("none");

    const sampleBuffer = Buffer.from("fake-audio-content");
    const result = await saveMediaBuffer({
      clientId: "test-client",
      waMessageId: "WA123",
      buffer: sampleBuffer,
      mimetype: "audio/ogg",
      mediaType: "audio",
    });

    expect(result).toBeNull();
  });

  it("2. Em DESENVOLVIMENTO ou TESTE sem credenciais R2: permite fallback para disco local", async () => {
    process.env.NODE_ENV = "test";

    const config = resolveStorageProvider();
    expect(config.configured).toBe(true);
    expect(config.provider).toBe("local");
    expect(config.localDir).toBeDefined();

    const sampleBuffer = Buffer.from("fake-image-bytes");
    const result = await saveMediaBuffer({
      clientId: "test-tenant",
      waMessageId: "IMG_TEST_1",
      buffer: sampleBuffer,
      mimetype: "image/jpeg",
      mediaType: "image",
    });

    expect(result).not.toBeNull();
    expect(result.mediaPath).toContain("media/test-tenant/");
    expect(result.mediaPath).toContain(".jpg");

    const retrieved = await getMediaBuffer(result.mediaPath);
    expect(retrieved).not.toBeNull();
    expect(retrieved.buffer.toString()).toBe("fake-image-bytes");
  });

  it("3. Regra 84/69: Vídeo e Documento NUNCA são persistidos no R2 (maxSize: 0)", async () => {
    process.env.NODE_ENV = "test";

    expect(R2_MAX_SIZES.video).toBe(0);
    expect(R2_MAX_SIZES.document).toBe(0);

    const videoBuffer = Buffer.from("video-bytes");
    const docBuffer = Buffer.from("pdf-bytes");

    const videoResult = await saveMediaBuffer({
      clientId: "t1",
      waMessageId: "VID1",
      buffer: videoBuffer,
      mimetype: "video/mp4",
      mediaType: "video",
    });
    expect(videoResult).toBeNull();

    const docResult = await saveMediaBuffer({
      clientId: "t1",
      waMessageId: "DOC1",
      buffer: docBuffer,
      mimetype: "application/pdf",
      mediaType: "document",
    });
    expect(docResult).toBeNull();
  });

  it("4. Respeita tetos de recebimento por tipo (Áudio 5MB, Imagem 8MB, Figurinha 1MB)", async () => {
    process.env.NODE_ENV = "test";

    expect(R2_MAX_SIZES.audio).toBe(5 * 1024 * 1024);
    expect(R2_MAX_SIZES.image).toBe(8 * 1024 * 1024);
    expect(R2_MAX_SIZES.sticker).toBe(1 * 1024 * 1024);

    // Áudio com 6MB deve ser rejeitado
    const bigAudio = Buffer.alloc(6 * 1024 * 1024);
    const bigAudioResult = await saveMediaBuffer({
      clientId: "t1",
      waMessageId: "BIG_AUDIO",
      buffer: bigAudio,
      mimetype: "audio/ogg",
      mediaType: "audio",
    });
    expect(bigAudioResult).toBeNull();

    // Figurinha com 1.5MB deve ser rejeitada
    const bigSticker = Buffer.alloc(1.5 * 1024 * 1024);
    const bigStickerResult = await saveMediaBuffer({
      clientId: "t1",
      waMessageId: "BIG_STICKER",
      buffer: bigSticker,
      mimetype: "image/webp",
      mediaType: "sticker",
    });
    expect(bigStickerResult).toBeNull();
  });

  it("5. Cache LRU em memória é de LEITURA e não de escrita (não preenche ao salvar)", async () => {
    process.env.NODE_ENV = "test";

    const smallBuf = Buffer.from("cached-content");
    const saveRes = await saveMediaBuffer({
      clientId: "tenant-cache",
      waMessageId: "MSG_CACHE_1",
      buffer: smallBuf,
      mimetype: "image/png",
      mediaType: "image",
    });

    // Prova: ao gravar, o cache LRU NÃO é populado (economiza memória de conversas não abertas)
    const cacheStatsAfterWrite = _getMediaCacheStats();
    expect(cacheStatsAfterWrite.count).toBe(0);

    // Primeira leitura: busca do disco/R2 e popula o cache
    const firstRead = await getMediaBuffer(saveRes.mediaPath);
    expect(firstRead.source).toBe("local");
    expect(firstRead.buffer.toString()).toBe("cached-content");

    const cacheStatsAfterFirstRead = _getMediaCacheStats();
    expect(cacheStatsAfterFirstRead.count).toBe(1);

    // Segunda leitura: atendida diretamente pelo cache em memória
    const secondRead = await getMediaBuffer(saveRes.mediaPath);
    expect(secondRead.source).toBe("cache");
    expect(secondRead.buffer.toString()).toBe("cached-content");
  });

  it("6. Prova de Mutação: Garante que o código-fonte de storage.js possui a guarda estrita de NODE_ENV", () => {
    const storageSource = fs.readFileSync(path.resolve(__dirname, "../services/storage.js"), "utf-8");

    // Deve checar explicitamente development e test
    expect(storageSource).toContain('nodeEnv === "development" || nodeEnv === "test"');

    // Em produção sem credenciais, deve emitir console.error proibindo o fallback
    expect(storageSource).toContain("CRITICAL CONFIG ERROR: Credenciais do Cloudflare R2 não configuradas!");
    expect(storageSource).toContain('provider: "none"');

    // Chave padronizada com clientId e waMessageId
    expect(storageSource).toContain("media/${safeClientId}/${year}/${month}/${safeWaId}.${cleanExt}");
  });

  it("7. buildMediaStorageKey respeita a data da mensagem quando fornecida", () => {
    // 1. Data histórica em ISO string (19 de maio de 2026)
    const keyIso = buildMediaStorageKey("tenant-sonhare", "WA-MAY-19", "ogg", "2026-05-19T12:00:00.000Z");
    expect(keyIso).toBe("media/tenant-sonhare/2026/05/WA-MAY-19.ogg");

    // 2. Epoch timestamp em segundos (ex: Evolution API: 1779195225)
    const keyEpochSec = buildMediaStorageKey("tenant-sonhare", "WA-MAY-20", "jpg", 1779195225);
    expect(keyEpochSec).toContain("media/tenant-sonhare/2026/");

    // 3. Sem timestamp: cai no ano/mês atuais como fallback
    const now = new Date();
    const curYear = now.getUTCFullYear();
    const curMonth = String(now.getUTCMonth() + 1).padStart(2, "0");
    const keyFallback = buildMediaStorageKey("tenant-sonhare", "WA-NOW", "ogg", null);
    expect(keyFallback).toBe(`media/tenant-sonhare/${curYear}/${curMonth}/WA-NOW.ogg`);
  });
});
