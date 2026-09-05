import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { persons, type OwnerId } from "@/server/db/schema";
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

/** 缓存作用域：admin 为 null → "admin"；普通客户 → "u{userId}" */
export function ownerScope(ownerId: OwnerId): string {
  return ownerId == null ? "admin" : `u${ownerId}`;
}

/**
 * 按归属列出欠款人。
 * @param ownerId 客户 id（UUID）；null = 管理员，列出全部
 */
export async function listPersons(ownerId: OwnerId, includeArchived = false) {
  const cacheKey = `${ownerScope(ownerId)}:${includeArchived ? "all" : "active"}`;
  return getOrSet(
    "persons:list",
    cacheKey,
    async () => {
      const db = getDb();
      const where = ownerId == null ? undefined : eq(persons.ownerUserId, ownerId);
      const rows = await db
        .select()
        .from(persons)
        .where(where)
        .orderBy(desc(persons.createdAt));
      return includeArchived ? rows : rows.filter((p) => p.status === "active");
    },
    { ttlSeconds: CACHE_TTL },
  );
}

/**
 * 按 id 获取欠款人，并校验归属：
 * - 普通客户只能访问自己名下的欠款人，否则视为不存在（避免枚举探测）
 * - 管理员（ownerId=null）可访问任意欠款人
 */
export async function getPerson(id: number, ownerId: OwnerId) {
  const db = getDb();
  const [row] = await db.select().from(persons).where(eq(persons.id, id)).limit(1);
  if (!row) throw new NotFoundError("欠款人不存在");
  if (ownerId != null && row.ownerUserId !== ownerId) throw new NotFoundError("欠款人不存在");
  return row;
}

export async function createPerson(input: PersonInput, ownerId: string) {
  const db = getDb();
  const [row] = await db
    .insert(persons)
    .values({
      ownerUserId: ownerId,
      name: input.name,
      note: input.note || null,
      contact: input.contact || null,
      defaultRepayDay: input.defaultRepayDay ?? null,
    })
    .returning({ id: persons.id });
  await invalidatePersonsCache();
  return getPerson(row.id, null);
}

export async function updatePerson(id: number, input: PersonInput, ownerId: OwnerId) {
  const db = getDb();
  await getPerson(id, ownerId);
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
  return getPerson(id, ownerId);
}

export async function archivePerson(id: number, ownerId: OwnerId) {
  const db = getDb();
  await getPerson(id, ownerId);
  await db.update(persons).set({ status: "archived", updatedAt: new Date() }).where(eq(persons.id, id));
  await invalidatePersonsCache();
}

export async function invalidatePersonsCache() {
  await invalidateNamespace("persons:list");
  await invalidateNamespace("stats");
}
