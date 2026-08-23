/**
 * 生成 bcrypt 密码哈希。
 * 用法：npx tsx scripts/hash-password.ts <明文密码>
 */
import { hashPassword } from "@/server/services/auth-service";

async function main() {
  const plain = process.argv[2];
  if (!plain) {
    console.error("用法：npx tsx scripts/hash-password.ts <明文密码>");
    process.exit(1);
  }
  const hash = await hashPassword(plain);
  console.log(hash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
