/**
 * 数据库初始化脚本（双方言，按 DB_DIALECT 分支）：
 * - mysql（默认）：先用无库连接 CREATE DATABASE IF NOT EXISTS，再跑 drizzle/mysql 迁移
 * - postgres：跑 drizzle/pg 迁移（优先 DIRECT_URL 直连，事务池不支持 DDL）
 * 最后 seed 默认管理员（本地 scrypt 哈希写 users 表）。
 * 用法：npm run db:migrate（读取 .env.local 或环境变量）
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { isMysql } from "../src/server/db/dialect";
import { seedDefaultAdmin } from "../src/server/services/auth-service";
import { seedDefaultRbac } from "../src/server/services/rbac-service";

async function main() {
  if (isMysql()) {
    await migrateMysql();
  } else {
    await migratePostgres();
  }
  console.log("[init-db] migration 执行完成");

  // seedDefaultAdmin 走 getDb() 单例（与迁移同一方言配置）
  await seedDefaultAdmin();
  await seedDefaultRbac();

  const { closeDb } = await import("../src/server/db/client");
  await closeDb();
}

async function migrateMysql() {
  const { drizzle } = await import("drizzle-orm/mysql2");
  const { migrate } = await import("drizzle-orm/mysql2/migrator");
  const mysql = await import("mysql2/promise");
  const schema = await import("../src/server/db/schema.mysql");

  const connInfo = {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
  };
  const database = process.env.DB_NAME || "debt";
  console.log(`[init-db] 连接 MySQL ${connInfo.host}:${connInfo.port}...`);

  // 1. 无库连接：建库（幂等），已有库也纠正为 utf8mb4
  const bootstrap = await mysql.createConnection(connInfo);
  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await bootstrap.query(
    `ALTER DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await bootstrap.end();
  console.log(`[init-db] 数据库 ${database} 已就绪（utf8mb4）`);

  // 2. 跑迁移
  const pool = mysql.createPool({ ...connInfo, database, connectionLimit: 1 });
  const db = drizzle(pool, { schema, mode: "default" });
  await migrate(db, { migrationsFolder: "./drizzle/mysql" });

  // 3. drizzle 生成的建表语句不带 ENGINE / CHARSET，会跟随服务器默认值
  //    （本项目实测环境默认 MyISAM + utf8），这里统一纠正为 InnoDB + utf8mb4
  await normalizeMysqlTables(pool, database);
  await pool.end();
}

async function normalizeMysqlTables(pool: any, database: string) {
  const [rows] = (await pool.query(
    `SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_COLLATION AS collation
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
    [database],
  )) as any;

  for (const t of rows) {
    if (t.engine === "InnoDB" && String(t.collation).startsWith("utf8mb4")) continue;
    await pool.query(
      `ALTER TABLE \`${t.name}\` ENGINE=InnoDB, CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    console.log(`[init-db] ${t.name}: ${t.engine}/${t.collation} → InnoDB/utf8mb4`);
  }
}

async function migratePostgres() {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const postgres = (await import("postgres")).default;
  const schema = await import("../src/server/db/schema.pg");

  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("缺少 DATABASE_URL / DIRECT_URL（Supabase → Connect → Direct → Session 模式）");
  }
  const useSsl = process.env.DB_SSL !== "false";
  const sql = postgres(url, { prepare: false, max: 1, ssl: useSsl ? "require" : false, connect_timeout: 15 });

  const u = new URL(url);
  console.log(`[init-db] 连接 Postgres ${u.host}:${u.port}...`);
  await sql`SELECT 1`;

  const db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder: "./drizzle/pg" });
  await sql.end();
}

main().catch(async (err: any) => {
  console.error("\n[init-db] 失败：\n", err?.message ?? err);
  if (err?.code === "ECONNREFUSED") {
    console.error("💡 连接被拒绝：确认 MySQL 服务已启动，且 host/port 配置正确");
  } else if (err?.code === "ER_ACCESS_DENIED_ERROR" || err?.code === "28P01") {
    console.error("💡 账号或密码错误：检查 DB_USER / DB_PASSWORD");
  }
  process.exit(1);
});
