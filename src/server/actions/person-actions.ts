"use server";

import { revalidatePath } from "next/cache";
import { personInputSchema, createPerson, updatePerson, archivePerson } from "@/server/services/person-service";
import { requireAuth } from "@/server/lib/auth-context";
import { toActionError, type ActionResult } from "@/server/lib/errors";

export async function createPersonAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const auth = await requireAuth();
    const parsed = personInputSchema.parse(input);
    // 新增欠款人归属到当前登录客户（管理员录入的数据归属管理员自己）
    const person = await createPerson(parsed, auth.userId);
    revalidatePath("/");
    return { ok: true, data: { id: person.id } };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function updatePersonAction(id: number, input: unknown): Promise<ActionResult<null>> {
  try {
    const auth = await requireAuth();
    const parsed = personInputSchema.parse(input);
    await updatePerson(id, parsed, auth.ownerId);
    revalidatePath("/");
    revalidatePath(`/persons/${id}`);
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function archivePersonAction(id: number): Promise<ActionResult<null>> {
  try {
    const auth = await requireAuth();
    await archivePerson(id, auth.ownerId);
    revalidatePath("/");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}
