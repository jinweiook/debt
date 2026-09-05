/**
 * 重置管理员密码（默认 456123，可用参数覆盖）。
 * 用法：
 *   npm run db:set-admin-password            # 重置为 456123
 *   npm run db:set-admin-password -- 888888   # 重置为 888888
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { eq } from "drizzle-orm";
import { getDb } from "../src/server/db/client";
import { users } from "../src/server/db/schema";
import { hashPassword } from "../src/server/services/auth-service";

async function main() {
  const newPassword = process.argv[2] || "456123";
  if (newPassword.length < 6 || newPassword.length > 64) {
    console.error("密码长度需为 6-64 位");
    process.exit(1);
  }

  const db = getDb();
  const adminUsername = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
  const [admin] = await db
    .select()
    .from(users)
    .where(eq(users.username, adminUsername))
    .limit(1);
  if (!admin) {
    console.error(`找不到管理员账号 ${adminUsername}，请先运行 npm run db:migrate 初始化`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, admin.id));
  console.log(`[set-admin-password] 已将 ${adminUsername} 的密码重置为 ${newPassword}（scrypt 加盐哈希）`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[set-admin-password] 失败：", err.message ?? err);
  process.exit(1);
});
