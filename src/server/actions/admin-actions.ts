"use server";

import { revalidatePath } from "next/cache";
import { resetUserPassword } from "@/server/services/auth-service";
import { requireAuth } from "@/server/lib/auth-context";
import { toActionError, type ActionResult } from "@/server/lib/errors";

/** 管理员重置客户密码（改哈希 + token_version+1 踢掉旧会话） */
export async function resetCustomerPasswordAction(
  targetUserId: string,
  newPassword: string,
): Promise<ActionResult<null>> {
  try {
    const auth = await requireAuth();
    if (!auth.isAdmin) {
      return { ok: false, error: { code: "FORBIDDEN", message: "仅管理员可重置密码" } };
    }
    await resetUserPassword(targetUserId, newPassword);
    revalidatePath("/admin/customers");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}
