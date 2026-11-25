"use server";

import { revalidatePath } from "next/cache";
import { personInputSchema, createPerson, updatePerson, archivePerson } from "@/server/services/person-service";
import { deletePerson } from "@/server/services/deletion-service";
import { findUserById } from "@/server/services/auth-service";
import { hasPerm, requirePermission } from "@/server/lib/auth-context";
import { toActionError, ValidationError, type ActionResult } from "@/server/lib/errors";

export async function createPersonAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const auth = await requirePermission("person:create");
    const parsed = personInputSchema.parse(input);
    let targetOwnerId = auth.userId;

    if (parsed.ownerUserId && hasPerm(auth, "person:assign_owner")) {
      const targetUser = await findUserById(parsed.ownerUserId);
      if (!targetUser) throw new ValidationError("所选归属客户不存在");
      targetOwnerId = targetUser.id;
    }

    const person = await createPerson(parsed, targetOwnerId);
    revalidatePath("/");
    revalidatePath("/loans");
    revalidatePath("/admin/customers");
    return { ok: true, data: { id: person.id } };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function updatePersonAction(id: number, input: unknown): Promise<ActionResult<null>> {
  try {
    const auth = await requirePermission("person:update");
    const parsed = personInputSchema.parse(input);
    let newOwnerUserId: string | undefined;

    if (parsed.ownerUserId && hasPerm(auth, "person:assign_owner")) {
      const targetUser = await findUserById(parsed.ownerUserId);
      if (!targetUser) throw new ValidationError("所选归属客户不存在");
      newOwnerUserId = targetUser.id;
    }

    await updatePerson(id, parsed, auth.ownerId, newOwnerUserId);
    revalidatePath("/");
    revalidatePath("/loans");
    revalidatePath("/admin/customers");
    revalidatePath(`/persons/${id}`);
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function archivePersonAction(id: number): Promise<ActionResult<null>> {
  try {
    const auth = await requirePermission("person:update");
    await archivePerson(id, auth.ownerId);
    revalidatePath("/");
    revalidatePath("/admin/customers");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function deletePersonAction(id: number): Promise<ActionResult<null>> {
  try {
    const auth = await requirePermission("person:delete");
    await deletePerson(id, auth.ownerId);
    revalidatePath("/");
    revalidatePath("/loans");
    revalidatePath("/admin/customers");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}
