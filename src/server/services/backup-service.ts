import { z } from "zod";
import { getDb } from "@/server/db/client";
import { advances, debtAccounts, installmentBills, persons, repayments } from "@/server/db/schema";
import { ValidationError } from "@/server/lib/errors";
import { invalidateNamespace } from "@/server/redis/cache";

/**
 * 备份：整库 JSON Snapshot（version + zod 校验）。
 * 导入 = 单事务内按依赖逆序清表 → 按依赖顺序插入（保留原 id）→ 失败整体回滚。
 */

export const SNAPSHOT_VERSION = 1;

const cents = z.number().int().min(0);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const personRow = z.object({
  id: z.number().int().positive(),
  name: z.string().max(64),
  note: z.string().max(512).nullable(),
  contact: z.string().max(128).nullable(),
  defaultRepayDay: z.number().int().min(1).max(31).nullable(),
  status: z.enum(["active", "archived"]),
});

const accountRow = z.object({
  id: z.number().int().positive(),
  personId: z.number().int().positive(),
  type: z.enum(["installment", "personal"]),
  title: z.string().max(128),
  source: z.string().max(64).nullable(),
  principalCents: cents,
  remainingPrincipalCents: cents,
  interestType: z.enum(["none", "fixed", "annual"]),
  fixedInterestCents: cents.nullable(),
  annualRateBps: z.number().int().min(0).nullable(),
  accruedInterestCents: cents,
  paidInterestCents: cents,
  lastAccrualMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  startDate: dateStr,
  termMonths: z.number().int().positive().nullable(),
  status: z.enum(["open", "settled", "closed"]),
  origin: z.enum(["manual", "advance"]),
  advanceId: z.number().int().positive().nullable(),
  note: z.string().max(512).nullable(),
});

const billRow = z
  .object({
    id: z.number().int().positive(),
    accountId: z.number().int().positive(),
    periodNo: z.number().int().positive(),
    dueDate: dateStr,
    principalCents: cents,
    interestCents: cents,
    totalCents: cents,
    paidCents: cents,
    paidInterestCents: cents,
    paidPrincipalCents: cents,
    advanced: z.union([z.literal(0), z.literal(1)]),
    advanceId: z.number().int().positive().nullable(),
    status: z.enum(["pending", "partial", "paid", "advanced"]),
    note: z.string().max(512).nullable(),
  })
  .refine((b) => b.totalCents === b.principalCents + b.interestCents, { message: "账单合计不等于本金+利息" });

const repaymentRow = z
  .object({
    id: z.number().int().positive(),
    personId: z.number().int().positive(),
    targetType: z.enum(["bill", "personal"]),
    billId: z.number().int().positive().nullable(),
    accountId: z.number().int().positive().nullable(),
    amountCents: cents,
    interestPartCents: cents,
    principalPartCents: cents,
    batchId: z.string().length(36).nullable(),
    repaidAt: dateStr,
    note: z.string().max(512).nullable(),
  })
  .refine((r) => r.amountCents === r.interestPartCents + r.principalPartCents, { message: "还款拆分不等于总额" })
  .refine((r) => (r.targetType === "bill" ? r.billId != null : r.accountId != null), { message: "还款目标缺失" });

const advanceRow = z.object({
  id: z.number().int().positive(),
  personId: z.number().int().positive(),
  billId: z.number().int().positive(),
  amountCents: cents,
  advanceDate: dateStr,
  generatedAccountId: z.number().int().positive(),
  note: z.string().max(512).nullable(),
});

