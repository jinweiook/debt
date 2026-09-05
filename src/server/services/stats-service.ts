import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { advances, debtAccounts, installmentBills, persons, repayments } from "@/server/db/schema";
import { currentMonth, addMonths, monthOf } from "@/server/lib/dates";
import { getOrSet, invalidateNamespace } from "@/server/redis/cache";
import { virtualAccruedInterest } from "./interest-service";

export interface PersonStats {
  personId: number;
  /** 总欠款 = 银行剩余待还 + 个人欠款剩余 */
  totalOutstanding: number;
  /** 银行剩余待还（未还账单合计 - 已还） */
  installmentRemaining: number;
  /** 个人欠款剩余（剩余本金 + 应付利息，含虚拟计提） */
  personalRemaining: number;
  /** 累计已收 */
  totalReceived: number;
  /** 累计垫付 */
  totalAdvanced: number;
}

export interface MonthlyForecast {
  month: string; // YYYY-MM
  amountCents: number;
}

const STATS_TTL = 60; // 秒

/** 计算单个欠款人统计（annual 利息用虚拟计提，不写库） */
export async function personStats(personId: number): Promise<PersonStats> {
  const db = getDb();
  const accounts = await db.select().from(debtAccounts).where(eq(debtAccounts.personId, personId));

  const installmentIds = accounts.filter((a) => a.type === "installment").map((a) => a.id);
  let installmentRemaining = 0;
  if (installmentIds.length > 0) {
    const bills = await db
      .select()
      .from(installmentBills)
      .where(
        and(inArray(installmentBills.accountId, installmentIds), inArray(installmentBills.status, ["pending", "partial"])),
      );
    installmentRemaining = bills.reduce((s, b) => s + (b.totalCents - b.paidCents), 0);
  }

  const personalRemaining = accounts
    .filter((a) => a.type === "personal" && a.status === "open")
    .reduce((s, a) => s + a.remainingPrincipalCents + virtualAccruedInterest(a), 0);

  const reps = await db.select().from(repayments).where(eq(repayments.personId, personId));
  const totalReceived = reps.reduce((s, r) => s + r.amountCents, 0);

  const advs = await db.select().from(advances).where(eq(advances.personId, personId));
  const totalAdvanced = advs.reduce((s, a) => s + a.amountCents, 0);

  return {
    personId,
    totalOutstanding: installmentRemaining + personalRemaining,
    installmentRemaining,
    personalRemaining,
    totalReceived,
    totalAdvanced,
  };
}

/** 全站总览（带 Redis 缓存，按客户隔离：ownerId=null 表示管理员汇总全部） */
export async function overviewStats(ownerId: number | null): Promise<PersonStats & { activePersons: number }> {
  return getOrSet(
    "stats",
    `overview:${ownerId == null ? "admin" : `u${ownerId}`}`,
    async () => {
      const db = getDb();
      const where = ownerId == null ? eq(persons.status, "active") : and(eq(persons.status, "active"), eq(persons.ownerUserId, ownerId));
      const allPersons = await db.select().from(persons).where(where);
      const stats = await Promise.all(allPersons.map((p) => personStats(p.id)));
      const sum = (k: keyof PersonStats) => stats.reduce((s, x) => s + (x[k] as number), 0);
      return {
        personId: 0,
        totalOutstanding: sum("totalOutstanding"),
        installmentRemaining: sum("installmentRemaining"),
        personalRemaining: sum("personalRemaining"),
        totalReceived: sum("totalReceived"),
        totalAdvanced: sum("totalAdvanced"),
        activePersons: allPersons.length,
      };
    },
    { ttlSeconds: STATS_TTL },
  );
}

/** 未来每月预计应收（暂不做缓存，因数据量不大且实时性要求较高）。personId=null 时按客户维度过滤 */
export async function monthlyForecast(personId: number | null, months = 12, ownerId: number | null = null): Promise<MonthlyForecast[]> {
  const db = getDb();
  let accountIds: number[] = [];
  if (personId != null) {
    const accounts = await db
      .select()
      .from(debtAccounts)
      .where(and(eq(debtAccounts.personId, personId), eq(debtAccounts.type, "installment")));
    accountIds = accounts.map((a) => a.id);
  } else if (ownerId != null) {
    // 普通客户：仅统计自己名下分期账户
    const accounts = await db
      .select({ id: debtAccounts.id })
      .from(debtAccounts)
      .innerJoin(persons, eq(debtAccounts.personId, persons.id))
      .where(and(eq(persons.ownerUserId, ownerId), eq(debtAccounts.type, "installment")));
    accountIds = accounts.map((a) => a.id);
  } else {
    const accounts = await db.select().from(debtAccounts).where(eq(debtAccounts.type, "installment"));
    accountIds = accounts.map((a) => a.id);
  }

  const start = currentMonth();
  const buckets = new Map<string, number>();
  for (let i = 0; i < months; i++) buckets.set(addMonths(start, i), 0);
  if (accountIds.length === 0) {
    return [...buckets.entries()].map(([month, amountCents]) => ({ month, amountCents }));
  }

  const bills = await db
    .select()
    .from(installmentBills)
    .where(and(inArray(installmentBills.accountId, accountIds), inArray(installmentBills.status, ["pending", "partial"])))
    .orderBy(asc(installmentBills.dueDate));
  for (const b of bills) {
    const m = monthOf(b.dueDate);
    if (buckets.has(m)) {
      buckets.set(m, (buckets.get(m) ?? 0) + (b.totalCents - b.paidCents));
    }
  }
  return [...buckets.entries()].map(([month, amountCents]) => ({ month, amountCents }));
}

/** 手动清理总览缓存（可在写操作后调用）。key 含客户维度，直接按 namespace 清 */
export async function invalidateOverviewStats(): Promise<void> {
  await invalidateNamespace("stats");
}
