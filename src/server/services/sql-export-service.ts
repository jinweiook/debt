import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getDialect, rawQuery } from "@/server/db/client";

/**
 * SQL 全量导出：建表结构 + 全部数据，生成可直接执行的 .sql 文件。
 * - mysql：用 SHOW CREATE TABLE 取当前库的真实表结构（含索引、字符集）
 * - postgres：读取 drizzle/pg 下的迁移 SQL 作为建表语句
 * 注意：包含 users 表（密码哈希），调用方必须限定管理员。
 */

/** 导出顺序：主表在前、从表在后，方便按文件顺序恢复 */
const TABLES = [
  "persons",
  "debt_accounts",
  "installment_bills",
  "repayments",
  "advances",
  "users",
  "roles",
  "role_permissions",
  "user_roles",
  "login_attempts",
] as const;

export interface SqlDump {
  filename: string;
  content: string;
}

export async function exportSqlDump(): Promise<SqlDump> {
  const mysql = getDialect() === "mysql";
  const now = new Date();
  const lines: string[] = [
    "-- 借还款规划 数据库备份",
    `-- 方言: ${mysql ? "mysql" : "postgres"}`,
    `-- 导出时间: ${now.toISOString()}`,
    `-- 内容: ${TABLES.length} 张表的建表语句与全部数据`,
    "",
  ];

  if (mysql) {
    lines.push("SET NAMES utf8mb4;", "SET FOREIGN_KEY_CHECKS = 0;", "");
  } else {
    lines.push("SET client_encoding = 'UTF8';", "");
  }

  lines.push(...(mysql ? await mysqlDdl() : await pgDdl()), "");

  for (const table of TABLES) {
    const rows = await rawQuery<Record<string, unknown>[]>(
      mysql ? `SELECT * FROM \`${table}\`` : `SELECT * FROM "${table}"`,
    );
    if (!rows.length) continue;
    lines.push(`-- ${table}: ${rows.length} 行`);
    lines.push(buildInsert(table, rows, mysql), "");
  }

  if (mysql) {
    lines.push("SET FOREIGN_KEY_CHECKS = 1;");
  } else {
    // pg 的 bigserial 序列不会随数据导入自动前进，必须手动对齐
    for (const table of TABLES) {
      if (table === "users" || table === "login_attempts") continue;
      lines.push(
        `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM "${table}"), 1));`,
      );
    }
  }

  const date = now.toISOString().slice(0, 10);
  return {
    filename: `debt-${mysql ? "mysql" : "postgres"}-${date}.sql`,
    content: lines.join("\n") + "\n",
  };
}

/** MySQL：取当前库真实建表语句 */
async function mysqlDdl(): Promise<string[]> {
  const out: string[] = [];
  for (const table of TABLES) {
    const rows = await rawQuery<Record<string, string>[]>(`SHOW CREATE TABLE \`${table}\``);
    const ddl = rows?.[0]?.["Create Table"];
    if (!ddl) throw new Error(`读取表 ${table} 的建表语句失败`);
    out.push(`DROP TABLE IF EXISTS \`${table}\`;`, `${ddl};`, "");
  }
  return out;
}

/** PostgreSQL：用 drizzle 迁移文件作为建表语句 */
async function pgDdl(): Promise<string[]> {
  const dir = path.join(process.cwd(), "drizzle", "pg");
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    throw new Error("未找到 drizzle/pg 迁移文件，无法生成建表语句");
  }
  if (!files.length) throw new Error("drizzle/pg 目录为空，无法生成建表语句");

  const statements: string[] = [];
  for (const file of files) {
    const text = await readFile(path.join(dir, file), "utf8");
    for (const part of text.split("--> statement-breakpoint")) {
      const stmt = part.trim();
      if (stmt) statements.push(stmt.endsWith(";") ? stmt : `${stmt};`);
    }
  }

  const drops = [...TABLES].reverse().map((t) => `DROP TABLE IF EXISTS "${t}" CASCADE;`);
  return [...drops, "", ...statements, ""];
}

function buildInsert(table: string, rows: Record<string, unknown>[], mysql: boolean): string {
  const quote = (name: string) => (mysql ? `\`${name}\`` : `"${name}"`);
  const escape = mysql ? escapeMysql : escapePg;
  const columns = Object.keys(rows[0]);
  const columnList = columns.map(quote).join(", ");

  const chunks: string[] = [];
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const values = rows
      .slice(i, i + BATCH)
      .map((row) => `(${columns.map((c) => escape(row[c])).join(", ")})`);
    chunks.push(`INSERT INTO ${quote(table)} (${columnList}) VALUES\n${values.join(",\n")};`);
  }
  return chunks.join("\n");
}

function escapeMysql(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Date) return `'${formatDate(value)}'`;
  const s = String(value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\0/g, "\\0")
    .replace(/\x1a/g, "\\Z");
  return `'${s}'`;
}

function escapePg(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return `'${formatDate(value)}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** 统一成 YYYY-MM-DD HH:mm:ss.SSS（UTC），避免时区二次偏移 */
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 23).replace("T", " ");
}
