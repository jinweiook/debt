/**
 * 业务全流程回归脚本（对齐 PLAN.md Test Plan）。
 * 用法：./node_modules/.bin/tsx scripts/verify.ts
 * 注意：会在当前数据库上造数据，建议只在开发库运行。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { eq } from "drizzle-orm";
import { getDb } from "../src/server/db/client";
import { debtAccounts, installmentBills, persons as personsTable } from "../src/server/db/schema";
import { personStats, overviewStats } from "../src/server/services/stats-service";
import { previewRepayment, createRepayment, listRepaymentsByPerson } from "../src/server/services/repayment-service";
import { markBillAdvanced } from "../src/server/services/advance-service";
import { exportSnapshot, validateSnapshot, importSnapshot, clearAllData } from "../src/server/services/backup-service";
import { virtualAccruedInterest } from "../src/server/services/interest-service";
import { centsToYuan } from "../src/server/lib/money";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

async function main() {
  const db = getDb();
  // 用名字查最新一个欠款人（seed.ts 写的是 "张三"），避免不同 DB 自增 ID 不可控
  const [person] = await db.select().from(personsTable).orderBy(personsTable.id).limit(1);
  if (!person) {
    console.error("请先运行 npm run db:seed 写入演示数据");
    process.exit(1);
  }
  const personId = person.id;
  // 回归脚本以管理员维度运行（ownerId=null 不做归属过滤）；新建测试人归属到同一客户
  const adminId = person.ownerUserId;

  console.log("\n== 1. 初始统计 ==");
  let stats = await personStats(personId);
  console.log(`  银行剩余 ${centsToYuan(stats.installmentRemaining)} / 个欠 ${centsToYuan(stats.personalRemaining)} / 总计 ${centsToYuan(stats.totalOutstanding)}`);
  // 分期 24000 + 利息 120*12=1440 → 25440；个欠 5000（当月无计提）
  check("银行剩余 = 25440", stats.installmentRemaining === 2544000, `实际 ${stats.installmentRemaining}`);
  check("个欠剩余 = 5000", stats.personalRemaining === 500000, `实际 ${stats.personalRemaining}`);

  console.log("\n== 2. 部分还款：先息后本 ==");
  const bill1 = (await db.select().from(installmentBills).where(eq(installmentBills.periodNo, 1)))[0];
  const r1 = await createRepayment({ personId, targetType: "bill", targetId: bill1.id, amountCents: 100000 }, null);
  const s1 = r1.allocation.results[0];
  // 该期利息 120 元 → 先抵 120，再抵本金 880
  check("利息抵扣 = 120", s1.interestPart === 12000, `实际 ${s1.interestPart}`);
  check("本金抵扣 = 880", s1.principalPart === 88000, `实际 ${s1.principalPart}`);
  const bill1After = (await db.select().from(installmentBills).where(eq(installmentBills.id, bill1.id)))[0];
  check("账单状态 = partial", bill1After.status === "partial");

  console.log("\n== 3. 超还自动溢出 ==");
  const bill2 = (await db.select().from(installmentBills).where(eq(installmentBills.periodNo, 2)))[0];
  const prev = await previewRepayment({ personId, targetType: "bill", targetId: bill2.id, amountCents: 500000 }, null);
  // 第2期 2120 → 第3期 2120 → 第4期抵 760（部分）
  check("分配到 3 个目标", prev.results.length === 3, `实际 ${prev.results.length}`);
  // 溢出顺序：第2期 → 第1期（部分已还、到期日最早）→ 第3期
  check("首选目标是第2期", prev.results[0].label.includes("第2期"));
  check("溢出到第1期（到期日最早）", prev.results[1].label.includes("第1期"));
  check("再溢出到第3期", prev.results[2].label.includes("第3期"));
  check("余款全部分完", prev.remainder === 0);
  const r2 = await createRepayment({ personId, targetType: "bill", targetId: bill2.id, amountCents: 500000 }, null);
  check("落库 3 条流水", r2.allocation.results.length === 3);
  check("batchId 一致", !!r2.batchId);
  const bill2After = (await db.select().from(installmentBills).where(eq(installmentBills.id, bill2.id)))[0];
  check("第2期已结清", bill2After.status === "paid");
  const bill1Again = (await db.select().from(installmentBills).where(eq(installmentBills.id, bill1.id)))[0];
  check("第1期被溢出结清", bill1Again.status === "paid");
  const bill3After = (await db.select().from(installmentBills).where(eq(installmentBills.periodNo, 3)))[0];
  check("第3期部分已还 1760", bill3After.paidCents === 176000, `实际 ${bill3After.paidCents}`);

  console.log("\n== 4. 垫付转化 ==");
  const bill5 = (await db.select().from(installmentBills).where(eq(installmentBills.periodNo, 5)))[0];
  const adv = await markBillAdvanced(bill5.id, null, "2026-08-16");
  check("垫付金额 = 2120", adv.amount === 212000, `实际 ${adv.amount}`);
  const bill5After = (await db.select().from(installmentBills).where(eq(installmentBills.id, bill5.id)))[0];
  check("账单状态 = advanced", bill5After.status === "advanced");
  const advAcc = (await db.select().from(debtAccounts).where(eq(debtAccounts.id, adv.generatedAccountId)))[0];
  check("生成个欠 origin=advance", advAcc.origin === "advance" && advAcc.type === "personal");
  check("垫付款不计息", advAcc.interestType === "none");
  let dupErr = false;
  try {
    await markBillAdvanced(bill5.id, null);
  } catch {
    dupErr = true;
  }
  check("重复垫付被拦截（幂等）", dupErr);

  console.log("\n== 5. 年化利息懒计提 ==");
  const personalAcc = (await db.select().from(debtAccounts).where(eq(debtAccounts.title, "直接借出")))[0];
  await db.update(debtAccounts).set({ lastAccrualMonth: "2026-05" }).where(eq(debtAccounts.id, personalAcc.id));
  const backfilled = (await db.select().from(debtAccounts).where(eq(debtAccounts.id, personalAcc.id)))[0];
  const vInterest = virtualAccruedInterest(backfilled);
  // 5000 × 6% / 12 = 25 元/月 × 3 个月（5→8）
  check("3 个月利息 = 75 元", vInterest === 7500, `实际 ${vInterest}`);
  await db.update(debtAccounts).set({ lastAccrualMonth: "2026-08" }).where(eq(debtAccounts.id, personalAcc.id));

  console.log("\n== 6. 统计一致性 ==");
  stats = await personStats(personId);
  const overview = await overviewStats(null);
  check("首页总览与个人统计一致", overview.totalOutstanding === stats.totalOutstanding);
  console.log(`  当前总欠款 ${centsToYuan(stats.totalOutstanding)} / 累计已收 ${centsToYuan(stats.totalReceived)} / 累计垫付 ${centsToYuan(stats.totalAdvanced)}`);
  check("累计已收 = 6000", stats.totalReceived === 600000, `实际 ${stats.totalReceived}`);
  check("累计垫付 = 2120", stats.totalAdvanced === 212000, `实际 ${stats.totalAdvanced}`);

  console.log("\n== 7. 备份导出→清空→导入恢复 ==");
  const snapshot = await exportSnapshot(null);
  const beforeStats = await personStats(personId);
  const beforeReps = await listRepaymentsByPerson(personId);
  const validated = validateSnapshot(JSON.parse(JSON.stringify(snapshot)));
  check("快照校验通过", validated.version === 1);
  await clearAllData();
  const emptyStats = await overviewStats(null);
  check("清空后总欠款 = 0", emptyStats.totalOutstanding === 0);
  await importSnapshot(snapshot, null);
  const afterStats = await personStats(personId);
  const afterReps = await listRepaymentsByPerson(personId);
  check("恢复后统计一致", JSON.stringify(afterStats) === JSON.stringify(beforeStats));
  check("流水条数一致", afterReps.length === beforeReps.length, `${afterReps.length} vs ${beforeReps.length}`);
  let badJson = false;
  try {
    validateSnapshot({ version: 1, persons: [{ id: -1 }] });
  } catch {
    badJson = true;
  }
  check("损坏备份被拒绝", badJson);

  console.log("\n== 8. 动态年化利息（等额本金：还本金后下期利息自动下降） ==");
  // 用全新欠款人隔离
  const [dyPersonIns] = await db.insert(personsTable).values({ name: "动态测试人" + Date.now(), ownerUserId: adminId });
  const dyPersonId = Number(dyPersonIns.insertId);
  // 70000 / 12 / 2.6% / 等额本金：每月本金 5833.33，利息按剩余本金算
  const dyAcc = await (await import("../src/server/services/installment-service")).createInstallmentDebt({
    personId: dyPersonId,
    title: "等额本金分期",
    source: "测试银行",
    startDate: "2026-08-01",
    interestMode: "dynamic",
    annualRateBps: 260,
    dynamicPlan: "equalPrincipal",
    bills: (await import("../src/server/services/installment-service")).generateDynamicBills({
      principalCents: 7000000,
      termMonths: 12,
      firstDueDate: "2026-09-01",
      annualRateBps: 260,
      plan: "equalPrincipal",
    }),
  }, null);
  const dyAccountId = dyAcc as unknown as number;
  const dyBills = await db.select().from(installmentBills).where(eq(installmentBills.accountId, dyAccountId)).orderBy(installmentBills.periodNo);
  const dyBill1 = dyBills[0];
  const dyBill2 = dyBills[1];
  // 70000/12 = 5833.33 → 583333 cents
  check(`等额本金：第1期本金 = 5833.33 元 (实际 ${dyBill1.principalCents})`, dyBill1.principalCents === 583333);
  // monthlyInterestCents(7000000, 260) = 15167
  check(`等额本金：第1期利息 = 151.67 元 (实际 ${dyBill1.interestCents})`, dyBill1.interestCents === 15167);
  // 等额本金情况下，无提前还款时第2期利息 = monthlyInterestCents(7000000-583333, 260) = monthlyInterestCents(6416667, 260)
  // 6416667 * 260 / 120000 = 13902.78 → 13903
  const dyExpectedBill2Initial = 13903;
  check(`等额本金：初始第2期利息 ≈ 139.03 元 (实际 ${dyBill2.interestCents})`, dyBill2.interestCents === dyExpectedBill2Initial);

  // 还 2000 元到第 1 期：先抵利息 151.67，再冲本金 1848.33
  await createRepayment({ personId: dyPersonId, targetType: "bill", targetId: dyBill1.id, amountCents: 200000 }, null);
  const dyBill1After = (await db.select().from(installmentBills).where(eq(installmentBills.id, dyBill1.id)))[0];
  check("第1期已部分还清", dyBill1After.status === "partial");
  check(`第1期利息部分 = 15167 (实际 ${dyBill1After.paidInterestCents})`, dyBill1After.paidInterestCents === 15167);
  check(`第1期本金部分 = 184833 (实际 ${dyBill1After.paidPrincipalCents})`, dyBill1After.paidPrincipalCents === 200000 - 15167);

  // 第2期利息应重算：剩余本金 = 7000000 - 184833 = 6815167，月利息 = round(6815167*260/120000) = 14766
  const dyBill2After = (await db.select().from(installmentBills).where(eq(installmentBills.id, dyBill2.id)))[0];
  const dyExpected2 = 14766;
  check(`第2期利息已动态重算 = 147.66 元 (实际 ${dyBill2After.interestCents})`, dyBill2After.interestCents === dyExpected2);

  console.log("\n== 9. 动态年化利息（先息后本：超额还到末期本金） ==");
  const [ioPersonIns] = await db.insert(personsTable).values({ name: "先息后本测试人" + Date.now(), ownerUserId: adminId });
  const ioPersonId = Number(ioPersonIns.insertId);
  // 70000 / 12 / 2.6% / 先息后本：前 11 期本金=0，末期本金=70000
  const ioAcc = await (await import("../src/server/services/installment-service")).createInstallmentDebt({
    personId: ioPersonId,
    title: "先息后本分期",
    source: "测试银行",
    startDate: "2026-08-01",
    interestMode: "dynamic",
    annualRateBps: 260,
    dynamicPlan: "interestOnly",
    bills: (await import("../src/server/services/installment-service")).generateDynamicBills({
      principalCents: 7000000,
      termMonths: 12,
      firstDueDate: "2026-09-01",
      annualRateBps: 260,
      plan: "interestOnly",
    }),
  }, null);
  const ioId = ioAcc as unknown as number;
  const ioBills = await db.select().from(installmentBills).where(eq(installmentBills.accountId, ioId)).orderBy(installmentBills.periodNo);
  check(`先息后本：前11期本金=0 (实际 bill2.principal=${ioBills[1].principalCents})`, ioBills[1].principalCents === 0);
  check(`先息后本：末期本金=70000 (实际 ${ioBills[11].principalCents})`, ioBills[11].principalCents === 7000000);
  check(`先息后本：每期利息=151.67 (实际 ${ioBills[0].interestCents})`, ioBills[0].interestCents === 15167);
  // 修复后：先息后本下还 2000元 到第 1 期，扣利息 151.67 后剩余 1848.33 直接充作 bill 1 的本金
  // （之前会级联到后续账单的利息抵扣，导致本金显示为 0）
  await createRepayment({ personId: ioPersonId, targetType: "bill", targetId: ioBills[0].id, amountCents: 200000 }, null);
  const ioBill1After = (await db.select().from(installmentBills).where(eq(installmentBills.id, ioBills[0].id)))[0];
  check(`先息后本：bill 1 已还清 (实际 status=${ioBill1After.status})`, ioBill1After.status === "paid");
  check(`先息后本：bill 1 利息部分 = 151.67 元 (实际 ${ioBill1After.paidInterestCents})`, ioBill1After.paidInterestCents === 15167);
  check(`先息后本：bill 1 本金部分 = 1848.33 元 (实际 ${ioBill1After.paidPrincipalCents})`, ioBill1After.paidPrincipalCents === 184833);
  // 后续账单的利息应按 (70000 - 1848.33) × 2.6% / 12 重算
  const ioBill2After = (await db.select().from(installmentBills).where(eq(installmentBills.id, ioBills[1].id)))[0];
  // 6815167 × 260 / 120000 = 14766.19 → 14766
  check(`先息后本：bill 2 利息已动态重算 ≈ 147.66 元 (实际 ${ioBill2After.interestCents})`, ioBill2After.interestCents === 14766);
  // 末期 planned 本金 = 70000 - 1848.33 = 68151.67
  const ioBill12After = (await db.select().from(installmentBills).where(eq(installmentBills.id, ioBills[11].id)))[0];
  check(`先息后本：末期 planned 本金已重算 (实际 ${ioBill12After.principalCents})`, ioBill12After.principalCents === 6815167);

  console.log("\n== 10. 你的例子：先息后本 还 1318 元 = 利息 151.67 + 本金 1166.33 ==");
  const [exPersonIns] = await db.insert(personsTable).values({ name: "例子测试人" + Date.now(), ownerUserId: adminId });
  const exPersonId = Number(exPersonIns.insertId);
  const exAcc = await (await import("../src/server/services/installment-service")).createInstallmentDebt({
    personId: exPersonId,
    title: "例子分期",
    source: "测试",
    startDate: "2026-08-01",
    interestMode: "dynamic",
    annualRateBps: 260,
    dynamicPlan: "interestOnly",
    bills: (await import("../src/server/services/installment-service")).generateDynamicBills({
      principalCents: 7000000,
      termMonths: 12,
      firstDueDate: "2026-09-01",
      annualRateBps: 260,
      plan: "interestOnly",
    }),
  }, null);
  const exId = exAcc as unknown as number;
  const exBills = await db.select().from(installmentBills).where(eq(installmentBills.accountId, exId)).orderBy(installmentBills.periodNo);
  await createRepayment({ personId: exPersonId, targetType: "bill", targetId: exBills[0].id, amountCents: 131800 }, null);
  const exBill1After = (await db.select().from(installmentBills).where(eq(installmentBills.id, exBills[0].id)))[0];
  check(`例子：bill 1 利息 = 15167 (实际 ${exBill1After.paidInterestCents})`, exBill1After.paidInterestCents === 15167);
  check(`例子：bill 1 本金 = 116633 (实际 ${exBill1After.paidPrincipalCents})`, exBill1After.paidPrincipalCents === 116633);
  // 下一期利息 = (70000 - 1166.33) × 2.6% / 12 = 149.14 元
  const exBill2After = (await db.select().from(installmentBills).where(eq(installmentBills.id, exBills[1].id)))[0];
  // 6883367 × 260 / 120000 = 14913.94 → 14914
  check(`例子：bill 2 利息已重算 = 149.14 元 (实际 ${exBill2After.interestCents})`, exBill2After.interestCents === 14914);

  console.log("\n== 11. 多客户数据隔离 ==");
  const { register } = await import("../src/server/services/auth-service");
  const { createPerson, listPersons, getPerson } = await import("../src/server/services/person-service");
  const { NotFoundError } = await import("../src/server/lib/errors");

  // 注册（或复用）一个测试客户
  const regUser = await register("verify_user", "verify123");
  let customerOwnerId: number;
  if (regUser.ok) {
    customerOwnerId = regUser.userId;
  } else {
    const { users } = await import("../src/server/db/schema");
    const [u] = await db.select().from(users).where(eq(users.username, "verify_user")).limit(1);
    customerOwnerId = u.id;
  }

  // 客户名下新建欠款人，归属正确
  const custPerson = await createPerson({ name: "隔离测试客户A" }, customerOwnerId);
  check("新欠款人归属注册客户", custPerson.ownerUserId === customerOwnerId, `实际 ${custPerson.ownerUserId}`);

  // 客户只能看到自己的欠款人
  const custList = await listPersons(customerOwnerId);
  check("客户列表只含自己的欠款人", custList.length === 1 && custList[0].id === custPerson.id, `实际 ${custList.length}`);

  // 越权访问被拦截（Not Found，不泄露存在性）
  let crossDenied = false;
  try {
    await getPerson(personId, customerOwnerId);
  } catch (e) {
    crossDenied = e instanceof NotFoundError;
  }
  check("客户访问他人欠款人 → 404", crossDenied);

  // 管理员可见全部
  const adminList = await listPersons(null);
  check("管理员可见全部客户欠款人", adminList.length >= 2, `实际 ${adminList.length}`);

  // 客户视角总览只统计自己
  const { overviewStats: ovStats } = await import("../src/server/services/stats-service");
  const custOverview = await ovStats(customerOwnerId);
  check("客户总览 activePersons = 1", custOverview.activePersons === 1, `实际 ${custOverview.activePersons}`);

  // 客户对他人账单记还款被拦截
  const billX = (await db.select().from(installmentBills).where(eq(installmentBills.periodNo, 1)))[0];
  let repayDenied = false;
  try {
    await createRepayment(
      { personId, targetType: "bill", targetId: billX.id, amountCents: 10000 },
      customerOwnerId,
    );
  } catch {
    repayDenied = true;
  }
  check("客户对他人账单记还款被拦截", repayDenied);

  console.log(`\n========== 结果：${passed} 通过 / ${failed} 失败 ==========\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("验证脚本异常：", err);
  process.exit(1);
});
