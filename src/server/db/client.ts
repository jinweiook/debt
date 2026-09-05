import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * postgres.js 连接单例（Supabase Postgres）。
 * 用 globalThis 缓存，防止 Next dev 热更新 / serverless 多实例重复建池导致连接爆炸。
 * 连接信息全部来自环境变量，禁止硬编码。
 */

export type Db = PostgresJsDatabase<typeof schema>;
export type Sql = postgres.Sql<Record<string, never>>;

declare global {
  // eslint-disable-next-line no-var
  var __debtSql: Sql | undefined;
  // eslint-disable-next-line no-var
  var __debtDb: Db | undefined;
}

function createSql(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("缺少环境变量 DATABASE_URL（Supabase → Connect → Transaction pooler）");
  }
  const useSsl = process.env.DB_SSL !== "false";
  return postgres(url, {
    // Supabase 事务池（pgBouncer transaction 模式）不支持预处理语句，必须关掉
    prepare: false,
    // serverless 每实例只占 1 条连接，多路复用交给 Supabase 池，避免连接耗尽
    max: Number(process.env.DB_POOL_MAX ?? 1),
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: useSsl ? "require" : false,
  }) as Sql;
}

/** 原始 SQL 客户端（脚本 / 健康检查用） */
export function getSql(): Sql {
  if (!globalThis.__debtSql) {
    globalThis.__debtSql = createSql();
  }
  return globalThis.__debtSql;
}

export function getDb(): Db {
  if (!globalThis.__debtDb) {
    globalThis.__debtDb = drizzle(getSql(), { schema });
  }
  return globalThis.__debtDb;
}

/** 脚本用：主动关闭连接，否则 tsx 进程不会退出 */
export async function closeDb(): Promise<void> {
  await globalThis.__debtSql?.end();
  globalThis.__debtSql = undefined;
  globalThis.__debtDb = undefined;
}

/** 健康检查：返回延迟毫秒数，失败抛错 */
export async function pingDb(): Promise<number> {
  const start = Date.now();
  await getSql()`select 1`;
  return Date.now() - start;
}
