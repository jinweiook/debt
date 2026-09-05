import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "@/server/db/client";
import { debtAccounts, installmentBills, type OwnerId } from "@/server/db/schema";
import { BusinessRuleError, NotFoundError, ValidationError } from "@/server/lib/errors";
import { addMonthsToDate } from "@/server/lib/dates";
import { monthlyInterestCents } from "@/server/lib/money";
import { getPerson } from "./person-service";

/** 校验 person 归属（ownerId=null 表示管理员不限制） */
export async function assertPersonAccess(personId: number, ownerId: OwnerId) {
  await getPerson(personId, ownerId);
}

/** 新增分期的逐期账单输入（金额单位：分） */
export const billInputSchema = z.object({
  periodNo: z.number().int().min(1),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "到期日格式应为 YYYY-MM-DD"),
  principalCents: z.number().int().min(0),
  interestCents: z.number().int().min(0),
});
export type BillInput = z.infer<typeof billInputSchema>;

/** dynamic 模式下的还款方式 */
export const DYNAMIC_PLANS = ["equalPrincipal", "interestOnly", "equalPayment"] as const;
export type DynamicPlan = (typeof DYNAMIC_PLANS)[number];

export const installmentInputSchema = z
  .object({
    personId: z.number().int().positive(),
    title: z.string().trim().min(1, "名称不能为空").max(128),
    source: z.string().trim().max(64).optional().or(z.literal("")),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().trim().max(512).optional().or(z.literal("")),
    interestMode: z.enum(["fixed", "dynamic"]).default("fixed"),
    annualRateBps: z.number().int().min(0).max(10000).nullable().optional(), // 100% 上限
    dynamicPlan: z.enum(DYNAMIC_PLANS).nullable().optional(),
    bills: z.array(billInputSchema).min(1, "至少需要一期账单"),
  })
  .superRefine((v, ctx) => {
    if (v.interestMode === "dynamic") {
      if (v.annualRateBps == null || v.annualRateBps <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "动态利息模式需填写年化利率" });
      }
      if (!v.dynamicPlan) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "动态利息模式需选择还款方式" });
      }
    }
  });
export type InstallmentInput = z.infer<typeof installmentInputSchema>;

/**
 * 批量生成默认账单（fixed 模式）：本金均分（余数归首期），利息默认 0，到期日逐月递增。
 * 生成后用户可在界面逐期调整。
 */
export function generateBills(params: {
  principalCents: number;
  termMonths: number;
  firstDueDate: string;
  interestPerMonthCents?: number;
}): BillInput[] {
  const { principalCents, termMonths, firstDueDate, interestPerMonthCents = 0 } = params;
  if (termMonths < 1) throw new ValidationError("期数至少为 1");
  const base = Math.floor(principalCents / termMonths);
  const remainder = principalCents - base * termMonths;
  return Array.from({ length: termMonths }, (_, i) => ({
    periodNo: i + 1,
    dueDate: addMonthsToDate(firstDueDate, i),
    principalCents: base + (i === 0 ? remainder : 0),
    interestCents: interestPerMonthCents,
  }));
}

/**
 * 动态利息模式生成账单：每期利息 = 月初剩余本金 × 年化 ÷ 12，
 * 本金按还款方式分配。本金未提前还的情况下，这是一份"计划表"；实际还款会触发重算。
 *
 * - equalPrincipal（等额本金）：每月本金 = total/N（余数归末期），利息逐月递减
 * - interestOnly（先息后本）：前 N-1 期本金 = 0，末期本金 = total，利息按剩余本金算（不变）
 * - equalPayment（等额本息）：每月总额 X = P·r·(1+r)^n / ((1+r)^n - 1)，按月分配
 */
