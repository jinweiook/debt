import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { debtAccounts, type DebtAccount } from "@/server/db/schema";
import { currentMonth, diffMonths, monthOf } from "@/server/lib/dates";
import { monthlyInterestCents } from "@/server/lib/money";

/**
 * 利息服务：
 * - annual（年化）：懒计提。每个自然月开始时计提当月利息（月粒度），
 *   读统计/还款前按 lastAccrualMonth 补齐到当前月。
 * - fixed（固定利息）：一次性总额，无需计提。
 * - none：无利息。
 */

/** 计算某账户「虚拟计提」后的应付利息（不写库，供统计读用） */
export function virtualAccruedInterest(account: DebtAccount, toMonth = currentMonth()): number {
  if (account.interestType === "none") return 0;
  if (account.interestType === "fixed") {
    return Math.max((account.fixedInterestCents ?? 0) - account.paidInterestCents, 0);
  }
  // annual
  const base = account.lastAccrualMonth ?? monthOf(account.startDate);
  const months = Math.max(diffMonths(toMonth, base), 0);
  const perMonth = monthlyInterestCents(account.remainingPrincipalCents, account.annualRateBps ?? 0);
  return account.accruedInterestCents + perMonth * months;
}

/**
 * 真实计提（写库）：把 annual 账户利息补齐到当前月。
 * 还款前必须调用，保证先息后本的「息」口径最新。幂等。
 */
export async function accrueAccountInterest(accountId: number, db = getDb()): Promise<void> {
  const [account] = await db
    .select()
    .from(debtAccounts)
    .where(eq(debtAccounts.id, accountId))
    .limit(1);
  if (!account || account.interestType !== "annual" || account.status !== "open") return;

  const now = currentMonth();
  const base = account.lastAccrualMonth ?? monthOf(account.startDate);
  const months = Math.max(diffMonths(now, base), 0);
  if (months === 0) {
    if (!account.lastAccrualMonth) {
      await db
        .update(debtAccounts)
        .set({ lastAccrualMonth: base, updatedAt: new Date() })
        .where(eq(debtAccounts.id, accountId));
    }
    return;
  }
  const perMonth = monthlyInterestCents(account.remainingPrincipalCents, account.annualRateBps ?? 0);
  await db
    .update(debtAccounts)
    .set({
      accruedInterestCents: account.accruedInterestCents + perMonth * months,
      lastAccrualMonth: now,
      updatedAt: new Date(),
    })
    .where(eq(debtAccounts.id, accountId));
}

/** 个人欠款应付利息（计提后口径；annual 需先调用 accrue 或用 virtual） */
export function interestPayable(account: DebtAccount): number {
  if (account.interestType === "none") return 0;
  if (account.interestType === "fixed") {
    return Math.max((account.fixedInterestCents ?? 0) - account.paidInterestCents, 0);
  }
  return account.accruedInterestCents;
}
