/**
 * 数据库初始化脚本：执行 drizzle migrations 并写入默认管理员账号。
 * 用法：pnpm db:migrate（读取 .env.local 或环境变量）
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import { seedDefaultAdmin } from "@/server/services/auth-service";

async function main() {
  const useSsl = process.env.DB_SSL === "true";
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
    ssl: useSsl ? { minVersion: "TLSv1.2", rejectUnauthorized: true } : undefined,
  });
  const db = drizzle(connection);
  console.log(`[init-db] 连接 ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME} ...`);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[init-db] migration 执行完成");

  await seedDefaultAdmin();

  await connection.end();
}

main().catch((err) => {
  console.error("[init-db] 失败：", err.message ?? err);
  process.exit(1);
});
