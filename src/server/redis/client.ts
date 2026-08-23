import { Redis as IORedis } from "ioredis";

/**
 * Redis 客户端单例。
 * - 支持标准 redis:// / rediss:// URL
 * - 自动为 Upstash 等需要 TLS 的托管服务启用 tls
 * - Next dev 热更新 / serverless 多实例场景下用 globalThis 缓存连接
 */

export type Redis = IORedis;

declare global {
  // eslint-disable-next-line no-var
  var __debtRedis: IORedis | undefined;
}

interface ParsedRedisUrl {
  host: string;
  port: number;
  password?: string;
  username?: string;
  tls: boolean;
}

function parseRedisUrl(url: string): ParsedRedisUrl {
  const parsed = new URL(url);
  const protocol = parsed.protocol.replace(":", "");
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    tls: protocol === "rediss" || parsed.hostname.endsWith(".upstash.io"),
  };
}

function createRedis(): IORedis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("缺少环境变量 REDIS_URL，无法连接 Redis");
  }

  const parsed = parseRedisUrl(url);
  const redis = new IORedis({
    host: parsed.host,
    port: parsed.port,
    username: parsed.username,
    password: parsed.password,
    tls: parsed.tls ? {} : undefined,
    connectTimeout: 10000,
    keepAlive: 30000,
    retryStrategy(times) {
      if (times > 5) return null;
      return Math.min(times * 200, 3000);
    },
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });

  redis.on("error", (err) => {
    // 避免未捕获的 error 事件导致进程退出；具体错误在调用处处理
    console.error("[redis] connection error:", err.message);
  });

  return redis;
}

export function getRedis(): IORedis {
  if (!globalThis.__debtRedis) {
    globalThis.__debtRedis = createRedis();
  }
  return globalThis.__debtRedis;
}

/** 健康检查：返回延迟毫秒数，失败抛错 */
export async function pingRedis(): Promise<number> {
  const redis = getRedis();
  const start = Date.now();
  await redis.ping();
  return Date.now() - start;
}

/** 缓存 key 前缀，避免多个项目共用同一 Redis 时冲突 */
export function cacheKey(namespace: string, key: string): string {
  return `debt:${namespace}:${key}`;
}
