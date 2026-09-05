/**
 * 数据库初始化脚本（Supabase Postgres）：
 * 1. 跑 drizzle migrations（建表）
 * 2. 在 Supabase Auth 建默认管理员 + 业务侧 users 档案
 * 用法：npm run db:migrate（读取 .env.local 或环境变量）
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "../src/server/db/schema";
import { seedDefaultAdmin } from "../src/server/services/auth-service";

async function main() {
  // 迁移优先用 DIRECT_URL（直连 5432 端口），事务池不支持 DDL
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("缺少 DATABASE_URL / DIRECT_URL（Supabase → Connect → Direct → Session 模式）");
    process.exit(1);
  }
  const isDirect = !!process.env.DIRECT_URL;

  const useSsl = process.env.DB_SSL !== "false";
  const sql = postgres(url, {
    // Supabase 事务池 pgBouncer 不支持预处理；直连也保持关闭以兼容
    prepare: false,
    max: 1,
    ssl: useSsl ? "require" : false,
    // 连接超时（毫秒）
    connect_timeout: 15,
  });
  // 关联 schema，让 seedDefaultAdmin 通过同一个 db 实例访问表
  const db = drizzle(sql, { schema });

  const u = new URL(url);
  console.log(`[init-db] 连接 ${u.host}:${u.port}（${isDirect ? "直连模式" : "事务池模式 - 不建议跑 DDL"}）...`);

  // 先跑一个简单查询验证连接和权限
  try {
    const [{ now }] = await sql<[{ now: string }]>`SELECT NOW() as now`;
    console.log(`[init-db] 连接成功，服务器时间: ${now}`);
  } catch (testErr: any) {
    throw new Error(`连接测试失败（检查密码/网络/IP白名单）: ${testErr.message ?? testErr}`);
  }

  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[init-db] migration 执行完成");

  // 把同一个 db 实例传进去，避免 seedDefaultAdmin 里 getDb() 再建可能错误的连接
  await seedDefaultAdmin(db as any);

  await sql.end();
}

/**
 * 格式化 Postgres 错误对象，输出详细信息
 * Postgres 错误常见字段：code, detail, hint, position, where, table, column 等
 */
function formatPgError(err: any): string {
  if (!err || typeof err !== "object") return String(err);
  const lines: string[] = [];
  lines.push(err.message ?? "未知错误");
  // 逐行打印错误的关键字段（如果存在）
  const fields = ["code", "severity", "detail", "hint", "where", "table", "column", "constraint"];
  for (const f of fields) {
    if (err[f]) lines.push(`  ${f}: ${err[f]}`);
  }
  return lines.join("\n");
}

main().catch(async (err: any) => {
  console.error("\n[init-db] 失败：\n", formatPgError(err));
  // 额外提示
  if (!process.env.DIRECT_URL) {
    console.error("\n💡 提示：请在 .env.local 中配置 DIRECT_URL（直连 5432 端口），事务池无法执行建表语句");
  }
  const code = err?.code;
  if (code === "28P01" || code === "28000") {
    console.error("💡 密码错误或用户不存在：检查连接串里的数据库密码");
  } else if (code === "42501") {
    console.error("💡 权限不足：确认连接用户是 postgres，且对数据库有 CREATE 权限");
  } else if (code === "08006" || code === "ETIMEDOUT" || code === "ECONNREFUSED") {
    console.error("💡 连接失败：检查 IP 白名单（Supabase → Settings → Database → IP Allowlist）或网络");
  }
  process.exit(1);
});
