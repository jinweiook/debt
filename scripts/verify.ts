/**
 * 业务全流程回归脚本（对齐 PLAN.md Test Plan）。
 * 用法：./node_modules/.bin/tsx scripts/verify.ts
 * 注意：会在当前数据库上造数据，建议只在开发库运行。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { eq } from "drizzle-orm";
import { getDb, closeDb } from "../src/server/db/client";
import { debtAccounts, installmentBills, persons as personsTable, users as usersTable } from "../src/server/db/schema";
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
  // 分期 24000 + 利息 120*12=1440 → 25440
  check("银行剩余 = 25440", stats.installmentRemaining === 2544000, `实际 ${stats.installmentRemaining}`);
  // 个欠 5000 + 年化 6% 懒计提（25 元/月，计提月数随当前日期动态变化）
  const { currentMonth, diffMonths } = await import("../src/server/lib/dates");
  const accruedMonths = Math.max(diffMonths(currentMonth(), "2026-08"), 0);
  const expectedPersonal = 500000 + 2500 * accruedMonths;
  check(`个欠剩余 = ${centsToYuan(expectedPersonal)}（含 ${accruedMonths} 个月计提）`, stats.personalRemaining === expectedPersonal, `实际 ${stats.personalRemaining}`);

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
  // 把计提起点回拨到 3 个月前、已计提清零，验证虚拟计提 = 75 元（25 元/月 × 3），随后还原
  const nowMonth = currentMonth();
  const [y, m] = nowMonth.split("-").map(Number);
  const backMonth = `${m > 3 ? y : y - 1}-${String(m > 3 ? m - 3 : m + 9).padStart(2, "0")}`;
  const savedAccrual = { month: personalAcc.lastAccrualMonth, cents: personalAcc.accruedInterestCents };
  await db
    .update(debtAccounts)
    .set({ lastAccrualMonth: backMonth, accruedInterestCents: 0 })
    .where(eq(debtAccounts.id, personalAcc.id));
  const backfilled = (await db.select().from(debtAccounts).where(eq(debtAccounts.id, personalAcc.id)))[0];
  const vInterest = virtualAccruedInterest(backfilled);
  check("3 个月利息 = 75 元", vInterest === 7500, `实际 ${vInterest}`);
  await db
    .update(debtAccounts)
    .set({ lastAccrualMonth: savedAccrual.month, accruedInterestCents: savedAccrual.cents })
    .where(eq(debtAccounts.id, personalAcc.id));

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

  console.log("\n== 8. 动态年化利息（等额本金 ACT/360：还本金后下期利息自动下降） ==");
  // 用全新欠款人隔离
  const { insertAndGetId } = await import("../src/server/db/helpers");
  const dyPersonId = await insertAndGetId(db, personsTable, { name: "动态测试人" + Date.now(), ownerUserId: adminId });
  // 70000 / 12 / 2.6% / 等额本金：2026-08-01 放款，2026-09-01 首期（31天）
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
      startDate: "2026-08-01",
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
  // ACT/360 (31天): round(7000000 * 260 * 31 / 3600000) = 15672
  check(`等额本金：第1期利息(31天) = 156.72 元 (实际 ${dyBill1.interestCents})`, dyBill1.interestCents === 15672);
  // 2026-09-01 -> 2026-10-01 (30天): round((7000000-583333) * 260 * 30 / 3600000) = 13903
  const dyExpectedBill2Initial = 13903;
  check(`等额本金：初始第2期利息(30天) = 139.03 元 (实际 ${dyBill2.interestCents})`, dyBill2.interestCents === dyExpectedBill2Initial);

  // 还 2000 元到第 1 期：先抵利息 156.72，再冲本金 1843.28
  await createRepayment({ personId: dyPersonId, targetType: "bill", targetId: dyBill1.id, amountCents: 200000 }, null);
  const dyBill1After = (await db.select().from(installmentBills).where(eq(installmentBills.id, dyBill1.id)))[0];
  check("第1期已部分还清", dyBill1After.status === "partial");
  check(`第1期利息部分 = 15672 (实际 ${dyBill1After.paidInterestCents})`, dyBill1After.paidInterestCents === 15672);
  check(`第1期本金部分 = 184328 (实际 ${dyBill1After.paidPrincipalCents})`, dyBill1After.paidPrincipalCents === 200000 - 15672);

  // 第2期利息(30天)应重算：剩余本金 = 7000000 - 184328 = 6815672，round(6815672 * 260 * 30 / 3600000) = 14767
  const dyBill2After = (await db.select().from(installmentBills).where(eq(installmentBills.id, dyBill2.id)))[0];
  const dyExpected2 = 14767;
  check(`第2期利息已动态重算 = 147.67 元 (实际 ${dyBill2After.interestCents})`, dyBill2After.interestCents === dyExpected2);

  console.log("\n== 9. 动态年化利息（先息后本 ACT/360：超额还到末期本金） ==");
  const ioPersonId = await insertAndGetId(db, personsTable, { name: "先息后本测试人" + Date.now(), ownerUserId: adminId });
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
      startDate: "2026-08-01",
      firstDueDate: "2026-09-01",
      annualRateBps: 260,
      plan: "interestOnly",
    }),
  }, null);
  const ioId = ioAcc as unknown as number;
  const ioBills = await db.select().from(installmentBills).where(eq(installmentBills.accountId, ioId)).orderBy(installmentBills.periodNo);
  check(`先息后本：前11期本金=0 (实际 bill2.principal=${ioBills[1].principalCents})`, ioBills[1].principalCents === 0);
  check(`先息后本：末期本金=70000 (实际 ${ioBills[11].principalCents})`, ioBills[11].principalCents === 7000000);
  check(`先息后本：第1期利息(31天)=156.72 (实际 ${ioBills[0].interestCents})`, ioBills[0].interestCents === 15672);
  await createRepayment({ personId: ioPersonId, targetType: "bill", targetId: ioBills[0].id, amountCents: 200000 }, null);
  const ioBill1After = (await db.select().from(installmentBills).where(eq(installmentBills.id, ioBills[0].id)))[0];
  check(`先息后本：bill 1 已还清 (实际 status=${ioBill1After.status})`, ioBill1After.status === "paid");
  check(`先息后本：bill 1 利息部分 = 156.72 元 (实际 ${ioBill1After.paidInterestCents})`, ioBill1After.paidInterestCents === 15672);
  check(`先息后本：bill 1 本金部分 = 1843.28 元 (实际 ${ioBill1After.paidPrincipalCents})`, ioBill1After.paidPrincipalCents === 184328);
  // 第2期(30天)按 (70000 - 1843.28) × 2.6% × 30 / 360 = 147.67 元
  const ioBill2After = (await db.select().from(installmentBills).where(eq(installmentBills.id, ioBills[1].id)))[0];
  check(`先息后本：bill 2 利息已动态重算 = 147.67 元 (实际 ${ioBill2After.interestCents})`, ioBill2After.interestCents === 14767);
  const ioBill12After = (await db.select().from(installmentBills).where(eq(installmentBills.id, ioBills[11].id)))[0];
  check(`先息后本：末期 planned 本金已重算 (实际 ${ioBill12After.principalCents})`, ioBill12After.principalCents === 6815672);

  console.log("\n== 10. 例子：先息后本 还 1318 元 = 利息 156.72 + 本金 1161.28 ==");
  const exPersonId = await insertAndGetId(db, personsTable, { name: "例子测试人" + Date.now(), ownerUserId: adminId });
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
      startDate: "2026-08-01",
      firstDueDate: "2026-09-01",
      annualRateBps: 260,
      plan: "interestOnly",
    }),
  }, null);
  const exId = exAcc as unknown as number;
  const exBills = await db.select().from(installmentBills).where(eq(installmentBills.accountId, exId)).orderBy(installmentBills.periodNo);
  await createRepayment({ personId: exPersonId, targetType: "bill", targetId: exBills[0].id, amountCents: 131800 }, null);
  const exBill1After = (await db.select().from(installmentBills).where(eq(installmentBills.id, exBills[0].id)))[0];
  check(`例子：bill 1 利息 = 15672 (实际 ${exBill1After.paidInterestCents})`, exBill1After.paidInterestCents === 15672);
  check(`例子：bill 1 本金 = 116128 (实际 ${exBill1After.paidPrincipalCents})`, exBill1After.paidPrincipalCents === 116128);
  // 下一期(30天)利息 = round((7000000 - 116128) * 260 * 30 / 3600000) = 14915
  const exBill2After = (await db.select().from(installmentBills).where(eq(installmentBills.id, exBills[1].id)))[0];
  check(`例子：bill 2 利息已重算 = 149.15 元 (实际 ${exBill2After.interestCents})`, exBill2After.interestCents === 14915);

  console.log("\n== 10b. 真实 84 期 30000 元 2.6% 先息后本 ACT/360 连续还本 ==");
  const realPersonId = await insertAndGetId(db, personsTable, { name: "84期真实案例" + Date.now(), ownerUserId: adminId });
  const realAcc = await (await import("../src/server/services/installment-service")).createInstallmentDebt({
    personId: realPersonId,
    title: "84期先息后本",
    source: "银行",
    startDate: "2025-12-02",
    interestMode: "dynamic",
    annualRateBps: 260,
    dynamicPlan: "interestOnly",
    bills: (await import("../src/server/services/installment-service")).generateDynamicBills({
      principalCents: 3000000,
      termMonths: 84,
      startDate: "2025-12-02",
      firstDueDate: "2025-12-21",
      annualRateBps: 260,
      plan: "interestOnly",
    }),
  }, null);
  const realAccId = realAcc as unknown as number;
  const principalRepays = [100000, 100000, 100000, 100000, 100000, 500000, 100000, 400000, 100000, 100000, 100000, 100000];
  const expectedInterests = [4117, 6493, 6269, 5460, 5821, 5417, 4478, 4117, 3358, 3134, 2817, 2687];
  for (let i = 0; i < 12; i++) {
    const curBills = await db.select().from(installmentBills).where(eq(installmentBills.accountId, realAccId)).orderBy(installmentBills.periodNo);
    const b = curBills[i];
    check(`84期第${i + 1}期利息 = ${expectedInterests[i]} (实际 ${b.interestCents})`, b.interestCents === expectedInterests[i]);
    await createRepayment({ personId: realPersonId, targetType: "bill", targetId: b.id, amountCents: b.interestCents + principalRepays[i] }, null);
  }
  const realAccAfter = (await db.select().from(debtAccounts).where(eq(debtAccounts.id, realAccId)))[0];
  check(`84期总本金保持 3000000 (实际 ${realAccAfter.principalCents})`, realAccAfter.principalCents === 3000000);
  check(`84期剩余本金 = 1100000 (实际 ${realAccAfter.remainingPrincipalCents})`, realAccAfter.remainingPrincipalCents === 1100000);

  console.log("\n== 11. 多客户数据隔离 ==");
  const { register, findUserByUsername } = await import("../src/server/services/auth-service");
  const { createPerson, listPersons, getPerson } = await import("../src/server/services/person-service");
  const { NotFoundError } = await import("../src/server/lib/errors");

  // 注册（或复用）一个测试客户（自建认证，直接写 users 表）
  const existed = await findUserByUsername("verify_user");
  let customerOwnerId: string;
  if (existed) {
    customerOwnerId = existed.id;
  } else {
    const reg = await register("verify_user", "verify123");
    if (!reg.ok) throw new Error(`注册测试用户失败：${reg.message}`);
    customerOwnerId = reg.userId;
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

  console.log("\n== 12. 删除与回滚 ==");
  const { deleteRepayments } = await import("../src/server/services/repayment-service");
  const { deleteDebtAccounts, deletePerson } = await import("../src/server/services/deletion-service");
  const { inArray, and: and2 } = await import("drizzle-orm");

  // 12a. 删单笔还款：bill1 的 1000 元（息 120 + 本 880）回滚。
  // 注意：第3节的批量还款曾溢出 1120 元本金到 bill1，所以删 rep1 后 bill1 剩本金已还 1120、利息已还 0
  const seedAccId = (await db.select().from(debtAccounts).where(eq(debtAccounts.title, "招行 e 招贷")))[0].id;
  const seedBill = async (periodNo: number) =>
    (await db.select().from(installmentBills).where(and2(eq(installmentBills.accountId, seedAccId), eq(installmentBills.periodNo, periodNo))))[0];
  const reps = await listRepaymentsByPerson(personId);
  const rep1 = reps.find((r) => r.amountCents === 100000 && !r.batchId)!;
  await deleteRepayments([rep1.id], null);
  const bill1Rb = await seedBill(1);
  check("删还款后第1期回到 partial", bill1Rb.status === "partial", `实际 ${bill1Rb.status}`);
  check("第1期利息回滚为 0", bill1Rb.paidInterestCents === 0, `实际 ${bill1Rb.paidInterestCents}`);
  check("第1期本金已还 1120（批量溢出部分）", bill1Rb.paidPrincipalCents === 112000, `实际 ${bill1Rb.paidPrincipalCents}`);

  // 12b. 批量删同批还款：第1/2/3期全部恢复 pending
  const batchIds = reps.filter((r) => r.batchId).map((r) => r.id);
  check("同批流水 3 条", batchIds.length === 3, `实际 ${batchIds.length}`);
  await deleteRepayments(batchIds, null);
  const billsAfter = await db
    .select()
    .from(installmentBills)
    .where(and2(eq(installmentBills.accountId, seedAccId), inArray(installmentBills.periodNo, [1, 2, 3])));
  check("批量删除后 1/2/3 期全部 pending", billsAfter.length === 3 && billsAfter.every((b) => b.status === "pending" && b.paidCents === 0));
  const instAcc = (await db.select().from(debtAccounts).where(eq(debtAccounts.id, seedAccId)))[0];
  // 剩余 = 总本金 24000 - 垫付期本金 2000 = 22000（第5期仍是 advanced，垫付口径不计入待还）
  check("分期账户剩余本金恢复 22000（扣除垫付期）", instAcc.remainingPrincipalCents === 2200000, `实际 ${instAcc.remainingPrincipalCents}`);

  // 12c. 删除垫付生成的个欠：源账单恢复未垫付
  const advAccRow = (await db.select().from(debtAccounts).where(eq(debtAccounts.title, "垫付款 · 招行 e 招贷 第5期")))[0];
  await deleteDebtAccounts([advAccRow.id], null);
  const bill5Rb = await seedBill(5);
  check("源账单垫付标记已回写", bill5Rb.advanced === 0 && bill5Rb.advanceId == null && bill5Rb.status === "pending",
    `实际 advanced=${bill5Rb.advanced} status=${bill5Rb.status}`);
  const advGone = await db.select().from(debtAccounts).where(eq(debtAccounts.id, advAccRow.id));
  check("垫付个欠已删除", advGone.length === 0);

  // 12d. 整批删除分期：账单/还款/垫付清空
  await deleteDebtAccounts([instAcc.id], null);
  const billsGone = await db.select().from(installmentBills).where(eq(installmentBills.accountId, instAcc.id));
  check("分期账单全部删除", billsGone.length === 0);
  const repsGone = await listRepaymentsByPerson(personId);
  check("关联还款流水全部删除", repsGone.length === 0, `实际 ${repsGone.length}`);

  // 12e. 删除欠款人：级联清空
  await deletePerson(personId, null);
  const accsGone = await db.select().from(debtAccounts).where(eq(debtAccounts.personId, personId));
  const personGone = await db.select().from(personsTable).where(eq(personsTable.id, personId));
  check("欠款人账户全部删除", accsGone.length === 0);
  check("欠款人已删除", personGone.length === 0);

  console.log(`\n========== 结果：${passed} 通过 / ${failed} 失败 ==========\n`);
  await closeDb();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("验证脚本异常：", err);
  process.exit(1);
});
