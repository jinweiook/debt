"use server";

import { revalidatePath } from "next/cache";
import {
  createUserByAdmin,
  resetUserPassword,
  updateUserByAdmin,
} from "@/server/services/auth-service";
import { createRole, deleteRole, updateRole } from "@/server/services/rbac-service";
import { invalidateOverviewStats } from "@/server/services/stats-service";
import { invalidateNamespace } from "@/server/redis/cache";
import { requirePermission } from "@/server/lib/auth-context";
import { toActionError, type ActionResult } from "@/server/lib/errors";

async function clearCustomerCaches() {
  await invalidateOverviewStats();
  await invalidateNamespace("persons:list");
}

/** 新增用户（需 user:create 权限） */
export async function createCustomerAction(input: unknown): Promise<ActionResult<{ id: string; username: string }>> {
  try {
    await requirePermission("user:create");
    const created = await createUserByAdmin(input);
    await clearCustomerCaches();
    revalidatePath("/admin/customers");
    revalidatePath("/admin/roles");
    revalidatePath("/");
    revalidatePath("/loans");
    return { ok: true, data: created };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

/** 编辑用户（需 user:update 权限） */
export async function updateCustomerAction(
  targetUserId: string,
  input: unknown,
): Promise<ActionResult<null>> {
  try {
    const auth = await requirePermission("user:update");
    await updateUserByAdmin(targetUserId, input, auth.userId);
    await clearCustomerCaches();
    revalidatePath("/admin/customers");
    revalidatePath("/admin/roles");
    revalidatePath("/");
    revalidatePath("/loans");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

/** 重置用户密码（需 user:reset_password 权限，改哈希 + token_version+1 踢掉旧会话） */
export async function resetCustomerPasswordAction(
  targetUserId: string,
  newPassword: string,
): Promise<ActionResult<null>> {
  try {
    await requirePermission("user:reset_password");
    await resetUserPassword(targetUserId, newPassword);
    revalidatePath("/admin/customers");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

/** 新增 RBAC 角色（需 role:manage 权限） */
export async function createRoleAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    await requirePermission("role:manage");
    const id = await createRole(input);
    revalidatePath("/admin/roles");
    revalidatePath("/admin/customers");
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

/** 更新 RBAC 角色与权限（需 role:manage 权限） */
export async function updateRoleAction(roleId: number, input: unknown): Promise<ActionResult<null>> {
  try {
    await requirePermission("role:manage");
    await updateRole(roleId, input);
    revalidatePath("/admin/roles");
    revalidatePath("/admin/customers");
    revalidatePath("/");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

/** 删除 RBAC 自定义角色（需 role:manage 权限） */
export async function deleteRoleAction(roleId: number): Promise<ActionResult<null>> {
  try {
    await requirePermission("role:manage");
    await deleteRole(roleId);
    revalidatePath("/admin/roles");
    revalidatePath("/admin/customers");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}