export const snapshotSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  exportedAt: z.string(),
  persons: z.array(personRow),
  debtAccounts: z.array(accountRow),
  installmentBills: z.array(billRow),
  repayments: z.array(repaymentRow),
  advances: z.array(advanceRow),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export async function exportSnapshot(): Promise<Snapshot> {
  const db = getDb();
  const [p, a, b, r, ad] = await Promise.all([
    db.select().from(persons),
    db.select().from(debtAccounts),
    db.select().from(installmentBills),
    db.select().from(repayments),
    db.select().from(advances),
  ]);
  return {
    version: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    persons: p.map((x) => ({
      id: x.id, name: x.name, note: x.note, contact: x.contact,
      defaultRepayDay: x.defaultRepayDay, status: x.status as "active" | "archived",
    })),
    debtAccounts: a.map((x) => ({
      id: x.id, personId: x.personId, type: x.type as "installment" | "personal", title: x.title,
      source: x.source, principalCents: x.principalCents, remainingPrincipalCents: x.remainingPrincipalCents,
      interestType: x.interestType as "none" | "fixed" | "annual", fixedInterestCents: x.fixedInterestCents,
      annualRateBps: x.annualRateBps, accruedInterestCents: x.accruedInterestCents, paidInterestCents: x.paidInterestCents,
      lastAccrualMonth: x.lastAccrualMonth, startDate: x.startDate, termMonths: x.termMonths,
      status: x.status as "open" | "settled" | "closed", origin: x.origin as "manual" | "advance",
      advanceId: x.advanceId, note: x.note,
    })),
    installmentBills: b.map((x) => ({
      id: x.id, accountId: x.accountId, periodNo: x.periodNo, dueDate: x.dueDate,
      principalCents: x.principalCents, interestCents: x.interestCents, totalCents: x.totalCents,
      paidCents: x.paidCents, paidInterestCents: x.paidInterestCents, paidPrincipalCents: x.paidPrincipalCents,
      advanced: x.advanced as 0 | 1, advanceId: x.advanceId,
      status: x.status as "pending" | "partial" | "paid" | "advanced", note: x.note,
    })),
    repayments: r.map((x) => ({
      id: x.id, personId: x.personId, targetType: x.targetType as "bill" | "personal",
      billId: x.billId, accountId: x.accountId, amountCents: x.amountCents,
      interestPartCents: x.interestPartCents, principalPartCents: x.principalPartCents,
      batchId: x.batchId, repaidAt: x.repaidAt, note: x.note,
    })),
    advances: ad.map((x) => ({
      id: x.id, personId: x.personId, billId: x.billId, amountCents: x.amountCents,
      advanceDate: x.advanceDate, generatedAccountId: x.generatedAccountId, note: x.note,
    })),
  };
}

export function validateSnapshot(raw: unknown): Snapshot {
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ValidationError(`备份文件校验失败：${first.path.join(".")} ${first.message}`);
  }
  const s = parsed.data;
  // 引用完整性兜底
  const personIds = new Set(s.persons.map((p) => p.id));
  const accountIds = new Set(s.debtAccounts.map((a) => a.id));
  const billIds = new Set(s.installmentBills.map((b) => b.id));
  for (const a of s.debtAccounts) {
    if (!personIds.has(a.personId)) throw new ValidationError(`备份损坏：账户 ${a.id} 引用了不存在的欠款人`);
  }
  for (const b of s.installmentBills) {
    if (!accountIds.has(b.accountId)) throw new ValidationError(`备份损坏：账单 ${b.id} 引用了不存在的账户`);
  }
  for (const r of s.repayments) {
    if (!personIds.has(r.personId)) throw new ValidationError(`备份损坏：流水 ${r.id} 引用了不存在的欠款人`);
    if (r.billId != null && !billIds.has(r.billId)) throw new ValidationError(`备份损坏：流水 ${r.id} 引用了不存在的账单`);
    if (r.accountId != null && !accountIds.has(r.accountId)) throw new ValidationError(`备份损坏：流水 ${r.id} 引用了不存在的账户`);
  }
  return s;
}

/** 导入：单事务清库重建，失败整体回滚 */
export async function importSnapshot(snapshot: Snapshot): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    // 依赖逆序删除
    await tx.delete(advances);
    await tx.delete(repayments);
    await tx.delete(installmentBills);
    await tx.delete(debtAccounts);
    await tx.delete(persons);

    if (snapshot.persons.length > 0) {
      await tx.insert(persons).values(
        snapshot.persons.map((p) => ({ ...p })),
      );
    }
    if (snapshot.debtAccounts.length > 0) {
      await tx.insert(debtAccounts).values(snapshot.debtAccounts.map((a) => ({ ...a })));
    }
    if (snapshot.installmentBills.length > 0) {
      await tx.insert(installmentBills).values(snapshot.installmentBills.map((b) => ({ ...b })));
    }
    if (snapshot.repayments.length > 0) {
      await tx.insert(repayments).values(snapshot.repayments.map((r) => ({ ...r })));
    }
    if (snapshot.advances.length > 0) {
      await tx.insert(advances).values(snapshot.advances.map((a) => ({ ...a })));
    }
  });
  await invalidateAllCache();
}

/** 危险操作：清空全部数据 */
export async function clearAllData(): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(advances);
    await tx.delete(repayments);
    await tx.delete(installmentBills);
    await tx.delete(debtAccounts);
    await tx.delete(persons);
  });
  await invalidateAllCache();
}

async function invalidateAllCache() {
  await invalidateNamespace("persons:list");
  await invalidateNamespace("stats");
}
