import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { persons } from "@/server/db/schema";
import { NotFoundError } from "@/server/lib/errors";
import { getOrSet, invalidateCache, invalidateNamespace } from "@/server/redis/cache";

export const personInputSchema = z.object({
  name: z.string().trim().min(1, "姓名不能为空").max(64),
  note: z.string().trim().max(512).optional().or(z.literal("")),
  contact: z.string().trim().max(128).optional().or(z.literal("")),
  defaultRepayDay: z.number().int().min(1).max(31).nullable().optional(),
});
export type PersonInput = z.infer<typeof personInputSchema>;

const CACHE_TTL = 60; // 秒

export async function listPersons(includeArchived = false) {
  const cacheKey = includeArchived ? "all" : "active";
  return getOrSet(
    "persons:list",
    cacheKey,
    async () => {
      const db = getDb();
      const rows = await db.select().from(persons).orderBy(desc(persons.createdAt));
      return includeArchived ? rows : rows.filter((p) => p.status === "active");
    },
    { ttlSeconds: CACHE_TTL },
  );
}

export async function getPerson(id: number) {
  const db = getDb();
  const [row] = await db.select().from(persons).where(eq(persons.id, id)).limit(1);
  if (!row) throw new NotFoundError("欠款人不存在");
  return row;
}

export async function createPerson(input: PersonInput) {
  const db = getDb();
  const [r] = await db.insert(persons).values({
    name: input.name,
    note: input.note || null,
    contact: input.contact || null,
    defaultRepayDay: input.defaultRepayDay ?? null,
  });
  await invalidatePersonsCache();
  return getPerson(Number(r.insertId));
}

export async function updatePerson(id: number, input: PersonInput) {
  const db = getDb();
  await getPerson(id);
  await db
    .update(persons)
    .set({
      name: input.name,
      note: input.note || null,
      contact: input.contact || null,
      defaultRepayDay: input.defaultRepayDay ?? null,
      updatedAt: new Date(),
    })
    .where(eq(persons.id, id));
  await invalidatePersonsCache();
  return getPerson(id);
}

export async function archivePerson(id: number) {
  const db = getDb();
  await getPerson(id);
  await db.update(persons).set({ status: "archived", updatedAt: new Date() }).where(eq(persons.id, id));
  await invalidatePersonsCache();
}

async function invalidatePersonsCache() {
  await invalidateNamespace("persons:list");
  await invalidateCache("stats", "overview");
}
