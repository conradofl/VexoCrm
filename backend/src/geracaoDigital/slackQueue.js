import { Queue } from "bullmq";

const QUEUE_NAME = "gd-slack-setup";

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

export function getSlackQueue() {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, {
      connection: getRedisConnection(),
    });
  }
  return _queue;
}

export { QUEUE_NAME, getRedisConnection };
