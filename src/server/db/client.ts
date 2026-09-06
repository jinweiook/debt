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
  // 由 src/instrumentation.ts 写入，标记连接池需要重建
  // eslint-disable-next-line no-var
  var __debtNeedsDbReset: boolean | undefined;
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
    /**
     * serverless 实例被冻结再解冻后，池里的连接会变成「半死」状态：
     * TCP 还在，但对端早已丢弃，查询会一直挂到 statement timeout（57014）。
     * 用 idle_timeout + max_lifetime 双保险强制轮换连接，避免复用僵死连接。
     */
    idle_timeout: Number(process.env.DB_IDLE_TIMEOUT ?? 10),
    // 单条连接最长存活 5 分钟，超时后下次请求自动新建
    max_lifetime: Number(process.env.DB_MAX_LIFETIME ?? 300),
    connect_timeout: 10,
    ssl: useSsl ? "require" : false,
    connection: {
      // 会话级语句超时：宁可快速失败并重建连接，也不要让请求挂死到网关超时
      statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT ?? 15_000),
      application_name: "debt-planner",
    },
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
  // instrumentation 捕获到僵死连接相关的 rejection 后会打这个标记，
  // 这里同步丢弃旧池重建，实现自愈（那里不能 import 本模块，否则 Edge 打包炸）
  if (globalThis.__debtNeedsDbReset) {
    globalThis.__debtNeedsDbReset = false;
    void resetDb();
  }
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

/**
 * 强制丢弃当前连接池，下次 getSql() 时重建。
 * 用于从「僵死连接」中自愈——serverless 实例冻结解冻后旧连接不可用。
 */
export async function resetDb(): Promise<void> {
  const sql = globalThis.__debtSql;
  globalThis.__debtSql = undefined;
  globalThis.__debtDb = undefined;
  if (!sql) return;
  try {
    // 僵死连接上 end() 也可能挂住，用 2s 超时兜底，超时就直接放弃
    await Promise.race([
      sql.end(),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  } catch {
    // 关闭失败无所谓，反正这条连接已经不要了
  }
}

/**
 * 健康检查：返回延迟毫秒数，失败抛错。
 *
 * 失败时顺手把连接池丢掉，这样下一个请求会拿到全新连接，
 * 而不是继续复用一条已经僵死的连接反复超时。
 */
export async function pingDb(): Promise<number> {
  const start = Date.now();
  try {
    await getSql()`select 1`;
    return Date.now() - start;
  } catch (err) {
    if (isStatementTimeout(err)) {
      console.error(
        "[db] 健康检查触发 statement timeout（57014），已丢弃连接池准备重建。\n" +
          "  常见原因：1) Supabase 项目处于暂停状态，需到 Dashboard 恢复；\n" +
          "  2) DATABASE_URL 不是 Transaction pooler（6543）；3) 数据库连接数已打满。",
      );
    }
    void resetDb();
    throw err;
  }
}

/** 57014 = canceling statement due to statement timeout */
export function isStatementTimeout(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const cause = (err as { cause?: { code?: string } })?.cause?.code;
  return code === "57014" || cause === "57014";
}
