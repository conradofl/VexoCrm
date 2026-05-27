// Configuração do BullMQ: Queue + conexão Redis.
// Um único objeto Queue é reutilizado em toda a aplicação.
import { Queue } from "bullmq";

const QUEUE_NAME = "followup-messages";

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

export function getFollowupQueue() {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200 },
        attempts: 3,
        backoff: { type: "fixed", delay: 30_000 },
      },
    });
    _queue.on("error", (err) =>
      console.error("[followup/queue] BullMQ error:", err.message)
    );
  }
  return _queue;
}

export { QUEUE_NAME, getRedisConnection };
