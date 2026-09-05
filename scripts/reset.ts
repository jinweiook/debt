/**
 * 重置开发数据库：清空业务表 + 重置 bigserial 自增。
 * 注意：Supabase Auth 中的账号不会被清空，需要另用 Supabase 控制台手动清理。
 * 用法：./node_modules/.bin/tsx scripts/reset.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("缺少 DATABASE_URL");
    process.exit(1);
  }
  const useSsl = process.env.DB_SSL !== "false";
  const sql = postgres(url, { prepare: false, max: 1, ssl: useSsl ? "require" : false });

  // TRUNCATE RESTART IDENTITY 会清空数据并把 bigserial 重置为 1，比 MySQL 的 AUTO_INCREMENT=1 干净
  await sql.unsafe(`TRUNCATE TABLE
    advances,
    repayments,
    installment_bills,
    debt_accounts,
    persons,
    users,
    login_attempts
    RESTART IDENTITY CASCADE`);

  console.log("[reset] 已清空并重置自增");
  await sql.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("[reset] 失败：", err.message ?? err);
  process.exit(1);
});
