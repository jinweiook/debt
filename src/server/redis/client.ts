/**
 * 缓存 key 构造工具。
 * 已从 Redis 迁移到进程内缓存（Serverless 实例内有效），
 * key 格式保持不变，便于未来如需再次迁移回共享缓存时零改动。
 */

export function cacheKey(namespace: string, key: string): string {
  return `debt:${namespace}:${key}`;
}
