
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { getSql, pingDb } from "../src/server/db/client";

async function main() {
  console.log("正在尝试连接数据库...");
  console.log("DATABASE_URL:", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@"));
  try {
    const latency = await pingDb();
    console.log(`✅ 连接成功！延迟: ${latency}ms`);
  } catch (err) {
    console.error("❌ 连接失败:", err);
  } finally {
    const sql = getSql();
    await sql.end();
  }
}

main();
