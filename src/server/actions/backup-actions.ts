"use server";

import { revalidatePath } from "next/cache";
import { clearAllData, validateSnapshot, type Snapshot } from "@/server/services/backup-service";
import { toActionError, type ActionResult } from "@/server/lib/errors";

/** 导入前预检：返回快照概览供前端确认 */
export async function validateBackupAction(raw: unknown): Promise<
  ActionResult<{ persons: number; accounts: number; bills: number; repayments: number; advances: number; exportedAt: string }>
> {
  try {
    const s: Snapshot = validateSnapshot(raw);
    return {
      ok: true,
      data: {
        persons: s.persons.length,
        accounts: s.debtAccounts.length,
        bills: s.installmentBills.length,
        repayments: s.repayments.length,
        advances: s.advances.length,
        exportedAt: s.exportedAt,
      },
    };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function clearAllDataAction(confirmText: string): Promise<ActionResult<null>> {
  try {
    if (confirmText !== "确认清空") {
      return { ok: false, error: { code: "VALIDATION", message: "请输入「确认清空」以执行该危险操作" } };
    }
    await clearAllData();
    revalidatePath("/");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}
