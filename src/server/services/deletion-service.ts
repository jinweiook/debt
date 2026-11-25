import { eq, inArray, or } from "drizzle-orm";
import { getDb, type Db } from "@/server/db/client";
import { advances, debtAccounts, installmentBills, persons, repayments, type OwnerId } from "@/server/db/schema";
import { NotFoundError, ValidationError } from "@/server/lib/errors";
import { assertPersonAccess, recomputeDynamicBills } from "./installment-service";
import { getPerson, invalidatePersonsCache } from "./person-service";
import { invalidateOverviewStats } from "./stats-service";
import { invalidateNamespace } from "@/server/redis/cache";

/**
 * 删除服务：欠款人 / 债务账户的级联删除（schema 无物理外键，全部在这里保证一致性）。
 * 约定：
 * - 删除分期账户时，其垫付生成的个人欠款账户一并删除
 * - 单独删除 origin=advance 的个人欠款时，回写源账单的垫付标记（advanced=0），使其恢复可还
 */

/** 删除欠款人 + 名下全部债务、账单、还款、垫付（单事务） */
export async function deletePerson(personId: number, ownerId: OwnerId): Promise<void> {
  await getPerson(personId, ownerId);
  const db = getDb();
  await db.transaction(async (tx) => {
    const accounts = await tx
      .select({ id: debtAccounts.id })
      .from(debtAccounts)
      .where(eq(debtAccounts.personId, personId));
    await deleteAccountsCascade(tx as unknown as Db, accounts.map((a) => a.id));
    // 兜底：按 personId 清掉可能残留的流水（cascade 已按账户维度删过一遍）
    await tx.delete(repayments).where(eq(repayments.personId, personId));
    await tx.delete(advances).where(eq(advances.personId, personId));
    await tx.delete(persons).where(eq(persons.id, personId));
  });
  await invalidateAfterDelete();
}

/** 批量删除债务账户（分期 / 个人欠款混合，单事务） */
export async function deleteDebtAccounts(accountIds: number[], ownerId: OwnerId): Promise<void> {
  const ids = [...new Set(accountIds)].filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) throw new ValidationError("请选择要删除的记录");
  const db = getDb();
  await db.transaction(async (tx) => {
    const accounts = await tx.select().from(debtAccounts).where(inArray(debtAccounts.id, ids));
    if (accounts.length !== ids.length) throw new NotFoundError("部分债务记录不存在");
    for (const acc of accounts) {
      await assertPersonAccess(acc.personId, ownerId);
    }
    await deleteAccountsCascade(tx as unknown as Db, ids);
  });
  await invalidateAfterDelete();
}

/** 级联删除一组账户及其关联数据（事务内调用）。 */
async function deleteAccountsCascade(tx: Db, accountIds: number[]): Promise<void> {
  if (accountIds.length === 0) return;

  // 1. 这些账户（若是分期）下的账单
  const bills = await tx
    .select()
    .from(installmentBills)
    .where(inArray(installmentBills.accountId, accountIds));
  const billIds = bills.map((b) => b.id);

  // 2. 分期账单上的垫付 → 生成的个欠账户一并删除
  const advFromBills = billIds.length
    ? await tx.select().from(advances).where(inArray(advances.billId, billIds))
    : [];
  const generatedIds = advFromBills.map((a) => a.generatedAccountId);

  // 3. 被单独删除的 origin=advance 个欠 → 回写源账单垫付标记（源分期不在删除集内时）
  const advToPersonal = await tx
    .select()
    .from(advances)
    .where(inArray(advances.generatedAccountId, accountIds));
  const touchedSourceAccountIds = new Set<number>();
  for (const adv of advToPersonal) {
    const [srcBill] = await tx.select().from(installmentBills).where(eq(installmentBills.id, adv.billId)).limit(1);
    if (!srcBill) continue;
    if (accountIds.includes(srcBill.accountId)) continue; // 源分期一并删除，无需回写
    await tx
      .update(installmentBills)
      .set({ advanced: 0, advanceId: null, status: srcBill.paidCents > 0 ? "partial" : "pending" })
      .where(eq(installmentBills.id, srcBill.id));
    touchedSourceAccountIds.add(srcBill.accountId);
  }

  // 4. 汇总完整删除集（含垫付生成的个欠）
  const allAccountIds = [...new Set([...accountIds, ...generatedIds])];
  const allBills = await tx
    .select({ id: installmentBills.id })
    .from(installmentBills)
    .where(inArray(installmentBills.accountId, allAccountIds));
  const allBillIds = allBills.map((b) => b.id);

  // 5. 逆序删除：repayments → advances → bills → accounts
  await tx
    .delete(repayments)
    .where(
      allBillIds.length
        ? or(inArray(repayments.billId, allBillIds), inArray(repayments.accountId, allAccountIds))
        : inArray(repayments.accountId, allAccountIds),
    );
  await tx
    .delete(advances)
    .where(
      allBillIds.length
        ? or(inArray(advances.billId, allBillIds), inArray(advances.generatedAccountId, allAccountIds))
        : inArray(advances.generatedAccountId, allAccountIds),
    );
  await tx.delete(installmentBills).where(inArray(installmentBills.accountId, allAccountIds));
  await tx.delete(debtAccounts).where(inArray(debtAccounts.id, allAccountIds));

  // 6. 回写了垫付标记的源分期账户：重算剩余与状态
  for (const srcAccId of touchedSourceAccountIds) {
    const [acc] = await tx.select().from(debtAccounts).where(eq(debtAccounts.id, srcAccId)).limit(1);
    if (!acc) continue;
    if (acc.interestMode === "dynamic") {
      await recomputeDynamicBills(tx, srcAccId);
    } else {
      await recomputeFixedInstallmentAccount(tx, srcAccId);
    }
  }
}

/** fixed 分期账户：按账单汇总重算 remaining / status（含垫付口径，与 advance-service 一致） */
export async function recomputeFixedInstallmentAccount(tx: Db, accountId: number): Promise<void> {
  const allBills = await tx.select().from(installmentBills).where(eq(installmentBills.accountId, accountId));
  const totalPaidPrincipal = allBills.reduce((s, b) => s + b.paidPrincipalCents, 0);
  const totalAdvanced = allBills.reduce(
    (s, b) => (b.advanced === 1 ? s + (b.principalCents - b.paidPrincipalCents) : s),
    0,
  );
  const allDone = allBills.every((b) => b.status === "paid" || b.status === "advanced");
  await tx
    .update(debtAccounts)
    .set({
      remainingPrincipalCents: Math.max(
        allBills.reduce((s, b) => s + b.principalCents, 0) - totalPaidPrincipal - totalAdvanced,
        0,
      ),
      status: allDone ? "settled" : "open",
      updatedAt: new Date(),
    })
    .where(eq(debtAccounts.id, accountId));
}

export async function invalidateAfterDelete(): Promise<void> {
  await invalidatePersonsCache();
  await invalidateOverviewStats();
  await invalidateNamespace("persons:list");
  await invalidateNamespace("stats");
}
