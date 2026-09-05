import { cacheKey } from "./client";

/**
 * 进程内缓存（LRU + TTL）。
 * 说明：
 * - 原 Redis 缓存的替代实现，消除跨境网络往返，命中时零延迟。
 * - 作用域为单个 Serverless 实例；多实例间失效不同步，写操作后仅当前实例
 *   缓存被清空，其他实例最长 TTL（60s）后自动回源，可接受。
 * - 接口签名与 Redis 版完全一致，调用方无需改动。
 */

interface CacheEntry {
  expiresAt: number;
  value: string;
}

const MAX_ENTRIES = 500;
const store = new Map<string, CacheEntry>();

export interface CacheOptions {
  ttlSeconds: number;
}

function sweep(now: number): void {
  if (store.size < MAX_ENTRIES) return;
  // 先清过期项，仍超限则淘汰最早写入的 key
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k);
  }
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export async function getOrSet<T>(
  namespace: string,
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions,
): Promise<T> {
  const fullKey = cacheKey(namespace, key);
  const now = Date.now();
  const hit = store.get(fullKey);
  if (hit && hit.expiresAt > now) {
    try {
      return JSON.parse(hit.value) as T;
    } catch {
      // 解析失败则回源
    }
  }
  const value = await fetcher();
  store.delete(fullKey); // 更新时刷新插入顺序（近似 LRU）
  store.set(fullKey, { expiresAt: now + options.ttlSeconds * 1000, value: JSON.stringify(value) });
  sweep(now);
  return value;
}

/** 删除指定 key */
export async function invalidateCache(namespace: string, key: string): Promise<void> {
  store.delete(cacheKey(namespace, key));
}

/** 按 namespace（可带前缀 pattern）批量删除缓存 */
export async function invalidateNamespace(namespace: string, pattern?: string): Promise<void> {
  const prefix = pattern && pattern !== "*" ? cacheKey(namespace, pattern) : cacheKey(namespace, "");
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}
