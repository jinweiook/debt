/**
 * 数据库连通性检查。
 * 用法：./node_modules/.bin/tsx scripts/ping.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { getDialect, pingDb, closeDb } from "../src/server/db/client";

async function main() {
  console.log(`正在尝试连接数据库（${getDialect()}）...`);
  try {
    const latency = await pingDb();
    console.log(`✅ 连接成功！延迟: ${latency}ms`);
  } catch (err) {
    console.error("❌ 连接失败:", err);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

main();
