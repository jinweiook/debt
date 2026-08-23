import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

/**
 * mysql2 连接池单例。
 * 用 globalThis 缓存，防止 Next dev 热更新 / serverless 多实例重复建池导致连接爆炸。
 * 连接信息全部来自环境变量，禁止硬编码。
 */

export type Db = MySql2Database<typeof schema>;

declare global {
  // eslint-disable-next-line no-var
  var __debtPool: mysql.Pool | undefined;
  // eslint-disable-next-line no-var
  var __debtDb: Db | undefined;
}

function createPool(): mysql.Pool {
  const useSsl = process.env.DB_SSL === "true";
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    // 金额列 BIGINT 按字符串返回，在代码层转 number，避免精度丢失
    supportBigNumbers: true,
    bigNumberStrings: true,
    charset: "utf8mb4",
    ssl: useSsl ? { minVersion: "TLSv1.2", rejectUnauthorized: true } : undefined,
  });
}

export function getPool(): mysql.Pool {
  if (!globalThis.__debtPool) {
    globalThis.__debtPool = createPool();
  }
  return globalThis.__debtPool;
}

export function getDb(): Db {
  if (!globalThis.__debtDb) {
    globalThis.__debtDb = drizzle(getPool(), { schema, mode: "default" });
  }
  return globalThis.__debtDb;
}

/** 健康检查：返回延迟毫秒数，失败抛错 */
export async function pingDb(): Promise<number> {
  const start = Date.now();
  const pool = getPool();
  await pool.query("SELECT 1");
  return Date.now() - start;
}
