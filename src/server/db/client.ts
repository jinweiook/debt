import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import postgres from "postgres";
import mysql from "mysql2/promise";
import * as schema from "./schema";
import { getDialect, isMysql } from "./dialect";

/**
 * 双方言数据库连接单例。
 * - DB_DIALECT=mysql（默认）：mysql2 连接池，连本地 MySQL
 * - DB_DIALECT=postgres：postgres-js，连 Supabase Postgres（部署用）
 *
 * 用 globalThis 缓存，防止 Next dev 热更新 / serverless 多实例重复建池。
 * 连接信息全部来自环境变量，禁止硬编码。
 *
 * 注意：TS 侧 Db 类型以 pg 方言为准（schema.ts 同理），mysql 实例在边界处强转，
 * 运行时两方方言对 service 层使用的 select/insert/update/delete/transaction 行为一致。
 */

export type Db = PostgresJsDatabase<typeof schema>;
export type Sql = postgres.Sql<Record<string, never>> | mysql.Pool;

declare global {
  // eslint-disable-next-line no-var
  var __debtSql: Sql | undefined;
  // eslint-disable-next-line no-var
  var __debtDb: Db | undefined;
  // 由 src/instrumentation.ts 写入，标记连接池需要重建
  // eslint-disable-next-line no-var
  var __debtNeedsDbReset: boolean | undefined;
}

function createMysqlPool(): mysql.Pool {
  const database = process.env.DB_NAME || "debt";
  if (!process.env.DB_PASSWORD && process.env.NODE_ENV === "production") {
    console.warn("[db] 警告：未配置 DB_PASSWORD");
  }
  return mysql.createPool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database,
    charset: process.env.DB_CHARSET || "utf8mb4",
    connectionLimit: Number(process.env.DB_POOL_MAX ?? 5),
    waitForConnections: true,
    enableKeepAlive: true,
    // DATE/DATETIME 以字符串返回，交给 drizzle 转换，避免驱动按连接时区转换导致日期漂移
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
}

function createPgSql(): postgres.Sql<Record<string, never>> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("缺少环境变量 DATABASE_URL（Supabase → Connect → Transaction pooler）");
  }
  const useSsl = process.env.DB_SSL !== "false";
  return postgres(url, {
    // Supabase 事务池（pgBouncer transaction 模式）不支持预处理语句，必须关掉
    prepare: false,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idle_timeout: Number(process.env.DB_IDLE_TIMEOUT ?? 10),
    max_lifetime: Number(process.env.DB_MAX_LIFETIME ?? 300),
    connect_timeout: 10,
    ssl: useSsl ? "require" : false,
    connection: {
      statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT ?? 15_000),
      application_name: "debt-planner",
    },
  });
}

/** 原始客户端（脚本 / 健康检查用）：pg 为 postgres.Sql，mysql 为 Pool（均有 .end()） */
export function getSql(): Sql {
  // instrumentation 捕获到僵死连接相关的 rejection 后会打这个标记，
  // 这里同步丢弃旧池重建，实现自愈
  if (globalThis.__debtNeedsDbReset) {
    globalThis.__debtNeedsDbReset = false;
    void resetDb();
  }
  if (!globalThis.__debtSql) {
    globalThis.__debtSql = isMysql() ? createMysqlPool() : createPgSql();
  }
  return globalThis.__debtSql;
}

export function getDb(): Db {
  if (!globalThis.__debtDb) {
    const raw = getSql();
    globalThis.__debtDb = isMysql()
      ? (drizzleMysql(raw as mysql.Pool, { schema, mode: "default" }) as unknown as Db)
      : drizzlePg(raw as postgres.Sql<Record<string, never>>, { schema });
  }
  return globalThis.__debtDb;
}

/** 方言无关的裸 SQL（脚本用）。mysql 返回 rows，pg 返回 RowList。 */
export async function rawQuery<T = unknown>(text: string, params: unknown[] = []): Promise<T> {
  const raw = getSql();
  if (isMysql()) {
    const [rows] = await (raw as mysql.Pool).query(text, params);
    return rows as T;
  }
  return (await (raw as postgres.Sql).unsafe(text, params as never[])) as unknown as T;
}

/** 脚本用：主动关闭连接，否则 tsx 进程不会退出 */
export async function closeDb(): Promise<void> {
  await globalThis.__debtSql?.end();
  globalThis.__debtSql = undefined;
  globalThis.__debtDb = undefined;
}

/** 强制丢弃当前连接池，下次 getSql() 时重建（僵死连接自愈）。 */
export async function resetDb(): Promise<void> {
  const sql = globalThis.__debtSql;
  globalThis.__debtSql = undefined;
  globalThis.__debtDb = undefined;
  if (!sql) return;
  try {
    await Promise.race([sql.end(), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  } catch {
    // 关闭失败无所谓，反正这条连接已经不要了
  }
}

/** 健康检查：返回延迟毫秒数，失败抛错并丢弃连接池。 */
export async function pingDb(): Promise<number> {
  const start = Date.now();
  try {
    if (isMysql()) {
      await (getSql() as mysql.Pool).query("SELECT 1");
    } else {
      await (getSql() as postgres.Sql)`select 1`;
    }
    return Date.now() - start;
  } catch (err) {
    if (isStatementTimeout(err)) {
      console.error("[db] 健康检查触发 statement timeout（57014），已丢弃连接池准备重建。");
    }
    void resetDb();
    throw err;
  }
}

/** 57014 = pg canceling statement due to statement timeout */
export function isStatementTimeout(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const cause = (err as { cause?: { code?: string } })?.cause?.code;
  return code === "57014" || cause === "57014";
}

/** 连接僵死/断开的错误码（instrumentation 自愈判定用，覆盖两种方言） */
export function isConnectionDropped(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return (
    code === "57014" ||
    code === "ENETUNREACH" ||
    code === "ECONNRESET" ||
    code === "PROTOCOL_CONNECTION_LOST"
  );
}

export { getDialect };
