// backend/src/services/storage.js
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import { promises as fsPromises } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tetos de recebimento para salvar no R2 (Regra 84% arquivos / 69% bytes)
// Áudio, Imagem e Figurinha são persistidos; Vídeo e Documento não entram no R2.
export const R2_MAX_SIZES = {
  image: 8 * 1024 * 1024,      // 8 MB
  audio: 5 * 1024 * 1024,      // 5 MB
  sticker: 1 * 1024 * 1024,    // 1 MB
  video: 0,                    // 0 MB (não vai pro R2)
  document: 0,                 // 0 MB (não vai pro R2)
};

// Limite de cache LRU em memória (30 MB)
export const MAX_CACHE_BYTES = 30 * 1024 * 1024;

let inMemoryCacheBytes = 0;
const mediaLruCache = new Map();

export function _clearMediaCache() {
  mediaLruCache.clear();
  inMemoryCacheBytes = 0;
}

export function _getMediaCacheStats() {
  return {
    count: mediaLruCache.size,
    totalBytes: inMemoryCacheBytes,
    maxBytes: MAX_CACHE_BYTES,
  };
}

function putInLruCache(key, buffer, contentType) {
  if (!buffer || buffer.length > MAX_CACHE_BYTES) return;

  // Se a chave já existia, subtrai tamanho anterior
  if (mediaLruCache.has(key)) {
    const existing = mediaLruCache.get(key);
    inMemoryCacheBytes -= existing.buffer.length;
    mediaLruCache.delete(key);
  }

  // Evict mais antigos até caber
  while (inMemoryCacheBytes + buffer.length > MAX_CACHE_BYTES && mediaLruCache.size > 0) {
    const oldestKey = mediaLruCache.keys().next().value;
    const oldest = mediaLruCache.get(oldestKey);
    inMemoryCacheBytes -= oldest.buffer.length;
    mediaLruCache.delete(oldestKey);
  }

  mediaLruCache.set(key, { buffer, contentType, accessedAt: Date.now() });
  inMemoryCacheBytes += buffer.length;
}

function getFromLruCache(key) {
  if (!mediaLruCache.has(key)) return null;
  const item = mediaLruCache.get(key);
  // Atualiza posição LRU
  mediaLruCache.delete(key);
  mediaLruCache.set(key, item);
  return item;
}

/**
 * Resolução do provedor de storage com trava estrita de ambiente.
 * Fallback local SÓ é permitido se NODE_ENV === 'development' || NODE_ENV === 'test'.
 * Em produção sem credenciais R2, o backend recusa gravar em disco do container.
 */
export function resolveStorageProvider() {
  const nodeEnv = process.env.NODE_ENV || "development";
  const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME || "vexo-media";

  const hasR2Creds = Boolean(accountId && accessKeyId && secretAccessKey && bucket);

  if (hasR2Creds) {
    return {
      provider: "r2",
      configured: true,
      bucket,
      accountId,
      publicUrl: process.env.R2_PUBLIC_URL || null,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    };
  }

  // Se não tem credenciais R2 configuradas:
  if (nodeEnv === "development" || nodeEnv === "test") {
    const localDir = path.resolve(__dirname, "../../storage/media");
    return {
      provider: "local",
      configured: true,
      localDir,
    };
  }

  // Em produção sem credenciais: PROIBIDO usar disco efêmero do container
  console.error(
    "================================================================================\n" +
    "🛑 [STORAGE] CRITICAL CONFIG ERROR: Credenciais do Cloudflare R2 não configuradas!\n" +
    "   Em ambiente de PRODUÇÃO, o fallback silencioso para o disco local é PROIBIDO\n" +
    "   para evitar perda catastrófica de mídias em deploys/restarts do container.\n" +
    "   Configure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY e R2_BUCKET_NAME.\n" +
    "================================================================================"
  );

  return {
    provider: "none",
    configured: false,
    error: "Missing Cloudflare R2 credentials in production",
  };
}

let s3ClientInstance = null;
function getS3Client(config) {
  if (s3ClientInstance) return s3ClientInstance;
  s3ClientInstance = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: config.credentials,
  });
  return s3ClientInstance;
}

/**
 * Retorna status atual do storage para o /health.
 */
export function getStorageStatus() {
  const config = resolveStorageProvider();
  return {
    status: config.configured ? "ready" : "unconfigured",
    provider: config.provider,
    bucket: config.bucket || null,
    error: config.error || null,
    cache: _getMediaCacheStats(),
  };
}

/**
 * Constrói caminho padronizado: media/:clientId/:year/:month/:waMessageId.:ext
 * Utiliza o messageTimestamp da mensagem (quando disponível) para que mídias salvas em cascata
 * fiquem no mês correto do evento, caindo no mês atual apenas como último recurso.
 */
export function buildMediaStorageKey(clientId, waMessageId, ext = "bin", messageTimestamp = null) {
  const cleanExt = ext.replace(/^\.+/, "").toLowerCase() || "bin";
  let dateObj = null;
  if (messageTimestamp) {
    const num = Number(messageTimestamp);
    if (!Number.isNaN(num) && num > 0) {
      const ms = num < 10000000000 ? num * 1000 : num;
      dateObj = new Date(ms);
    } else {
      const parsed = new Date(messageTimestamp);
      if (!Number.isNaN(parsed.getTime())) {
        dateObj = parsed;
      }
    }
  }
  if (!dateObj || Number.isNaN(dateObj.getTime())) {
    dateObj = new Date();
  }

  const year = dateObj.getUTCFullYear();
  const month = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const safeClientId = encodeURIComponent(String(clientId || "shared").trim());
  const safeWaId = encodeURIComponent(String(waMessageId).trim());
  return `media/${safeClientId}/${year}/${month}/${safeWaId}.${cleanExt}`;
}