export function generateDynamicBills(params: {
  principalCents: number;
  termMonths: number;
  firstDueDate: string;
  annualRateBps: number;
  plan: DynamicPlan;
}): BillInput[] {
  const { principalCents, termMonths, firstDueDate, annualRateBps, plan } = params;
  if (termMonths < 1) throw new ValidationError("期数至少为 1");
  if (annualRateBps <= 0) throw new ValidationError("年化利率必须大于 0");

  // 先按"无提前还本金"的假设，算出每期的月初剩余本金序列
  const planPrincipal: number[] = Array(termMonths).fill(0);
  if (plan === "equalPrincipal") {
    const base = Math.floor(principalCents / termMonths);
    const remainder = principalCents - base * termMonths;
    for (let i = 0; i < termMonths; i++) {
      planPrincipal[i] = base + (i === termMonths - 1 ? remainder : 0);
    }
  } else if (plan === "interestOnly") {
    for (let i = 0; i < termMonths - 1; i++) planPrincipal[i] = 0;
    planPrincipal[termMonths - 1] = principalCents;
  } else {
    // equalPayment：先求每月固定总额 X
    // 公式：X = P * r * (1+r)^n / ((1+r)^n - 1)，其中 r = monthlyRate = annualRate/12
    // 整数实现：迭代模拟，求出使最后一期还清剩余本金的 X
    const r = annualRateBps / 120000; // 月利率（小数）
    let x = 0;
    if (r === 0) {
      x = principalCents / termMonths;
    } else {
      // 初值用连续公式（浮点）作为合理起点
      const pow = Math.pow(1 + r, termMonths);
      x = (principalCents * r * pow) / (pow - 1);
    }
    // 模拟 n 期，每期：interest = remaining * r, principal_i = X - interest, remaining -= principal_i
    let remaining = principalCents;
    const used: number[] = [];
    for (let i = 0; i < termMonths - 1; i++) {
      const interest = Math.round(remaining * r);
      const principal = Math.max(0, Math.round(x) - interest);
      // 防止 principal 把 remaining 减成负数
      const actualPrincipal = Math.min(principal, remaining);
      used.push(actualPrincipal);
      remaining -= actualPrincipal;
    }
    // 末期还清剩余
    used.push(Math.max(0, remaining));
    for (let i = 0; i < termMonths; i++) planPrincipal[i] = used[i];
  }

  // 计算每期：月初剩余本金 → 利息 → 输出
  const result: BillInput[] = [];
  let remainingAtStart = principalCents;
  for (let i = 0; i < termMonths; i++) {
    const interest = monthlyInterestCents(remainingAtStart, annualRateBps);
    result.push({
      periodNo: i + 1,
      dueDate: addMonthsToDate(firstDueDate, i),
      principalCents: planPrincipal[i],
      interestCents: interest,
    });
    remainingAtStart -= planPrincipal[i];
  }
  return result;
}

/** 创建分期账户 + 全部账单（单事务）。先校验 person 归属。 */
export async function createInstallmentDebt(input: InstallmentInput, ownerId: OwnerId) {
  const parsed = installmentInputSchema.parse(input);
  await assertPersonAccess(parsed.personId, ownerId);
  const bills = [...parsed.bills].sort((a, b) => a.periodNo - b.periodNo);

  // 校验：期号连续
  bills.forEach((b, i) => {
    if (b.periodNo !== i + 1) throw new ValidationError("期号必须从 1 开始连续");
  });
  for (const b of bills) {
    if (b.principalCents + b.interestCents <= 0) {
      throw new ValidationError(`第 ${b.periodNo} 期金额必须大于 0`);
    }
  }
  const totalPrincipal = bills.reduce((s, b) => s + b.principalCents, 0);
  const isDynamic = parsed.interestMode === "dynamic";

  const db = getDb();
  return db.transaction(async (tx) => {
    const [acc] = await tx
      .insert(debtAccounts)
      .values({
        personId: parsed.personId,
        type: "installment",
        title: parsed.title,
        source: parsed.source || null,
        principalCents: totalPrincipal,
        remainingPrincipalCents: totalPrincipal,
        interestType: isDynamic ? "annual" : "none",
        annualRateBps: isDynamic ? parsed.annualRateBps : null,
        interestMode: parsed.interestMode,
        dynamicPlan: isDynamic ? parsed.dynamicPlan : null,
        startDate: parsed.startDate,
        termMonths: bills.length,
        note: parsed.note || null,
      })
      .returning({ id: debtAccounts.id });
    const accountId = acc.id;
    await tx.insert(installmentBills).values(
      bills.map((b) => ({
        accountId,
        periodNo: b.periodNo,
        dueDate: b.dueDate,
        principalCents: b.principalCents,
        interestCents: b.interestCents,
        totalCents: b.principalCents + b.interestCents,
      })),
    );
    return accountId;
  });
}

