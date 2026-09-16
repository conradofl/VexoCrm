// Worker BullMQ da fila de indexação RAG — processa um documento por job.
// processRagDocument já marca status/erro no banco por conta própria; aqui só
// resta deixar o job falhar (BullMQ registra e conta como tentativa) sem
// mascarar o erro.
import { Worker } from "bullmq";
import { QUEUE_NAME, getRedisConnection } from "./queue.js";
import { processRagDocument } from "./indexing.js";

let _worker = null;

export function startRagWorker() {
  if (_worker) return _worker;

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { documentId } = job.data || {};
      if (!documentId) {
        throw new Error("[rag/worker] job sem documentId.");
      }
      await processRagDocument(documentId);
    },
    {
      connection: getRedisConnection(),
      concurrency: 2, // indexação é pesada (rede + CPU de extração) — não compete por muitos slots
    }
  );

  worker.on("completed", (job) => console.info("[rag/worker] job concluído:", job.id));
  worker.on("failed", (job, err) =>
    console.error("[rag/worker] job falhou:", job?.id, err?.message || err)
  );

  _worker = worker;
  console.info("[rag/worker] Worker BullMQ iniciado — fila:", QUEUE_NAME);
  return worker;
}

export async function pauseRagWorker() {
  if (_worker) {
    try {
      await _worker.pause();
      console.info("[rag/worker] Worker pausado (não aceita novos jobs).");
    } catch (err) {
      console.warn("[rag/worker] Erro ao pausar worker:", err.message || err);
    }
  }
}

export async function stopRagWorker() {
  if (_worker) {
    try {
      await _worker.close();
      console.info("[rag/worker] Worker encerrado.");
    } catch (err) {
      console.warn("[rag/worker] Erro ao encerrar worker:", err.message || err);
    } finally {
      _worker = null;
    }
  }
}
