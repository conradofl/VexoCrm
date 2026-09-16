// Fila própria de indexação RAG — BullMQ, mesma infra Redis do resto do
// projeto, mas fila separada da de follow-up: mistura de responsabilidade e
// de prioridade (indexar um documento de 20MB não pode competir por worker
// com o envio de mensagem de um lead esperando resposta).
import { Queue } from "bullmq";

const QUEUE_NAME = "rag-indexing";

function getRedisConnection() {
  if (process.env.REDIS_URL) {
    const u = new URL(process.env.REDIS_URL);
    return {
      host: u.hostname,
      port: Number(u.port || 6379),
      username: u.username || undefined,
      password: u.password || undefined,
    };
  }
  return {
    host: process.env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT || 6379),
    username: process.env.REDIS_USERNAME || undefined,
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

let _queue = null;

export function getRagQueue() {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
        attempts: 2,
        backoff: { type: "fixed", delay: 60_000 },
      },
    });
    _queue.on("error", (err) => console.error("[rag/queue] BullMQ error:", err.message));
  }
  return _queue;
}

export async function closeRagQueue() {
  if (_queue) {
    try {
      await _queue.close();
      console.info("[rag/queue] Fila encerrada.");
    } catch (err) {
      console.warn("[rag/queue] Erro ao encerrar fila:", err.message || err);
    } finally {
      _queue = null;
    }
  }
}

export { QUEUE_NAME, getRedisConnection };