/**
 * 重算 dynamic 利息账户下所有未还账单的利息（interest + total），
 * 基于"计划本金 + 历史已还本金"推算每期月初剩余本金。
 * 必须在事务内调用，传入 tx。
 *
 * 入口场景：还款后，剩余本金减少，后续账单的利息会下降，需要重算
 */
export async function recomputeDynamicBills(tx: Db, accountId: number): Promise<void> {
  const [account] = await tx
    .select()
    .from(debtAccounts)
    .where(eq(debtAccounts.id, accountId))
    .limit(1);
  if (!account || account.interestMode !== "dynamic" || !account.annualRateBps) return;

  const plan: DynamicPlan = (account.dynamicPlan as DynamicPlan | null) ?? "equalPrincipal";
  const rate = account.annualRateBps;
  const totalPrincipal = account.principalCents;

  const bills = await tx
    .select()
    .from(installmentBills)
    .where(eq(installmentBills.accountId, accountId))
    .orderBy(asc(installmentBills.periodNo));

  // 1) 先按当前各期 planPrincipal 重算（防止用户手动改过 planned 本金）
  // 2) 累加 paid_principal 倒推"每期月初剩余本金" → 利息
  let remainingAtStart = totalPrincipal;
  let cumulativePaidPrincipal = 0;
  for (let i = 0; i < bills.length; i++) {
    const b = bills[i];
    // 已还清的账单（含 advanced 垫付的）不再重算，避免与 paidCents 不变量冲突
    if (b.status === "paid" || b.status === "advanced") {
      cumulativePaidPrincipal += b.paidPrincipalCents;
      remainingAtStart = Math.max(0, totalPrincipal - cumulativePaidPrincipal);
      continue;
    }
    // 当前期"月初剩余本金" = 总本金 - 之前所有已还本金
    const remainingThisMonth = Math.max(0, totalPrincipal - cumulativePaidPrincipal);
    // 计划本金：
    //   等额本金 → total/N；先息后本 → 0/末期吸收剩余；等额本息 → 保留原 planPrincipal
    let plannedThis: number;
    if (plan === "equalPrincipal") {
      plannedThis = computeEqualPrincipal(totalPrincipal, b.periodNo, bills.length);
    } else if (plan === "interestOnly") {
      plannedThis = b.periodNo === bills.length
        ? Math.max(0, totalPrincipal - cumulativePaidPrincipal) // 末期吸收全部剩余本金
        : 0;
    } else {
      plannedThis = b.principalCents; // 等额本息：保留当前计划本金
    }
    const interest = monthlyInterestCents(remainingThisMonth, rate);
    const newTotal = plannedThis + interest;

    await tx
      .update(installmentBills)
      .set({
        principalCents: plannedThis,
        interestCents: interest,
        totalCents: newTotal,
      })
      .where(eq(installmentBills.id, b.id));

    // 推进累计已还：本月实际已还的部分（包含多还）
    cumulativePaidPrincipal += b.paidPrincipalCents;
    remainingAtStart = Math.max(0, totalPrincipal - cumulativePaidPrincipal);
  }

  // 同步账户冗余 remaining_principal_cents
  const allBills = await tx
    .select()
    .from(installmentBills)
    .where(eq(installmentBills.accountId, accountId));
  const paidPrincipalTotal = allBills.reduce((s, b) => s + b.paidPrincipalCents, 0);
  await tx
    .update(debtAccounts)
    .set({
      remainingPrincipalCents: Math.max(0, totalPrincipal - paidPrincipalTotal),
      updatedAt: new Date(),
    })
    .where(eq(debtAccounts.id, accountId));
}

