"use server";

import { revalidatePath } from "next/cache";
import { personInputSchema, createPerson, updatePerson, archivePerson } from "@/server/services/person-service";
import { invalidateOverviewStats } from "@/server/services/stats-service";
import { invalidateCache } from "@/server/redis/cache";
import { toActionError, type ActionResult } from "@/server/lib/errors";

async function clearStatsCache() {
  await invalidateOverviewStats();
  await invalidateCache("persons:list", "all");
  await invalidateCache("persons:list", "active");
}

export async function createPersonAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  try {
    const parsed = personInputSchema.parse(input);
    const person = await createPerson(parsed);
    await clearStatsCache();
    revalidatePath("/");
    return { ok: true, data: { id: person.id } };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function updatePersonAction(id: number, input: unknown): Promise<ActionResult<null>> {
  try {
    const parsed = personInputSchema.parse(input);
    await updatePerson(id, parsed);
    await clearStatsCache();
    revalidatePath("/");
    revalidatePath(`/persons/${id}`);
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}

export async function archivePersonAction(id: number): Promise<ActionResult<null>> {
  try {
    await archivePerson(id);
    await clearStatsCache();
    revalidatePath("/");
    return { ok: true, data: null };
  } catch (err) {
    return { ok: false, error: toActionError(err) };
  }
}
