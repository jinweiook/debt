import dns from "node:dns";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * postgres.js 连接单例（Supabase Postgres）。
 * 用 globalThis 缓存，防止 Next dev 热更新 / serverless 多实例重复建池导致连接爆炸。
 * 连接信息全部来自环境变量，禁止硬编码。
 */

/**
 * 强制 IPv4 优先解析。
 *
 * 背景：Supabase 的 Direct connection（端口 5432）在部分网络下会解析到 IPv6 地址，
 * 而 EdgeOne Pages / 多数 serverless 平台不支持 IPv6 出站，会直接抛
 * `connect ENETUNREACH <ipv6>:5432 - Local (:::0)`，页面全部 500。
 * Node 20+ 默认 DNS 解析顺序是 verbatim（DNS 返回什么就用什么），
 * 改成 ipv4first 后只要目标主机有 A 记录就会走 IPv4。
 *
 * 注意：这只是兜底。DATABASE_URL 仍应优先使用 Transaction pooler（端口 6543），
 * 它在 Supabase 侧就是面向 serverless 设计的 IPv4 入口。
 */
dns.setDefaultResultOrder("ipv4first");

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
  warnIfDirectConnection(url);
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

/**
 * 端口 5432 是 Supabase Direct connection，不是给 serverless 用的：
 * 它会解析到 IPv6，在 EdgeOne Pages / Vercel 这类环境会 ENETUNREACH。
 * 运行时只给警告不阻断，避免本地用直连跑迁移时被打断。
 */
function warnIfDirectConnection(url: string): void {
  try {
    const { port } = new URL(url);
    if (port === "5432") {
      console.warn(
        "[db] 警告：DATABASE_URL 使用了直连端口 5432。serverless 环境请改用 Transaction pooler（端口 6543），" +
          "否则很可能出现 connect ENETUNREACH <IPv6>:5432。",
      );
    }
  } catch {
    // URL 解析失败交给 postgres 自己报错
  }
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
