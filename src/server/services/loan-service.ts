import { and, asc, desc, eq, inArray, like, or } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { debtAccounts, installmentBills, persons, repayments, type OwnerId } from "@/server/db/schema";
import { NotFoundError } from "@/server/lib/errors";
import { assertPersonAccess } from "./installment-service";
import { virtualAccruedInterest } from "./interest-service";

export interface LoanRow {
  account: typeof debtAccounts.$inferSelect;
  personName: string;
  personId: number;
  /** 欠款人归属客户 id（UUID 字符串，管理员视图展示用） */
  ownerUserId: string;
  /** 剩余应还（分）：分期 = 未还账单合计 - 已还；个人欠款 = 剩余本金 + 应付利息 */
  remainingCents: number;
}

/**
 * 借贷款列表（按客户隔离 + 关键词搜索）：
 * - ownerId=null（管理员）列出全部，否则只列自己名下
 * - q 同时匹配欠款人姓名与账户标题
 */
export async function listLoanAccounts(q?: string, ownerId: OwnerId = null): Promise<LoanRow[]> {
  const db = getDb();
  const conditions = [];
  if (ownerId != null) conditions.push(eq(persons.ownerUserId, ownerId));
  if (q && q.trim()) {
    const kw = `%${q.trim()}%`;
    conditions.push(or(like(persons.name, kw), like(debtAccounts.title, kw)));
  }

  const rows = await db
    .select({ account: debtAccounts, personName: persons.name, ownerUserId: persons.ownerUserId })
    .from(debtAccounts)
    .innerJoin(persons, eq(debtAccounts.personId, persons.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(debtAccounts.createdAt));

  if (rows.length === 0) return [];

  // 批量算分期剩余
  const installmentIds = rows.filter((r) => r.account.type === "installment").map((r) => r.account.id);
  const remainingByAccount = new Map<number, number>();
  if (installmentIds.length > 0) {
    const bills = await db
      .select()
      .from(installmentBills)
      .where(and(inArray(installmentBills.accountId, installmentIds), inArray(installmentBills.status, ["pending", "partial"])));
    for (const b of bills) {
      const cur = remainingByAccount.get(b.accountId) ?? 0;
      remainingByAccount.set(b.accountId, cur + (b.totalCents - b.paidCents));
    }
  }

  return rows.map((r) => ({
    account: r.account,
    personName: r.personName,
    personId: r.account.personId,
    ownerUserId: r.ownerUserId,
    remainingCents:
      r.account.type === "installment"
        ? remainingByAccount.get(r.account.id) ?? 0
        : r.account.status === "open"
          ? r.account.remainingPrincipalCents + virtualAccruedInterest(r.account)
          : 0,
  }));
}

export interface LoanDetail {
  account: typeof debtAccounts.$inferSelect;
  person: typeof persons.$inferSelect;
  bills?: (typeof installmentBills.$inferSelect)[];
  repayments: (typeof repayments.$inferSelect)[];
  /** 剩余应还（同列表口径） */
  remainingCents: number;
}

/** 单笔借贷款详情（校验归属链：账户 → 欠款人） */
export async function getLoanAccountDetail(accountId: number, ownerId: OwnerId): Promise<LoanDetail> {
  const db = getDb();
  const [account] = await db.select().from(debtAccounts).where(eq(debtAccounts.id, accountId)).limit(1);
  if (!account) throw new NotFoundError("借贷款不存在");
  const [person] = await db.select().from(persons).where(eq(persons.id, account.personId)).limit(1);
  if (!person) throw new NotFoundError("借贷款不存在");
  if (ownerId != null && person.ownerUserId !== ownerId) throw new NotFoundError("借贷款不存在");

  let bills: (typeof installmentBills.$inferSelect)[] | undefined;
  let repaymentsRows: (typeof repayments.$inferSelect)[] = [];
  let remainingCents = 0;

  if (account.type === "installment") {
    bills = await db
      .select()
      .from(installmentBills)
      .where(eq(installmentBills.accountId, account.id))
      .orderBy(asc(installmentBills.periodNo));
    const open = bills.filter((b) => b.status === "pending" || b.status === "partial");
    remainingCents = open.reduce((s, b) => s + (b.totalCents - b.paidCents), 0);
    const billIds = bills.map((b) => b.id);
    if (billIds.length > 0) {
      repaymentsRows = await db
        .select()
        .from(repayments)
        .where(inArray(repayments.billId, billIds))
        .orderBy(asc(repayments.repaidAt), asc(repayments.id));
    }
  } else {
    remainingCents =
      account.status === "open" ? account.remainingPrincipalCents + virtualAccruedInterest(account) : 0;
    repaymentsRows = await db
      .select()
      .from(repayments)
      .where(eq(repayments.accountId, account.id))
      .orderBy(asc(repayments.repaidAt), asc(repayments.id));
  }

  return { account, person, bills, repayments: repaymentsRows, remainingCents };
}
