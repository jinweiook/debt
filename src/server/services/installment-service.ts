import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Db } from "@/server/db/client";
import { insertAndGetId } from "@/server/db/helpers";
import { debtAccounts, installmentBills, type OwnerId } from "@/server/db/schema";
import { BusinessRuleError, NotFoundError, ValidationError } from "@/server/lib/errors";
import { addMonthsToDate } from "@/server/lib/dates";
import {
  computeRecomputedDynamicBills,
  DYNAMIC_PLANS,
  generateDynamicSchedule,
  type DynamicPlan,
} from "@/lib/installment-calc";
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

/** dynamic 模式下的还款方式（从共享纯函数模块重导出） */
export { DYNAMIC_PLANS, type DynamicPlan };

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
 * 动态利息模式生成账单：ACT/360 按日计息，
 * 第 1 期天数 = startDate → firstDueDate，后续各期天数 = 上期 dueDate → 本期 dueDate，
 * 每期利息 = round(当期剩余本金 × 年化 ÷ 360 × 实际天数)。
 */
export function generateDynamicBills(params: {
  principalCents: number;
  termMonths: number;
  startDate?: string;
  firstDueDate: string;
  annualRateBps: number;
  plan: DynamicPlan;
}): BillInput[] {
  const { principalCents, termMonths, startDate, firstDueDate, annualRateBps, plan } = params;
  if (termMonths < 1) throw new ValidationError("期数至少为 1");
  if (annualRateBps <= 0) throw new ValidationError("年化利率必须大于 0");

  return generateDynamicSchedule({
    principalCents,
    termMonths,
    startDate,
    firstDueDate,
    annualRateBps,
    plan,
  }).map((row) => ({
    periodNo: row.periodNo,
    dueDate: row.dueDate,
    principalCents: row.principalCents,
    interestCents: row.interestCents,
  }));
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
    const accountId = await insertAndGetId(tx, debtAccounts, {
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
    });
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
 * 重算 dynamic 利息账户下所有未还账单的利息（ACT/360）及计划本金，
 * 并同步账户剩余本金与结清状态。必须在事务内调用，传入 tx。
 */
export async function recomputeDynamicBills(tx: Db, accountId: number): Promise<void> {
  const [account] = await tx
    .select()
    .from(debtAccounts)
    .where(eq(debtAccounts.id, accountId))
    .limit(1);
  if (!account || account.interestMode !== "dynamic" || !account.annualRateBps) return;

  const plan: DynamicPlan = (account.dynamicPlan as DynamicPlan | null) ?? "equalPrincipal";
  const bills = await tx
    .select()
    .from(installmentBills)
    .where(eq(installmentBills.accountId, accountId))
    .orderBy(asc(installmentBills.periodNo));

  const res = computeRecomputedDynamicBills({
    totalPrincipal: account.principalCents,
    annualRateBps: account.annualRateBps,
    plan,
    startDate: account.startDate,
    bills,
  });

  for (const u of res.updates) {
    await tx
      .update(installmentBills)
      .set({
        principalCents: u.principalCents,
        interestCents: u.interestCents,
        totalCents: u.totalCents,
        status: u.status,
      })
      .where(eq(installmentBills.id, u.id));
  }

  await tx
    .update(debtAccounts)
    .set({
      remainingPrincipalCents: res.remainingPrincipalCents,
      status: res.accountStatus,
      updatedAt: new Date(),
    })
    .where(eq(debtAccounts.id, accountId));
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

    // 同步账户冗余本金（以账户原总本金 + 当期本金差额为准，避免先息后本提前还本后双重扣减）
    const all = await tx.select().from(installmentBills).where(eq(installmentBills.accountId, bill.accountId));
    const principalDelta = principal - bill.principalCents;
    const totalPrincipal = Math.max(0, account.principalCents + principalDelta);
    const settledPrincipal = all.reduce((s, b) => {
      const p = b.id === billId ? principal : b.principalCents;
      return s + (b.advanced === 1 ? Math.max(p, b.paidPrincipalCents) : b.paidPrincipalCents);
    }, 0);
    await tx
      .update(debtAccounts)
      .set({
        principalCents: totalPrincipal,
        remainingPrincipalCents: Math.max(0, totalPrincipal - settledPrincipal),
        termMonths: all.length,
        updatedAt: new Date(),
      })
      .where(eq(debtAccounts.id, bill.accountId));
  });
}

/** 编辑分期账户级信息。annualRateBps 仅 dynamic 且无任何已还/垫付账单时可改，改后重算全部账单。 */
export async function updateInstallmentAccount(
  accountId: number,
  patch: { title?: string; source?: string; startDate?: string; note?: string; annualRateBps?: number | null },
  ownerId: OwnerId,
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [account] = await tx.select().from(debtAccounts).where(eq(debtAccounts.id, accountId)).limit(1);
    if (!account || account.type !== "installment") throw new NotFoundError("分期账户不存在");
    await assertPersonAccess(account.personId, ownerId);

    const changingRate = patch.annualRateBps !== undefined && patch.annualRateBps !== account.annualRateBps;
    const changingStartDate = patch.startDate !== undefined && patch.startDate !== account.startDate;
    if (changingRate) {
      if (account.interestMode !== "dynamic") {
        throw new BusinessRuleError("仅动态利息模式的分期可以修改年化利率");
      }
      if (patch.annualRateBps == null || patch.annualRateBps <= 0 || patch.annualRateBps > 10000) {
        throw new ValidationError("年化利率不合法");
      }
      const [touched] = await tx
        .select({ id: installmentBills.id })
        .from(installmentBills)
        .where(
          and(
            eq(installmentBills.accountId, accountId),
            inArray(installmentBills.status, ["partial", "paid", "advanced"]),
          ),
        )
        .limit(1);
      if (touched) throw new BusinessRuleError("已有还款或垫付记录，不能再修改年化利率");
    }

    await tx
      .update(debtAccounts)
      .set({
        title: patch.title?.trim() || account.title,
        source: patch.source !== undefined ? patch.source || null : account.source,
        startDate: patch.startDate ?? account.startDate,
        note: patch.note !== undefined ? patch.note || null : account.note,
        annualRateBps: changingRate ? patch.annualRateBps : account.annualRateBps,
        updatedAt: new Date(),
      })
      .where(eq(debtAccounts.id, accountId));

    if (account.interestMode === "dynamic" && (changingRate || changingStartDate)) {
      await recomputeDynamicBills(tx as unknown as Db, accountId);
    }
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
