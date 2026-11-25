/**
 * 数据库方言开关：DB_DIALECT=mysql（默认，本地开发）| postgres（Supabase 部署）。
 * 方言差异只允许出现在 src/server/db/ 目录内，service 层不感知。
 */
export type Dialect = "mysql" | "postgres";

export function getDialect(): Dialect {
  return process.env.DB_DIALECT === "postgres" ? "postgres" : "mysql";
}

export function isMysql(): boolean {
  return getDialect() === "mysql";
}
