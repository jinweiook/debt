"use server";

import { revalidatePath } from "next/cache";
import { createInstallmentDebt, updateBill, updateInstallmentAccount } from "@/server/services/installment-service";
import { deleteDebtAccounts } from "@/server/services/deletion-service";
import { createPersonalDebt, closePersonalDebt } from "@/server/services/personal-debt-service";
import { invalidateOverviewStats } from "@/server/services/stats-service";
import { invalidateNamespace } from "@/server/redis/cache";
import { requirePermission } from "@/server/lib/auth-context";
import { toActionError, type ActionResult } from "@/server/lib/errors";

async function clearStatsCache() {
  await invalidateOverviewStats();
  await invalidateNamespace("persons:list");
}

export async function createInstallmentDebtAction(input: unknown): Promise<ActionResult<{ accountId: number; personId: number }>> {
  try {
    const auth = await requirePermission("debt:create");
    const accountId = await createInstallmentDebt(input as never, auth.ownerId);
    const personId = (input as { personId: number }).personId;
    await clearStatsCache();
    revalidatePath("/");
    revalidatePath("/loans");
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
    const auth = await requirePermission("debt:update");
    await updateBill(billId, patch, auth.ownerId);
    await clearStatsCache();
    revalidatePath(`/persons/${personId}`);
    revalidatePath("/");
    revalidatePath("/loans");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function deleteDebtAccountsAction(ids: number[], personId: number): Promise<ActionResult<null>> {
  try {
    const auth = await requirePermission("debt:delete");
    await deleteDebtAccounts(ids, auth.ownerId);
    await clearStatsCache();
    revalidatePath(`/persons/${personId}`);
    revalidatePath("/");
    revalidatePath("/loans");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function updateInstallmentAccountAction(
  accountId: number,
  personId: number,
  patch: { title?: string; source?: string; startDate?: string; note?: string; annualRateBps?: number | null },
): Promise<ActionResult<null>> {
  try {
    const auth = await requirePermission("debt:update");
    await updateInstallmentAccount(accountId, patch, auth.ownerId);
    await clearStatsCache();
    revalidatePath(`/persons/${personId}`);
    revalidatePath(`/loans/${accountId}`);
    revalidatePath("/");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function createPersonalDebtAction(input: unknown): Promise<ActionResult<{ accountId: number; personId: number }>> {
  try {
    const auth = await requirePermission("debt:create");
    const accountId = await createPersonalDebt(input as never, auth.ownerId);
    const personId = (input as { personId: number }).personId;
    await clearStatsCache();
    revalidatePath("/");
    revalidatePath("/loans");
    revalidatePath(`/persons/${personId}`);
    return { ok: true, data: { accountId, personId } };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function closePersonalDebtAction(accountId: number, personId: number): Promise<ActionResult<null>> {
  try {
    const auth = await requirePermission("debt:update");
    await closePersonalDebt(accountId, auth.ownerId);
    await clearStatsCache();
    revalidatePath(`/persons/${personId}`);
    revalidatePath("/");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}
