"use server";

import { revalidatePath } from "next/cache";
import { createRepayment, previewRepayment, buildOrderedTargets } from "@/server/services/repayment-service";
import { markBillAdvanced } from "@/server/services/advance-service";
import { invalidateOverviewStats } from "@/server/services/stats-service";
import { invalidateCache } from "@/server/redis/cache";
import { toActionError, type ActionResult } from "@/server/lib/errors";
import type { Allocation } from "@/lib/repayment-split";

async function clearStatsCache() {
  await invalidateOverviewStats();
  await invalidateCache("persons:list", "all");
  await invalidateCache("persons:list", "active");
}

export async function previewRepaymentAction(input: unknown): Promise<ActionResult<Allocation>> {
  try {
    const allocation = await previewRepayment(input as never);
    return { ok: true, data: allocation };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function createRepaymentAction(
  input: unknown,
): Promise<ActionResult<{ batchId: string | null; count: number; personId: number }>> {
  try {
    const result = await createRepayment(input as never);
    const personId = (input as { personId: number }).personId;
    await clearStatsCache();
    revalidatePath("/");
    revalidatePath(`/persons/${personId}`);
    return { ok: true, data: { batchId: result.batchId, count: result.allocation.results.length, personId } };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function listRepaymentTargetsAction(
  personId: number,
): Promise<ActionResult<Awaited<ReturnType<typeof buildOrderedTargets>>>> {
  try {
    const targets = await buildOrderedTargets(personId, null);
    return { ok: true, data: targets };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function markBillAdvancedAction(
  billId: number,
  personId: number,
): Promise<ActionResult<{ generatedAccountId: number; amount: number }>> {
  try {
    const result = await markBillAdvanced(billId);
    await clearStatsCache();
    revalidatePath(`/persons/${personId}`);
    revalidatePath("/");
    return { ok: true, data: { generatedAccountId: result.generatedAccountId, amount: result.amount } };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}
