"use server";

import { revalidatePath } from "next/cache";
import { createRepayment, previewRepayment, buildOrderedTargets, deleteRepayments } from "@/server/services/repayment-service";
import { markBillAdvanced } from "@/server/services/advance-service";
import { assertPersonAccess } from "@/server/services/installment-service";
import { invalidateOverviewStats } from "@/server/services/stats-service";
import { invalidateNamespace } from "@/server/redis/cache";
import { requirePermission } from "@/server/lib/auth-context";
import { toActionError, type ActionResult } from "@/server/lib/errors";
import type { Allocation } from "@/lib/repayment-split";

async function clearStatsCache() {
  await invalidateOverviewStats();
  await invalidateNamespace("persons:list");
}

export async function previewRepaymentAction(input: unknown): Promise<ActionResult<Allocation>> {
  try {
    const auth = await requirePermission("repayment:create");
    const allocation = await previewRepayment(input as never, auth.ownerId);
    return { ok: true, data: allocation };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function createRepaymentAction(
  input: unknown,
): Promise<ActionResult<{ batchId: string | null; count: number; personId: number }>> {
  try {
    const auth = await requirePermission("repayment:create");
    const result = await createRepayment(input as never, auth.ownerId);
    const personId = (input as { personId: number }).personId;
    await clearStatsCache();
    revalidatePath("/");
    revalidatePath("/loans");
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
    const auth = await requirePermission("repayment:create");
    await assertPersonAccess(personId, auth.ownerId);
    const targets = await buildOrderedTargets(personId, null);
    return { ok: true, data: targets };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function deleteRepaymentsAction(ids: number[], personId: number): Promise<ActionResult<null>> {
  try {
    const auth = await requirePermission("repayment:delete");
    await deleteRepayments(ids, auth.ownerId);
    await clearStatsCache();
    revalidatePath(`/persons/${personId}`);
    revalidatePath("/");
    revalidatePath("/loans");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function markBillAdvancedAction(
  billId: number,
  personId: number,
): Promise<ActionResult<{ generatedAccountId: number; amount: number }>> {
  try {
    const auth = await requirePermission("advance:create");
    const result = await markBillAdvanced(billId, auth.ownerId);
    await clearStatsCache();
    revalidatePath(`/persons/${personId}`);
    revalidatePath("/loans");
    revalidatePath("/");
    return { ok: true, data: { generatedAccountId: result.generatedAccountId, amount: result.amount } };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}
