import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/server/db/client";
import { advances, debtAccounts, installmentBills, type OwnerId } from "@/server/db/schema";
import { BusinessRuleError, NotFoundError } from "@/server/lib/errors";
import { today } from "@/server/lib/dates";
import { assertPersonAccess } from "./installment-service";

/**
 * 垫付处理：某期分期未还时，本人先垫付 →
 * 自动生成一笔 personal 类型（origin=advance，无息）欠款，该期标记为已垫付。
 * bill_id UNIQUE 约束保证一期只能垫付一次（幂等）。先校验归属链。
 */
export async function markBillAdvanced(billId: number, ownerId: OwnerId, advanceDate?: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [bill] = await tx.select().from(installmentBills).where(eq(installmentBills.id, billId)).limit(1);
    if (!bill) throw new NotFoundError("账单不存在");
    const [account] = await tx.select().from(debtAccounts).where(eq(debtAccounts.id, bill.accountId)).limit(1);
    if (!account) throw new NotFoundError("分期账户不存在");
    await assertPersonAccess(account.personId, ownerId);
    if (bill.advanced === 1 || bill.status === "advanced") {
      throw new BusinessRuleError("该期已垫付，请勿重复操作");
    }
    if (bill.status !== "pending" && bill.status !== "partial") {
      throw new BusinessRuleError("只有待还或部分已还的账单可以垫付");
    }

    const amount = bill.totalCents - bill.paidCents;
    if (amount <= 0) throw new BusinessRuleError("该期无剩余应还，无需垫付");

    // 1. 生成垫付款个人欠款
    const [accIns] = await tx
      .insert(debtAccounts)
      .values({
        personId: account.personId,
        type: "personal",
        title: `垫付款 · ${account.title} 第${bill.periodNo}期`,
        principalCents: amount,
        remainingPrincipalCents: amount,
        interestType: "none",
        startDate: advanceDate ?? today(),
        origin: "advance",
        note: `由「${account.title}」第 ${bill.periodNo} 期垫付生成`,
      })
      .returning({ id: debtAccounts.id });
    const generatedAccountId = accIns.id;

    // 2. 垫付流水（bill_id UNIQUE 幂等）
    const [advIns] = await tx
      .insert(advances)
      .values({
        personId: account.personId,
        billId,
        amountCents: amount,
        advanceDate: advanceDate ?? today(),
        generatedAccountId,
      })
      .returning({ id: advances.id });
    const advanceId = advIns.id;

    // 3. 账单标记已垫付
    await tx
      .update(installmentBills)
      .set({ advanced: 1, status: "advanced", advanceId })
      .where(eq(installmentBills.id, billId));

    // 4. 回写账户关联与分期账户状态
    await tx
      .update(debtAccounts)
      .set({ advanceId, updatedAt: new Date() })
      .where(eq(debtAccounts.id, generatedAccountId));

    const allBills = await tx.select().from(installmentBills).where(eq(installmentBills.accountId, bill.accountId));
    const allDone = allBills.every((b) => b.status === "paid" || b.status === "advanced");
    const totalPaidPrincipal = allBills.reduce((s, b) => s + b.paidPrincipalCents, 0);
    const totalAdvanced = allBills.reduce((s, b) => (b.advanced === 1 ? s + (b.principalCents - b.paidPrincipalCents) : s), 0);
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
      .where(eq(debtAccounts.id, bill.accountId));

    return { advanceId, generatedAccountId, amount };
  });
}
