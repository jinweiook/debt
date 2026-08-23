import { getRedis, cacheKey } from "./client";

/**
 * 通用 Redis 缓存读写工具。
 * - getOrSet：缓存未命中时执行 fetcher，并将结果写入缓存
 * - invalidate：按 namespace 删除相关缓存 key
 */

export interface CacheOptions {
  ttlSeconds: number;
}

export async function getOrSet<T>(
  namespace: string,
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions,
): Promise<T> {
  const redis = getRedis();
  const fullKey = cacheKey(namespace, key);
  const cached = await redis.get(fullKey);
  if (cached) {
    try {
      return JSON.parse(cached) as T;
    } catch {
      // 解析失败则回源
    }
  }
  const value = await fetcher();
  await redis.setex(fullKey, options.ttlSeconds, JSON.stringify(value));
  return value;
}

/** 删除指定 key */
export async function invalidateCache(namespace: string, key: string): Promise<void> {
  const redis = getRedis();
  await redis.del(cacheKey(namespace, key));
}

/** 按 namespace 批量删除缓存 */
export async function invalidateNamespace(namespace: string, pattern?: string): Promise<void> {
  const redis = getRedis();
  const fullPattern = pattern ? cacheKey(namespace, pattern) : cacheKey(namespace, "*");
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, matched] = await redis.scan(cursor, "MATCH", fullPattern, "COUNT", 100);
    cursor = next;
    keys.push(...matched);
  } while (cursor !== "0");
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
