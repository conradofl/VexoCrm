import Redis from "ioredis";
import { getRedisConnection } from "./slackQueue.js";

let _redisClient = null;

export function getGdRedisClient() {
  if (!_redisClient) {
    const conn = getRedisConnection();
    _redisClient = new Redis({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: conn.password,
    });
  }
  return _redisClient;
}
