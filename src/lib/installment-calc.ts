import { addMonthsToDate, billingPeriodDays } from "@/server/lib/dates";
import { dailyInterestCents } from "@/server/lib/money";

/** dynamic 模式下的还款方式 */
export const DYNAMIC_PLANS = ["equalPrincipal", "interestOnly", "equalPayment"] as const;
export type DynamicPlan = (typeof DYNAMIC_PLANS)[number];

export interface DynamicScheduleItem {
  periodNo: number;
  dueDate: string;
  days: number;
  principalCents: number;
  interestCents: number;
}

export interface RecomputableBill {
  id: number;
  periodNo: number;
  dueDate: string;
  principalCents: number;
  interestCents: number;
  totalCents: number;
  paidCents: number;
  paidPrincipalCents: number;
  advanced: number;
  status: string;
}

export interface RecomputedBillUpdate {
  id: number;
  principalCents: number;
  interestCents: number;
  totalCents: number;
  status: "pending" | "paid";
}

export interface RecomputeDynamicResult {
  updates: RecomputedBillUpdate[];
  remainingPrincipalCents: number;
  accountStatus: "open" | "settled";
}

/** 等额本金第 periodNo 期应还本金（余数归末期） */
export function computeEqualPrincipal(total: number, periodNo: number, term: number): number {
  const base = Math.floor(total / term);
  const remainder = total - base * term;
  return periodNo === term ? base + remainder : base;
}

/**
 * 动态利息（ACT/360 按日计息）初始账单生成：
 * 第 1 期天数 = startDate → firstDueDate（缺省兜底 30 天）；
 * 第 k 期天数 = 第 k-1 期 dueDate → 第 k 期 dueDate。
 */
export function generateDynamicSchedule(params: {
  principalCents: number;
  termMonths: number;
  startDate?: string;
  firstDueDate: string;
  annualRateBps: number;
  plan: DynamicPlan;
}): DynamicScheduleItem[] {
  const { principalCents, termMonths, startDate, firstDueDate, annualRateBps, plan } = params;
  const dueDates = Array.from({ length: termMonths }, (_, i) => addMonthsToDate(firstDueDate, i));
  const days = dueDates.map((d, i) => billingPeriodDays(i === 0 ? startDate : dueDates[i - 1], d));

  const planPrincipal: number[] = Array(termMonths).fill(0);
  if (plan === "equalPrincipal") {
    for (let i = 0; i < termMonths; i++) {
      planPrincipal[i] = computeEqualPrincipal(principalCents, i + 1, termMonths);
    }
  } else if (plan === "interestOnly") {
    for (let i = 0; i < termMonths - 1; i++) planPrincipal[i] = 0;
    planPrincipal[termMonths - 1] = principalCents;
  } else {
    const r = annualRateBps / 120000;
    let x = 0;
    if (r === 0) {
      x = principalCents / termMonths;
    } else {
      const pow = Math.pow(1 + r, termMonths);
      x = (principalCents * r * pow) / (pow - 1);
    }
    let remaining = principalCents;
    for (let i = 0; i < termMonths - 1; i++) {
      const interest = dailyInterestCents(remaining, annualRateBps, days[i]);
      const principal = Math.max(0, Math.round(x) - interest);
      const actualPrincipal = Math.min(principal, remaining);
      planPrincipal[i] = actualPrincipal;
      remaining -= actualPrincipal;
    }
    planPrincipal[termMonths - 1] = Math.max(0, remaining);
  }

  const result: DynamicScheduleItem[] = [];
  let remainingAtStart = principalCents;
  for (let i = 0; i < termMonths; i++) {
    const interest = dailyInterestCents(remainingAtStart, annualRateBps, days[i]);
    result.push({
      periodNo: i + 1,
      dueDate: dueDates[i],
      days: days[i],
      principalCents: planPrincipal[i],
      interestCents: interest,
    });
    remainingAtStart -= planPrincipal[i];
  }
  return result;
}

function isZeroSettled(b: RecomputableBill): boolean {
  return b.status === "paid" && b.paidCents === 0 && b.advanced === 0;
}

