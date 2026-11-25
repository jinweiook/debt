/**
 * 重置开发数据库：清空所有表（含 users），自增归 1。
 * 用法：npm run db:reset
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { isMysql } from "../src/server/db/dialect";
import { rawQuery, closeDb } from "../src/server/db/client";

const TABLES = ["advances", "repayments", "installment_bills", "debt_accounts", "persons", "users", "login_attempts"];

async function main() {
  if (isMysql()) {
    // 无物理外键，直接逐表 TRUNCATE（MySQL TRUNCATE 会重置 AUTO_INCREMENT）
    for (const t of TABLES) {
      await rawQuery(`TRUNCATE TABLE \`${t}\``);
    }
  } else {
    // TRUNCATE RESTART IDENTITY 会清空数据并把 bigserial 重置为 1
    await rawQuery(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  }

  console.log("[reset] 已清空并重置自增");
  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error("[reset] 失败：", err.message ?? err);
  process.exit(1);
});