/**
 * Deriva extensão de arquivo a partir do mimetype.
 */
export function deriveExtensionFromMimetype(mimetype) {
  if (!mimetype) return "bin";
  const clean = mimetype.toLowerCase().split(";")[0].trim();
  const map = {
    "audio/ogg": "ogg",
    "audio/opus": "opus",
    "audio/webm": "webm",
    "video/webm": "webm",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "application/pdf": "pdf",
  };
  return map[clean] || "bin";
}

/**
 * Salva buffer de mídia no storage configurado (R2 em prod, local em dev/test).
 * Respeita tetos de tamanho por tipo e rejeita tipos não persistidos (vídeo/doc).
 * O cache LRU é de leitura, não de escrita: mídias recém-gravadas não ocupam os 30MB
 * até que alguém efetivamente visualize ou ouça a conversa no inbox.
 */
export async function saveMediaBuffer({ clientId, waMessageId, buffer, mimetype, mediaType, messageTimestamp = null }) {
  if (!buffer || buffer.length === 0) return null;
  if (!clientId || !waMessageId) return null;

  const normalizedType = (mediaType || "").toLowerCase().trim();
  const maxSize = R2_MAX_SIZES[normalizedType] ?? 0;

  // Vídeo e Documento têm maxSize 0 e não são salvos no R2
  if (maxSize === 0) {
    return null;
  }

  if (buffer.length > maxSize) {
    console.warn(`[storage] Arquivo ${normalizedType} (${buffer.length} bytes) excede o teto de ${maxSize} bytes. Não será salvo.`);
    return null;
  }

  const config = resolveStorageProvider();
  if (!config.configured) {
    console.warn(`[storage] Armazenamento desconfigurado (${config.error || "provider=none"}). Mídia não persistida.`);
    return null;
  }

  const ext = deriveExtensionFromMimetype(mimetype);
  const mediaKey = buildMediaStorageKey(clientId, waMessageId, ext, messageTimestamp);

  if (config.provider === "r2") {
    try {
      const s3 = getS3Client(config);
      await s3.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: mediaKey,
          Body: buffer,
          ContentType: mimetype || "application/octet-stream",
        })
      );
      // Cache é estritamente de leitura (não de escrita): não chama putInLruCache aqui
      return {
        mediaPath: mediaKey,
        sizeBytes: buffer.length,
        mimetype,
      };
    } catch (err) {
      console.error("[storage] Erro ao gravar no Cloudflare R2:", err.message || err);
      return null;
    }
  }

  if (config.provider === "local") {
    try {
      const fullPath = path.join(config.localDir, mediaKey);
      await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
      await fsPromises.writeFile(fullPath, buffer);
      // Cache é estritamente de leitura (não de escrita): não chama putInLruCache aqui
      return {
        mediaPath: mediaKey,
        sizeBytes: buffer.length,
        mimetype,
      };
    } catch (err) {
      console.error("[storage] Erro ao gravar no disco local:", err.message || err);
      return null;
    }
  }

  return null;
}

/**
 * Recupera buffer de mídia a partir do mediaPath.
 * Consulta cache LRU primeiro, depois provedor de storage.
 */
export async function getMediaBuffer(mediaPath) {
  if (!mediaPath) return null;

  // 1. Hit no cache em memória
  const cached = getFromLruCache(mediaPath);
  if (cached) {
    return {
      buffer: cached.buffer,
      contentType: cached.contentType,
      source: "cache",
    };
  }

  const config = resolveStorageProvider();
  if (!config.configured) {
    return null;
  }

  if (config.provider === "r2") {
    try {
      const s3 = getS3Client(config);
      const res = await s3.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: mediaPath,
        })
      );
      const chunks = [];
      for await (const chunk of res.Body) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      const contentType = res.ContentType || "application/octet-stream";
      putInLruCache(mediaPath, buffer, contentType);
      return {
        buffer,
        contentType,
        source: "r2",
      };
    } catch (err) {
      if (err.name !== "NoSuchKey") {
        console.error("[storage] Erro ao ler do R2:", err.message || err);
      }
      return null;
    }
  }

  if (config.provider === "local") {
    try {
      const fullPath = path.join(config.localDir, mediaPath);
      const buffer = await fsPromises.readFile(fullPath);
      const ext = path.extname(mediaPath).slice(1);
      const mimeMap = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        gif: "image/gif",
        ogg: "audio/ogg",
        opus: "audio/opus",
        webm: "audio/webm",
        mp3: "audio/mpeg",
        m4a: "audio/mp4",
        wav: "audio/wav",
        mp4: "video/mp4",
        pdf: "application/pdf",
      };
      const contentType = mimeMap[ext] || "application/octet-stream";
      putInLruCache(mediaPath, buffer, contentType);
      return {
        buffer,
        contentType,
        source: "local",
      };
    } catch (err) {
      return null;
    }
  }

  return null;
}