/**
 * 纯函数：重算动态利息分期账户的未还账单及账户剩余本金/结清状态。
 * - 仅重算 status === "pending" 或“因提前结清而被置为 0 元 paid”的账单
 * - 绝不覆盖已有真实还款（paidCents > 0）的 paid / partial 或 advanced 账单
 * - 未来期按计划本金推进剩余本金，确保等额本金/等额本息未来期利息正确递减
 */
export function computeRecomputedDynamicBills(params: {
  totalPrincipal: number;
  annualRateBps: number;
  plan: DynamicPlan;
  startDate: string;
  bills: RecomputableBill[];
}): RecomputeDynamicResult {
  const { totalPrincipal, annualRateBps, plan, startDate, bills } = params;

  const isRecomputable = (b: RecomputableBill) => b.status === "pending" || isZeroSettled(b);

  let committedPrincipal = 0;
  let lastRecomputableIdx = -1;
  for (let i = 0; i < bills.length; i++) {
    const b = bills[i];
    if (isRecomputable(b)) {
      lastRecomputableIdx = i;
    } else if (b.status === "advanced" || b.status === "partial") {
      committedPrincipal += Math.max(b.principalCents, b.paidPrincipalCents);
    } else {
      // paid (with paidCents > 0)
      committedPrincipal += b.paidPrincipalCents;
    }
  }

  let remainingToSchedule = Math.max(0, totalPrincipal - committedPrincipal);
  let interestRemaining = totalPrincipal;

  const updates: RecomputedBillUpdate[] = [];
  const finalPrincipals: number[] = bills.map((b) => b.principalCents);
  const finalStatuses: string[] = bills.map((b) => b.status);

  for (let i = 0; i < bills.length; i++) {
    const b = bills[i];
    const days = billingPeriodDays(i === 0 ? startDate : bills[i - 1].dueDate, b.dueDate);

    if (!isRecomputable(b)) {
      if (b.status === "advanced") {
        interestRemaining = Math.max(0, interestRemaining - Math.max(b.principalCents, b.paidPrincipalCents));
      } else {
        interestRemaining = Math.max(0, interestRemaining - b.paidPrincipalCents);
      }
      continue;
    }

    const isLast = i === lastRecomputableIdx;
    let plannedThis: number;
    if (plan === "interestOnly") {
      plannedThis = isLast ? remainingToSchedule : 0;
    } else if (plan === "equalPrincipal") {
      plannedThis = isLast
        ? remainingToSchedule
        : Math.min(computeEqualPrincipal(totalPrincipal, b.periodNo, bills.length), remainingToSchedule);
    } else {
      plannedThis = isLast ? remainingToSchedule : Math.min(b.principalCents, remainingToSchedule);
    }

    remainingToSchedule = Math.max(0, remainingToSchedule - plannedThis);
    const interest = dailyInterestCents(interestRemaining, annualRateBps, days);
    const newTotal = plannedThis + interest;
    const newStatus: "pending" | "paid" = newTotal === 0 ? "paid" : "pending";

    finalPrincipals[i] = plannedThis;
    finalStatuses[i] = newStatus;

    if (
      b.principalCents !== plannedThis ||
      b.interestCents !== interest ||
      b.totalCents !== newTotal ||
      b.status !== newStatus
    ) {
      updates.push({
        id: b.id,
        principalCents: plannedThis,
        interestCents: interest,
        totalCents: newTotal,
        status: newStatus,
      });
    }

    interestRemaining = Math.max(0, interestRemaining - plannedThis);
  }

  let settledPrincipal = 0;
  for (let i = 0; i < bills.length; i++) {
    const b = bills[i];
    settledPrincipal += b.advanced === 1 ? Math.max(finalPrincipals[i], b.paidPrincipalCents) : b.paidPrincipalCents;
  }

  const remainingPrincipalCents = Math.max(0, totalPrincipal - settledPrincipal);
  const accountStatus: "open" | "settled" = finalStatuses.every((s) => s === "paid" || s === "advanced")
    ? "settled"
    : "open";

  return {
    updates,
    remainingPrincipalCents,
    accountStatus,
  };
}
