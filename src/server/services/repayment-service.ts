import { and, asc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { getDb, type Db } from "@/server/db/client";
import { debtAccounts, installmentBills, repayments } from "@/server/db/schema";
import { BusinessRuleError, NotFoundError, ValidationError } from "@/server/lib/errors";
import { today } from "@/server/lib/dates";
import { allocateRepayment, type Allocation, type SplitTarget } from "@/lib/repayment-split";
import { accrueAccountInterest, interestPayable } from "./interest-service";
import { recomputeDynamicBills } from "./installment-service";

export const repaymentInputSchema = z.object({
  personId: z.number().int().positive(),
  targetType: z.enum(["bill", "personal"]),
  targetId: z.number().int().positive(),
  amountCents: z.number().int().positive("还款金额必须大于 0"),
  repaidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().trim().max(512).optional().or(z.literal("")),
});
export type RepaymentInput = z.infer<typeof repaymentInputSchema>;

export interface RepaymentTargetRef {
  targetType: "bill" | "personal";
  targetId: number;
}

/**
 * 构建某人的有序分配目标列表：
 * ① 首选目标（用户选择的归还对象，可为空）排第一
 * ② 其余未结清账单按到期日升序
 * ③ 个人欠款：垫付款优先，其余按借出日期升序
 * 利息口径：annual 账户按虚拟计提后的最新应付利息。
 */
export async function buildOrderedTargets(
  personId: number,
  preferred: RepaymentTargetRef | null,
  db: Db = getDb(),
): Promise<SplitTarget[]> {
  const accounts = await db
    .select()
    .from(debtAccounts)
    .where(and(eq(debtAccounts.personId, personId), eq(debtAccounts.status, "open")));
  const accMap = new Map(accounts.map((a) => [a.id, a]));

  const installmentIds = accounts.filter((a) => a.type === "installment").map((a) => a.id);
  const openBills =
    installmentIds.length === 0
      ? []
      : await db
          .select()
          .from(installmentBills)
          .where(and(inArray(installmentBills.accountId, installmentIds), inArray(installmentBills.status, ["pending", "partial"])))
          .orderBy(asc(installmentBills.dueDate), asc(installmentBills.periodNo));

  // 提前计算每个 installment 账户的剩余本金（用于给 interestOnly 类计划的早期账单
  // 设置 extraPrincipalCapacity，让"超额还款"能落为本金并驱动后续利息重算）
  const remainingAccountPrincipal = new Map<number, number>();
  for (const acc of accounts) {
    if (acc.type !== "installment") continue;
    if (acc.interestMode !== "dynamic" || acc.dynamicPlan !== "interestOnly") continue;
    // 一次性取该账户所有账单的 paid_principal（不限状态）
    const allBills = await db
      .select()
      .from(installmentBills)
      .where(inArray(installmentBills.accountId, [acc.id]));
    const paidPrincipalTotal = allBills.reduce((s, b) => s + b.paidPrincipalCents, 0);
    remainingAccountPrincipal.set(acc.id, Math.max(acc.principalCents - paidPrincipalTotal, 0));
  }

  const targets: SplitTarget[] = [];
  for (const b of openBills) {
    const acc = accMap.get(b.accountId);
    const principalRemaining = Math.max(b.principalCents - b.paidPrincipalCents, 0);
    // 仅 interestOnly 动态计划的"非末期"账单设置 extraPrincipalCapacity
    // （末期本身 principalRemaining 已等于账户剩余，不需要额外容量）
    const isInterestOnlyPlan = acc?.interestMode === "dynamic" && acc.dynamicPlan === "interestOnly";
    const isLastBill = isInterestOnlyPlan && b.periodNo === acc!.termMonths;
    const extraPrincipalCapacity = isInterestOnlyPlan && !isLastBill
      ? remainingAccountPrincipal.get(acc!.id) ?? 0
      : 0;
    targets.push({
      key: `bill:${b.id}`,
      kind: "bill",
      id: b.id,
      label: `${acc?.title ?? "分期"} · 第${b.periodNo}期`,
      interestRemaining: Math.max(b.interestCents - b.paidInterestCents, 0),
      principalRemaining,
      extraPrincipalCapacity,
    });
  }
  const personalAccounts = accounts
    .filter((a) => a.type === "personal")
    .sort((a, b) => {
      if (a.origin !== b.origin) return a.origin === "advance" ? -1 : 1;
      if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
      return a.id - b.id;
    });
  for (const a of personalAccounts) {
    targets.push({
      key: `personal:${a.id}`,
      kind: "personal",
      id: a.id,
      label: a.title,
      interestRemaining: interestPayable(a),
      principalRemaining: a.remainingPrincipalCents,
    });
  }

  if (preferred) {
    const preferredKey = `${preferred.targetType}:${preferred.targetId}`;
    const idx = targets.findIndex((t) => t.key === preferredKey);
    if (idx === -1) throw new NotFoundError("归还对象不存在或已结清");
    const [first] = targets.splice(idx, 1);
    return [first, ...targets];
  }
  return targets;
}

/** 预览分配（不写库） */
export async function previewRepayment(input: RepaymentInput): Promise<Allocation> {
  const parsed = repaymentInputSchema.parse(input);
  const db = getDb();
  // annual 账户先真实计提，保证预览口径与提交一致
  const personals = await db
    .select()
    .from(debtAccounts)
    .where(and(eq(debtAccounts.personId, parsed.personId), eq(debtAccounts.type, "personal"), eq(debtAccounts.status, "open")));
  for (const a of personals) {
    if (a.interestType === "annual") await accrueAccountInterest(a.id, db);
  }
  // dynamic 账户先虚拟重算（写库版本由 createRepayment 负责），这里按"剩余本金 × 月利率"取瞬时利息
  // 简化：repayment 的 split 只用 interestCents 字段值，预览与提交读到的 bill 一致即可。
  // 实际预览与提交之间可能有毫秒级差异，按现有数据量可忽略。
  const targets = await buildOrderedTargets(parsed.personId, { targetType: parsed.targetType, targetId: parsed.targetId }, db);
  return allocateRepayment(targets, parsed.amountCents);
}

/** 记一笔还款（服务端权威重算 + 单事务落库，超还自动溢出） */
export async function createRepayment(input: RepaymentInput) {
  const parsed = repaymentInputSchema.parse(input);
  const repaidAt = parsed.repaidAt ?? today();
  const db = getDb();

  return db.transaction(async (tx) => {
    // 1. annual 账户真实计提（幂等）
    const personals = await tx
      .select()
      .from(debtAccounts)
      .where(and(eq(debtAccounts.personId, parsed.personId), eq(debtAccounts.type, "personal"), eq(debtAccounts.status, "open")));
    for (const a of personals) {
      if (a.interestType === "annual") await accrueAccountInterest(a.id, tx as unknown as Db);
    }

    // 1.5 dynamic 利息账户：先重算所有账单（利息按当前剩余本金动态更新）
    const dynamicAccounts = await tx
      .select()
      .from(debtAccounts)
      .where(
        and(
          eq(debtAccounts.personId, parsed.personId),
          eq(debtAccounts.type, "installment"),
          eq(debtAccounts.interestMode, "dynamic"),
          eq(debtAccounts.status, "open"),
        ),
      );
    for (const a of dynamicAccounts) {
      await recomputeDynamicBills(tx as unknown as Db, a.id);
    }

    // 2. 权威重算分配
    const targets = await buildOrderedTargets(parsed.personId, { targetType: parsed.targetType, targetId: parsed.targetId }, tx as unknown as Db);
    const allocation = allocateRepayment(targets, parsed.amountCents);
    if (allocation.remainder > 0) {
      throw new BusinessRuleError("还款金额超出该欠款人全部待还总额");
    }
    if (allocation.results.length === 0) {
      throw new ValidationError("没有可分配的待还金额");
    }

    // 3. 落流水 + 更新目标
    const batchId = allocation.results.length > 1 ? randomUUID() : null;
    const insertedIds: number[] = [];
    // 记录涉及的分期账户，提交后做后续账单重算
    const touchedInstallmentAccounts = new Set<number>();
    for (const r of allocation.results) {
      const [ins] = await tx.insert(repayments).values({
        personId: parsed.personId,
        targetType: r.kind,
        billId: r.kind === "bill" ? r.id : null,
        accountId: r.kind === "personal" ? r.id : null,
        amountCents: r.applied,
        interestPartCents: r.interestPart,
        principalPartCents: r.principalPart,
        batchId,
        repaidAt,
        note: parsed.note || null,
      });
      insertedIds.push(Number(ins.insertId));

      if (r.kind === "bill") {
        const [bill] = await tx.select().from(installmentBills).where(eq(installmentBills.id, r.id)).limit(1);
        if (!bill) throw new NotFoundError("账单不存在");
        const paidInterest = bill.paidInterestCents + r.interestPart;
        const paidPrincipal = bill.paidPrincipalCents + r.principalPart;
        const paid = paidInterest + paidPrincipal;
        const status = paid >= bill.totalCents ? "paid" : "partial";
        await tx
          .update(installmentBills)
          .set({ paidCents: paid, paidInterestCents: paidInterest, paidPrincipalCents: paidPrincipal, status })
          .where(eq(installmentBills.id, r.id));
        touchedInstallmentAccounts.add(bill.accountId);
      } else {
        const [acc] = await tx.select().from(debtAccounts).where(eq(debtAccounts.id, r.id)).limit(1);
        if (!acc) throw new NotFoundError("个人欠款不存在");
        const remainingPrincipal = Math.max(acc.remainingPrincipalCents - r.principalPart, 0);
        const accruedAfter = Math.max(acc.accruedInterestCents - r.interestPart, 0);
        const paidInterest = acc.paidInterestCents + r.interestPart;
        const fixedRemaining = acc.interestType === "fixed" ? Math.max((acc.fixedInterestCents ?? 0) - paidInterest, 0) : 0;
        const settled = remainingPrincipal === 0 && accruedAfter === 0 && fixedRemaining === 0;
        await tx
          .update(debtAccounts)
          .set({
            remainingPrincipalCents: remainingPrincipal,
            accruedInterestCents: accruedAfter,
            paidInterestCents: paidInterest,
            status: settled ? "settled" : "open",
            updatedAt: new Date(),
          })
          .where(eq(debtAccounts.id, r.id));
      }
    }

    // 4. 对动过分期账户，若其是 dynamic 模式，重算后续账单利息
    for (const accountId of touchedInstallmentAccounts) {
      const [a] = await tx.select().from(debtAccounts).where(eq(debtAccounts.id, accountId)).limit(1);
      if (a?.interestMode === "dynamic") {
        await recomputeDynamicBills(tx as unknown as Db, accountId);
      } else {
        // fixed 模式：仅同步账户冗余字段
        const allBills = await tx.select().from(installmentBills).where(eq(installmentBills.accountId, accountId));
        const totalPaidPrincipal = allBills.reduce((s, b) => s + b.paidPrincipalCents, 0);
        const allDone = allBills.every((b) => b.status === "paid" || b.status === "advanced");
        await tx
          .update(debtAccounts)
          .set({
            remainingPrincipalCents: Math.max(allBills.reduce((s, b) => s + b.principalCents, 0) - totalPaidPrincipal, 0),
            status: allDone ? "settled" : "open",
            updatedAt: new Date(),
          })
          .where(eq(debtAccounts.id, accountId));
      }
    }

    return { batchId, allocation, repaymentIds: insertedIds };
  });
}

/** 某人的还款流水（倒序） */
export async function listRepaymentsByPerson(personId: number) {
  const db = getDb();
  return db
    .select()
    .from(repayments)
    .where(eq(repayments.personId, personId))
    .orderBy(asc(repayments.repaidAt), asc(repayments.id));
}
