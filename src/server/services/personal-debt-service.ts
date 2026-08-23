import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { debtAccounts } from "@/server/db/schema";
import { BusinessRuleError, NotFoundError, ValidationError } from "@/server/lib/errors";
import { monthOf } from "@/server/lib/dates";

export const personalDebtInputSchema = z
  .object({
    personId: z.number().int().positive(),
    title: z.string().trim().min(1, "名称不能为空").max(128),
    principalCents: z.number().int().positive("金额必须大于 0"),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    interestType: z.enum(["none", "fixed", "annual"]),
    fixedInterestCents: z.number().int().min(0).nullable().optional(),
    annualRateBps: z.number().int().min(0).max(100000).nullable().optional(),
    note: z.string().trim().max(512).optional().or(z.literal("")),
  })
  .superRefine((v, ctx) => {
    if (v.interestType === "fixed" && (v.fixedInterestCents == null || v.fixedInterestCents < 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "固定利息类型需填写利息金额" });
    }
    if (v.interestType === "annual" && (v.annualRateBps == null || v.annualRateBps <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "年化利息类型需填写年化利率" });
    }
  });
export type PersonalDebtInput = z.infer<typeof personalDebtInputSchema>;

export async function createPersonalDebt(input: PersonalDebtInput) {
  const parsed = personalDebtInputSchema.parse(input);
  const db = getDb();
  const [r] = await db.insert(debtAccounts).values({
    personId: parsed.personId,
    type: "personal",
    title: parsed.title,
    principalCents: parsed.principalCents,
    remainingPrincipalCents: parsed.principalCents,
    interestType: parsed.interestType,
    fixedInterestCents: parsed.interestType === "fixed" ? (parsed.fixedInterestCents ?? 0) : null,
    annualRateBps: parsed.interestType === "annual" ? (parsed.annualRateBps ?? null) : null,
    lastAccrualMonth: parsed.interestType === "annual" ? monthOf(parsed.startDate) : null,
    startDate: parsed.startDate,
    origin: "manual",
    note: parsed.note || null,
  });
  return Number(r.insertId);
}

export async function getPersonalDebt(id: number) {
  const db = getDb();
  const [row] = await db.select().from(debtAccounts).where(eq(debtAccounts.id, id)).limit(1);
  if (!row || row.type !== "personal") throw new NotFoundError("个人欠款不存在");
  return row;
}

/** 某人全部未结清个人欠款（垫付款优先，其余按借出日期升序） */
export async function listOpenPersonalDebts(personId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(debtAccounts)
    .where(and(eq(debtAccounts.personId, personId), eq(debtAccounts.type, "personal"), eq(debtAccounts.status, "open")))
    .orderBy(asc(debtAccounts.startDate), asc(debtAccounts.id));
  return rows.sort((a, b) => {
    if (a.origin === b.origin) return 0;
    return a.origin === "advance" ? -1 : 1;
  });
}

/** 结清/关闭一笔个人欠款（仅允许无剩余时手动关闭） */
export async function closePersonalDebt(id: number) {
  const db = getDb();
  const row = await getPersonalDebt(id);
  if (row.status !== "open") return;
  if (row.remainingPrincipalCents > 0 || row.accruedInterestCents > 0) {
    throw new BusinessRuleError("仍有剩余金额，不能关闭");
  }
  await db.update(debtAccounts).set({ status: "closed", updatedAt: new Date() }).where(eq(debtAccounts.id, id));
}