function computeEqualPrincipal(total: number, periodNo: number, term: number): number {
  const base = Math.floor(total / term);
  const remainder = total - base * term;
  return periodNo === term ? base + remainder : base;
}

/** 逐期编辑（仅未还、未垫付账单可改）。校验账单 → 账户 → 欠款人归属链。 */
export async function updateBill(
  billId: number,
  patch: { dueDate?: string; principalCents?: number; interestCents?: number; note?: string },
  ownerId: OwnerId,
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [bill] = await tx.select().from(installmentBills).where(eq(installmentBills.id, billId)).limit(1);
    if (!bill) throw new NotFoundError("账单不存在");
    const [account] = await tx.select().from(debtAccounts).where(eq(debtAccounts.id, bill.accountId)).limit(1);
    if (!account) throw new NotFoundError("分期账户不存在");
    await assertPersonAccess(account.personId, ownerId);
    if (bill.status !== "pending") throw new BusinessRuleError("已有还款或已垫付的账单不可修改");

    const principal = patch.principalCents ?? bill.principalCents;
    const interest = patch.interestCents ?? bill.interestCents;
    if (principal < 0 || interest < 0 || principal + interest <= 0) {
      throw new ValidationError("账单金额必须大于 0");
    }
    await tx
      .update(installmentBills)
      .set({
        dueDate: patch.dueDate ?? bill.dueDate,
        principalCents: principal,
        interestCents: interest,
        totalCents: principal + interest,
        note: patch.note ?? bill.note,
      })
      .where(eq(installmentBills.id, billId));

    // 同步账户冗余本金
    const all = await tx.select().from(installmentBills).where(eq(installmentBills.accountId, bill.accountId));
    const totalPrincipal = all.reduce((s, b) => s + (b.id === billId ? principal : b.principalCents), 0);
    const paidPrincipal = all.reduce((s, b) => s + b.paidPrincipalCents, 0);
    await tx
      .update(debtAccounts)
      .set({
        principalCents: totalPrincipal,
        remainingPrincipalCents: totalPrincipal - paidPrincipal,
        termMonths: all.length,
        updatedAt: new Date(),
      })
      .where(eq(debtAccounts.id, bill.accountId));
  });
}

export async function getInstallmentAccountWithBills(accountId: number) {
  const db = getDb();
  const [account] = await db.select().from(debtAccounts).where(eq(debtAccounts.id, accountId)).limit(1);
  if (!account || account.type !== "installment") throw new NotFoundError("分期账户不存在");
  const bills = await db
    .select()
    .from(installmentBills)
    .where(eq(installmentBills.accountId, accountId))
    .orderBy(asc(installmentBills.periodNo));
  return { account, bills };
}

/** 某人全部未结清账单（pending/partial，到期日升序） */
export async function listOpenBillsByPerson(personId: number) {
  const db = getDb();
  const accounts = await db
    .select()
    .from(debtAccounts)
    .where(and(eq(debtAccounts.personId, personId), eq(debtAccounts.type, "installment"), eq(debtAccounts.status, "open")));
  if (accounts.length === 0) return [];
  const bills = await db
    .select()
    .from(installmentBills)
    .where(
      and(
        inArray(installmentBills.accountId, accounts.map((a) => a.id)),
        inArray(installmentBills.status, ["pending", "partial"]),
      ),
    )
    .orderBy(asc(installmentBills.dueDate), asc(installmentBills.periodNo));
  const accMap = new Map(accounts.map((a) => [a.id, a]));
  return bills.map((b) => ({ bill: b, account: accMap.get(b.accountId)! }));
}
