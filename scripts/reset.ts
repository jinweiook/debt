/**
 * 重置开发数据库：清空全部数据并重置自增 ID。
 * 用法：./node_modules/.bin/tsx scripts/reset.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { getPool } from "../src/server/db/client";

async function main() {
  const pool = getPool();
  const tables = ["advances", "repayments", "installment_bills", "debt_accounts", "persons"];
  for (const t of tables) {
    await pool.query(`DELETE FROM ${t}`);
    await pool.query(`ALTER TABLE ${t} AUTO_INCREMENT = 1`);
  }
  console.log("[reset] 已清空并重置自增 ID");
  await pool.end();
  // 清理全局缓存，避免后续脚本复用已关闭的连接池
  globalThis.__debtPool = undefined;
  globalThis.__debtDb = undefined;
  process.exit(0);
}

main().catch((err) => {
  console.error("[reset] 失败：", err.message ?? err);
  process.exit(1);
});
