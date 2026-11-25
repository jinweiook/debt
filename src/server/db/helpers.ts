/**
 * 方言差异收敛层：service 层只允许通过这里的 helper 使用方言相关的写法。
 * 内部按 DB_DIALECT 分支，pg 走 .returning()，mysql 走 .$returningId()。
 */
import { isMysql } from "./dialect";
import type { Db } from "./client";

// tx 与 db 在 drizzle 里方法集相同，helper 对两者都适用
type DbLike = Pick<Db, "insert">;

/**
 * 单行插入并返回自增主键 id。
 * 仅用于自增主键表（persons / debt_accounts / installment_bills / repayments / advances）；
 * users 表 id 由应用层 crypto.randomUUID() 预生成，不走这里。
 */
export async function insertAndGetId(
  db: DbLike,
  table: { id: unknown } & object,
  values: Record<string, unknown>,
): Promise<number> {
  if (isMysql()) {
    const [row] = await (db as any).insert(table).values(values).$returningId();
    return Number(row.id);
  }
  const [row] = await (db as any)
    .insert(table)
    .values(values)
    .returning({ id: (table as any).id });
  return Number(row.id);
}
