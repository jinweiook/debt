import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { advances, debtAccounts, installmentBills, persons, repayments, users } from "@/server/db/schema";
import { ValidationError } from "@/server/lib/errors";
import { invalidateNamespace } from "@/server/redis/cache";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * 备份：整库 JSON Snapshot（version + zod 校验）。
 * 导入 = 单事务内按依赖逆序清表 → 按依赖顺序插入（保留原 id）→ 失败整体回滚。
 */

export const SNAPSHOT_VERSION = 1;

const cents = z.number().int().min(0);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const personRow = z.object({
  id: z.number().int().positive(),
  // 兼容旧版快照：缺省时导入到当前登录客户名下
  ownerUserId: z.number().int().positive().optional(),
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

/**
 * 导出快照。按客户隔离：
 * - 普通客户：只导出自己名下的全部数据
 * - 管理员（ownerId=null）：导出整库
 */
export async function exportSnapshot(ownerId: number | null): Promise<Snapshot> {
  const db = getDb();

  if (ownerId == null) {
    const [p, a, b, r, ad] = await Promise.all([
      db.select().from(persons),
      db.select().from(debtAccounts),
      db.select().from(installmentBills),
      db.select().from(repayments),
      db.select().from(advances),
    ]);
    return buildSnapshot(p, a, b, r, ad);
  }

  const ownPersons = await db.select().from(persons).where(eq(persons.ownerUserId, ownerId));
  const personIds = ownPersons.map((p) => p.id);
  if (personIds.length === 0) {
    return buildSnapshot([], [], [], [], []);
  }
  const ownAccounts = await db.select().from(debtAccounts).where(inArray(debtAccounts.personId, personIds));
  const accountIds = ownAccounts.map((a) => a.id);
  const ownBills = accountIds.length
    ? await db.select().from(installmentBills).where(inArray(installmentBills.accountId, accountIds))
    : [];
  const ownRepayments = await db.select().from(repayments).where(inArray(repayments.personId, personIds));
  const ownAdvances = await db.select().from(advances).where(inArray(advances.personId, personIds));
  return buildSnapshot(ownPersons, ownAccounts, ownBills, ownRepayments, ownAdvances);
}

function buildSnapshot(
  p: (typeof persons.$inferSelect)[],
  a: (typeof debtAccounts.$inferSelect)[],
  b: (typeof installmentBills.$inferSelect)[],
  r: (typeof repayments.$inferSelect)[],
  ad: (typeof advances.$inferSelect)[],
): Snapshot {
  return {
    version: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    persons: p.map((x) => ({
      id: x.id, ownerUserId: x.ownerUserId, name: x.name, note: x.note, contact: x.contact,
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

/**
 * 导入快照。按客户隔离：
 * - 管理员（ownerId=null）：整库替换（沿用旧行为）
 * - 普通客户：仅替换自己名下数据，快照中所有欠款人强制归属到当前客户；
 *   快照 id 与其他客户的数据冲突时拒绝导入（整体回滚，不会污染他人数据）
 */
export async function importSnapshot(snapshot: Snapshot, ownerId: number | null): Promise<void> {
  const db = getDb();

  if (ownerId == null) {
    const adminId = await firstAdminId();
    await db.transaction(async (tx) => {
      await deleteAllBusinessData(tx);
      await insertSnapshotData(tx, snapshot, adminId);
    });
    await invalidateAllCache();
    return;
  }

  // 当前客户已有数据 id
  const ownPersons = await db.select({ id: persons.id }).from(persons).where(eq(persons.ownerUserId, ownerId));
  const ownPersonIds = ownPersons.map((r) => r.id);
  const ownAccounts = ownPersonIds.length
    ? await db.select({ id: debtAccounts.id }).from(debtAccounts).where(inArray(debtAccounts.personId, ownPersonIds))
    : [];
  const ownAccountIds = ownAccounts.map((r) => r.id);
  const ownBills = ownAccountIds.length
    ? await db.select({ id: installmentBills.id }).from(installmentBills).where(inArray(installmentBills.accountId, ownAccountIds))
    : [];
  const ownBillIds = ownBills.map((r) => r.id);

  // 冲突检测：快照 id 不得与其他客户的现存数据冲突（防止 id 串户）
  const guard = (label: string, snapshotIds: number[], ownIds: number[]) => {
    const own = new Set(ownIds);
    const clash = snapshotIds.filter((id) => !own.has(id));
    if (clash.length > 0) {
      throw new ValidationError(`备份与其他客户的数据 ID 冲突（${label}: ${clash.slice(0, 5).join(", ")}），无法导入`);
    }
  };
  guard("欠款人", snapshot.persons.map((p) => p.id), ownPersonIds);
  guard("账户", snapshot.debtAccounts.map((a) => a.id), ownAccountIds);
  guard("账单", snapshot.installmentBills.map((b) => b.id), ownBillIds);

  await db.transaction(async (tx) => {
    // 依赖逆序删除：只删自己名下数据
    if (ownPersonIds.length > 0) {
      await tx.delete(advances).where(inArray(advances.personId, ownPersonIds));
      await tx.delete(repayments).where(inArray(repayments.personId, ownPersonIds));
    }
    if (ownAccountIds.length > 0) {
      await tx.delete(installmentBills).where(inArray(installmentBills.accountId, ownAccountIds));
    }
    if (ownPersonIds.length > 0) {
      await tx.delete(debtAccounts).where(inArray(debtAccounts.personId, ownPersonIds));
      await tx.delete(persons).where(inArray(persons.id, ownPersonIds));
    }
    await insertSnapshotData(tx, snapshot, ownerId);
  });
  await invalidateAllCache();
}

/** 插入快照数据；快照未携带归属时回退到 fallbackOwnerId */
async function insertSnapshotData(tx: Tx, snapshot: Snapshot, fallbackOwnerId: number): Promise<void> {
  if (snapshot.persons.length > 0) {
    await tx.insert(persons).values(
      snapshot.persons.map((p) => ({ ...p, ownerUserId: p.ownerUserId ?? fallbackOwnerId })),
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
}

async function firstAdminId(): Promise<number> {
  const db = getDb();
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
  if (!admin) throw new ValidationError("系统中不存在管理员账号，无法确定数据归属");
  return admin.id;
}

/** 危险操作：清空全部数据（仅管理员调用，调用方负责鉴权） */
export async function clearAllData(): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await deleteAllBusinessData(tx);
  });
  await invalidateAllCache();
}

async function deleteAllBusinessData(tx: Tx): Promise<void> {
  await tx.delete(advances);
  await tx.delete(repayments);
  await tx.delete(installmentBills);
  await tx.delete(debtAccounts);
  await tx.delete(persons);
}

async function invalidateAllCache() {
  await invalidateNamespace("persons:list");
  await invalidateNamespace("stats");
}
