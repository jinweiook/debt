import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  date,
  datetime,
  index,
  int,
  mysqlTable,
  smallint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * MySQL 方言 schema（DB_DIALECT=mysql 时使用，本地开发默认）。
 * 列定义必须与 schema.pg.ts 保持同步（列名、语义一致）。
 *
 * 与 pg 版的差异：
 * - bigserial → bigint autoincrement
 * - uuid → varchar(36)
 * - timestamp → datetime(fsp:3)（不用 MySQL TIMESTAMP 类型，避免时区转换与 ON UPDATE 副作用）
 * - integer → int
 */

export const persons = mysqlTable(
  "persons",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    ownerUserId: varchar("owner_user_id", { length: 36 }).notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    note: varchar("note", { length: 512 }),
    contact: varchar("contact", { length: 128 }),
    defaultRepayDay: smallint("default_repay_day"),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [index("idx_persons_owner").on(t.ownerUserId, t.status), index("idx_persons_status").on(t.status)],
);

export const debtAccounts = mysqlTable(
  "debt_accounts",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    personId: bigint("person_id", { mode: "number" }).notNull(),
    type: varchar("type", { length: 16 }).notNull(),
    title: varchar("title", { length: 128 }).notNull(),
    source: varchar("source", { length: 64 }),
    principalCents: bigint("principal_cents", { mode: "number" }).notNull(),
    remainingPrincipalCents: bigint("remaining_principal_cents", { mode: "number" }).notNull(),
    interestType: varchar("interest_type", { length: 16 }).notNull().default("none"),
    fixedInterestCents: bigint("fixed_interest_cents", { mode: "number" }),
    annualRateBps: int("annual_rate_bps"),
    interestMode: varchar("interest_mode", { length: 16 }).notNull().default("fixed"),
    dynamicPlan: varchar("dynamic_plan", { length: 16 }),
    accruedInterestCents: bigint("accrued_interest_cents", { mode: "number" }).notNull().default(0),
    paidInterestCents: bigint("paid_interest_cents", { mode: "number" }).notNull().default(0),
    lastAccrualMonth: char("last_accrual_month", { length: 7 }),
    startDate: date("start_date", { mode: "string" }).notNull(),
    termMonths: int("term_months"),
    status: varchar("status", { length: 16 }).notNull().default("open"),
    origin: varchar("origin", { length: 16 }).notNull().default("manual"),
    advanceId: bigint("advance_id", { mode: "number" }),
    note: varchar("note", { length: 512 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    index("idx_accounts_person").on(t.personId, t.type, t.status),
    index("idx_accounts_status").on(t.status),
  ],
);

export const installmentBills = mysqlTable(
  "installment_bills",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    accountId: bigint("account_id", { mode: "number" }).notNull(),
    periodNo: int("period_no").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    principalCents: bigint("principal_cents", { mode: "number" }).notNull(),
    interestCents: bigint("interest_cents", { mode: "number" }).notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    paidCents: bigint("paid_cents", { mode: "number" }).notNull().default(0),
    paidInterestCents: bigint("paid_interest_cents", { mode: "number" }).notNull().default(0),
    paidPrincipalCents: bigint("paid_principal_cents", { mode: "number" }).notNull().default(0),
    advanced: smallint("advanced").notNull().default(0),
    advanceId: bigint("advance_id", { mode: "number" }),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    note: varchar("note", { length: 512 }),
  },
  (t) => [
    uniqueIndex("uk_bill_account_period").on(t.accountId, t.periodNo),
    index("idx_bills_due").on(t.dueDate, t.status),
  ],
);

export const repayments = mysqlTable(
  "repayments",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    personId: bigint("person_id", { mode: "number" }).notNull(),
    targetType: varchar("target_type", { length: 16 }).notNull(),
    billId: bigint("bill_id", { mode: "number" }),
    accountId: bigint("account_id", { mode: "number" }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    interestPartCents: bigint("interest_part_cents", { mode: "number" }).notNull(),
    principalPartCents: bigint("principal_part_cents", { mode: "number" }).notNull(),
    batchId: char("batch_id", { length: 36 }),
    repaidAt: date("repaid_at", { mode: "string" }).notNull(),
    note: varchar("note", { length: 512 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    index("idx_rep_person").on(t.personId, t.repaidAt),
    index("idx_rep_bill").on(t.billId),
    index("idx_rep_account").on(t.accountId),
  ],
);

export const advances = mysqlTable(
  "advances",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    personId: bigint("person_id", { mode: "number" }).notNull(),
    billId: bigint("bill_id", { mode: "number" }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    advanceDate: date("advance_date", { mode: "string" }).notNull(),
    generatedAccountId: bigint("generated_account_id", { mode: "number" }).notNull(),
    note: varchar("note", { length: 512 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex("uk_advances_bill").on(t.billId),
    index("idx_adv_person").on(t.personId),
  ],
);

export const users = mysqlTable(
  "users",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    username: varchar("username", { length: 64 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    role: varchar("role", { length: 16 }).notNull().default("user"),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    lastLoginAt: datetime("last_login_at", { mode: "date", fsp: 3 }),
    tokenVersion: int("token_version").notNull().default(0),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex("uk_users_username").on(t.username),
    index("idx_users_status").on(t.status),
  ],
);

export const loginAttempts = mysqlTable(
  "login_attempts",
  {
    username: varchar("username", { length: 64 }).primaryKey(),
    failCount: int("fail_count").notNull().default(0),
    lockedUntil: datetime("locked_until", { mode: "date", fsp: 3 }),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
);
