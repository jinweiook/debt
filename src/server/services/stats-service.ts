import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  advances,
  debtAccounts,
  installmentBills,
  persons,
  repayments,
  roles,
  userRoles,
  users,
  type OwnerId,
} from "@/server/db/schema";
import { BUILTIN_ROLES } from "@/lib/rbac";
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

export interface CustomerOverview {
  userId: string;
  username: string;
  displayName: string | null;
  phone: string | null;
  note: string | null;
  role: string;
  roleNames: string[];
  status: string;
  activePersons: number;
  openInstallmentCount: number;
  openPersonalCount: number;
  totalOutstanding: number;
  installmentRemaining: number;
  personalRemaining: number;
  totalReceived: number;
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
  const [accounts, reps, advs] = await Promise.all([
    db.select().from(debtAccounts).where(eq(debtAccounts.personId, personId)),
    db.select().from(repayments).where(eq(repayments.personId, personId)),
    db.select().from(advances).where(eq(advances.personId, personId)),
  ]);

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

  const totalReceived = reps.reduce((s, r) => s + r.amountCents, 0);
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

/** 全站总览（带 Redis/进程内缓存，按客户隔离：ownerId=null 表示管理员汇总全部） */
export async function overviewStats(ownerId: OwnerId): Promise<PersonStats & { activePersons: number }> {
  return getOrSet(
    "stats",
    `overview:${ownerId == null ? "admin" : `u${ownerId}`}`,
    async () => {
      const db = getDb();
      const where =
        ownerId == null ? eq(persons.status, "active") : and(eq(persons.status, "active"), eq(persons.ownerUserId, ownerId));
      const allPersons = await db.select().from(persons).where(where);

      if (allPersons.length === 0) {
        return {
          personId: 0,
          totalOutstanding: 0,
          installmentRemaining: 0,
          personalRemaining: 0,
          totalReceived: 0,
          totalAdvanced: 0,
          activePersons: 0,
        };
      }

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

/**
 * 按账号维度汇总各客户账单总览（包含 admin 自身在内的全部账号）。
 * 批量查库后在内存聚合，避免 N+1 查询。
 */
export async function customerOverviews(): Promise<CustomerOverview[]> {
  return getOrSet(
    "stats",
    "overview:customers",
    async () => {
      const db = getDb();
      const [userRows, roleRows, userRoleRows, activePersons, allAccounts, openBills, allReps, allAdvs] =
        await Promise.all([
          db.select().from(users).orderBy(asc(users.createdAt)),
          db.select().from(roles),
          db.select().from(userRoles),
          db.select().from(persons).where(eq(persons.status, "active")),
          db.select().from(debtAccounts),
          db
            .select()
            .from(installmentBills)
            .where(inArray(installmentBills.status, ["pending", "partial"])),
          db.select().from(repayments),
          db.select().from(advances),
        ]);

      const roleMap = new Map(roleRows.map((r) => [r.id, r]));
      const roleNamesByUser = new Map<string, string[]>();
      for (const ur of userRoleRows) {
        const r = roleMap.get(ur.roleId);
        if (!r) continue;
        const list = roleNamesByUser.get(ur.userId) ?? [];
        list.push(r.name);
        roleNamesByUser.set(ur.userId, list);
      }

      const billRemByAccount = new Map<number, number>();
      for (const b of openBills) {
        billRemByAccount.set(b.accountId, (billRemByAccount.get(b.accountId) ?? 0) + (b.totalCents - b.paidCents));
      }

      const personOwnerMap = new Map<number, string>();
      for (const p of activePersons) {
        personOwnerMap.set(p.id, p.ownerUserId);
      }

      type AccBucket = {
        activePersons: number;
        openInstallmentCount: number;
        openPersonalCount: number;
        installmentRemaining: number;
        personalRemaining: number;
        totalReceived: number;
        totalAdvanced: number;
      };
      const buckets = new Map<string, AccBucket>();
      const ensure = (uid: string): AccBucket => {
        let b = buckets.get(uid);
        if (!b) {
          b = {
            activePersons: 0,
            openInstallmentCount: 0,
            openPersonalCount: 0,
            installmentRemaining: 0,
            personalRemaining: 0,
            totalReceived: 0,
            totalAdvanced: 0,
          };
          buckets.set(uid, b);
        }
        return b;
      };

      for (const p of activePersons) {
        ensure(p.ownerUserId).activePersons += 1;
      }

      for (const acc of allAccounts) {
        const ownerId = personOwnerMap.get(acc.personId);
        if (!ownerId) continue; // 忽略已归档欠款人名下账户，与 overviewStats 口径一致
        const b = ensure(ownerId);
        if (acc.type === "installment") {
          if (acc.status === "open") b.openInstallmentCount += 1;
          b.installmentRemaining += billRemByAccount.get(acc.id) ?? 0;
        } else if (acc.type === "personal" && acc.status === "open") {
          b.openPersonalCount += 1;
          b.personalRemaining += acc.remainingPrincipalCents + virtualAccruedInterest(acc);
        }
      }

      for (const rep of allReps) {
        const ownerId = personOwnerMap.get(rep.personId);
        if (!ownerId) continue;
        ensure(ownerId).totalReceived += rep.amountCents;
      }

      for (const adv of allAdvs) {
        const ownerId = personOwnerMap.get(adv.personId);
        if (!ownerId) continue;
        ensure(ownerId).totalAdvanced += adv.amountCents;
      }

      const result: CustomerOverview[] = userRows.map((u) => {
        const b = ensure(u.id);
        const boundNames = roleNamesByUser.get(u.id);
        const fallbackName = BUILTIN_ROLES.find((r) => r.code === u.role)?.name ?? u.role;
        return {
          userId: u.id,
          username: u.username,
          displayName: u.displayName ?? null,
          phone: u.phone ?? null,
          note: u.note ?? null,
          role: u.role,
          roleNames: boundNames && boundNames.length > 0 ? boundNames : [fallbackName],
          status: u.status,
          activePersons: b.activePersons,
          openInstallmentCount: b.openInstallmentCount,
          openPersonalCount: b.openPersonalCount,
          totalOutstanding: b.installmentRemaining + b.personalRemaining,
          installmentRemaining: b.installmentRemaining,
          personalRemaining: b.personalRemaining,
          totalReceived: b.totalReceived,
          totalAdvanced: b.totalAdvanced,
        };
      });

      return result.sort((a, b) => {
        if (b.totalOutstanding !== a.totalOutstanding) return b.totalOutstanding - a.totalOutstanding;
        if (b.activePersons !== a.activePersons) return b.activePersons - a.activePersons;
        return a.username.localeCompare(b.username);
      });
    },
    { ttlSeconds: STATS_TTL },
  );
}

/** 未来每月预计应收。personId=null 时按客户维度过滤（仅统计 active 欠款人） */
export async function monthlyForecast(personId: number | null, months = 12, ownerId: OwnerId = null): Promise<MonthlyForecast[]> {
  const db = getDb();
  let accountIds: number[] = [];
  if (personId != null) {
    const accounts = await db
      .select()
      .from(debtAccounts)
      .where(and(eq(debtAccounts.personId, personId), eq(debtAccounts.type, "installment")));
    accountIds = accounts.map((a) => a.id);
  } else {
    const conditions = [eq(debtAccounts.type, "installment"), eq(persons.status, "active")];
    if (ownerId != null) conditions.push(eq(persons.ownerUserId, ownerId));
    const accounts = await db
      .select({ id: debtAccounts.id })
      .from(debtAccounts)
      .innerJoin(persons, eq(debtAccounts.personId, persons.id))
      .where(and(...conditions));
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
