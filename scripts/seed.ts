/**
 * 演示数据种子脚本（可选）。
 * 用法：npm run db:seed
 * 需要先运行 npm run db:migrate 创建默认 admin，业务数据归属到 admin。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { getDb, closeDb } from "../src/server/db/client";
import { insertAndGetId } from "../src/server/db/helpers";
import * as schema from "../src/server/db/schema";
import { generateBills } from "../src/server/services/installment-service";

async function main() {
  const db = getDb();

  // 演示数据归属到管理员账号
  const [adminUser] = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  if (!adminUser) {
    console.error("users 表为空，请先运行 npm run db:migrate 初始化账号");
    process.exit(1);
  }
  const ownerId = adminUser.id;

  // 欠款人
  const personId = await insertAndGetId(db, schema.persons, {
    ownerUserId: ownerId,
    name: "张三",
    contact: "138****0001",
    note: "大学同学",
    defaultRepayDay: 15,
  });

  // 分期：招行 e 招贷 24000 元 / 12 期
  const bills = generateBills({
    principalCents: 2400000,
    termMonths: 12,
    firstDueDate: "2026-08-15",
    interestPerMonthCents: 12000,
  });
  const accountId = await insertAndGetId(db, schema.debtAccounts, {
    personId,
    type: "installment",
    title: "招行 e 招贷",
    source: "招商银行",
    principalCents: 2400000,
    remainingPrincipalCents: 2400000,
    interestType: "none",
    startDate: "2026-07-15",
    termMonths: 12,
  });
  await db.insert(schema.installmentBills).values(
    bills.map((b) => ({
      accountId,
      periodNo: b.periodNo,
      dueDate: b.dueDate,
      principalCents: b.principalCents,
      interestCents: b.interestCents,
      totalCents: b.principalCents + b.interestCents,
    })),
  );

  // 个人欠款：直接借出 5000 元，年化 6%
  await db.insert(schema.debtAccounts).values({
    personId,
    type: "personal",
    title: "直接借出",
    principalCents: 500000,
    remainingPrincipalCents: 500000,
    interestType: "annual",
    annualRateBps: 600,
    lastAccrualMonth: "2026-08",
    startDate: "2026-08-01",
    note: "应急周转",
  });

  console.log("[seed] 完成：1 个欠款人、1 笔 12 期分期、1 笔年化个欠");
  await closeDb();
}

main().catch(async (err) => {
  console.error("[seed] 失败：", err.message ?? err);
  process.exit(1);
});
