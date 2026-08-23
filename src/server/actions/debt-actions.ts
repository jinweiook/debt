"use server";

import { revalidatePath } from "next/cache";
import { createInstallmentDebt, updateBill } from "@/server/services/installment-service";
import { createPersonalDebt, closePersonalDebt } from "@/server/services/personal-debt-service";
import { invalidateOverviewStats } from "@/server/services/stats-service";
import { invalidateCache } from "@/server/redis/cache";
import { toActionError, type ActionResult } from "@/server/lib/errors";

async function clearStatsCache() {
  await invalidateOverviewStats();
  await invalidateCache("persons:list", "all");
  await invalidateCache("persons:list", "active");
}

export async function createInstallmentDebtAction(input: unknown): Promise<ActionResult<{ accountId: number; personId: number }>> {
  try {
    const accountId = await createInstallmentDebt(input as never);
    const personId = (input as { personId: number }).personId;
    await clearStatsCache();
    revalidatePath("/");
    revalidatePath(`/persons/${personId}`);
    return { ok: true, data: { accountId, personId } };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function updateBillAction(
  billId: number,
  personId: number,
  patch: { dueDate?: string; principalCents?: number; interestCents?: number; note?: string },
): Promise<ActionResult<null>> {
  try {
    await updateBill(billId, patch);
    await clearStatsCache();
    revalidatePath(`/persons/${personId}`);
    revalidatePath("/");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function createPersonalDebtAction(input: unknown): Promise<ActionResult<{ accountId: number; personId: number }>> {
  try {
    const accountId = await createPersonalDebt(input as never);
    const personId = (input as { personId: number }).personId;
    await clearStatsCache();
    revalidatePath("/");
    revalidatePath(`/persons/${personId}`);
    return { ok: true, data: { accountId, personId } };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function closePersonalDebtAction(accountId: number, personId: number): Promise<ActionResult<null>> {
  try {
    await closePersonalDebt(accountId);
    await clearStatsCache();
    revalidatePath(`/persons/${personId}`);
    revalidatePath("/");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}
