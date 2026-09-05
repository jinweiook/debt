import {
  bigint,
  char,
  date,
  datetime,
  int,
  mysqlTable,
  tinyint,
  uniqueIndex,
  index,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * 约定：
 * - 金额一律 BIGINT「分」，JS 侧以 number 处理（量级远小于 2^53）
 * - 利率用 INT「基点 bps」（万分之一，12% = 1200）
 * - 不建物理外键（TiDB 兼容性最稳妥），一致性由 service 层事务 + UNIQUE 约束保证
 */

export const persons = mysqlTable(
  "persons",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    // 归属客户（users.id）；数据隔离维度：客户只能看到自己名下欠款人的账单
    ownerUserId: bigint("owner_user_id", { mode: "number", unsigned: true }).notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    note: varchar("note", { length: 512 }),
    contact: varchar("contact", { length: 128 }),
    defaultRepayDay: tinyint("default_repay_day", { unsigned: true }),
    status: varchar("status", { length: 16 }).notNull().default("active"), // active / archived
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(new Date()),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(new Date()),
  },
  (t) => [index("idx_persons_owner").on(t.ownerUserId, t.status), index("idx_persons_status").on(t.status)],
);

export const debtAccounts = mysqlTable(
  "debt_accounts",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    personId: bigint("person_id", { mode: "number", unsigned: true }).notNull(),
    type: varchar("type", { length: 16 }).notNull(), // installment / personal
    title: varchar("title", { length: 128 }).notNull(),
    source: varchar("source", { length: 64 }), // 银行名称（分期用）
    principalCents: bigint("principal_cents", { mode: "number" }).notNull(),
    remainingPrincipalCents: bigint("remaining_principal_cents", { mode: "number" }).notNull(),
    interestType: varchar("interest_type", { length: 16 }).notNull().default("none"), // none / fixed / annual
    fixedInterestCents: bigint("fixed_interest_cents", { mode: "number" }),
    annualRateBps: int("annual_rate_bps"),
    // 分期账户专用：'fixed' = 每期利息手动录入/均分；'dynamic' = 按剩余本金 × 年化 ÷ 12 动态计算
    interestMode: varchar("interest_mode", { length: 16 }).notNull().default("fixed"), // fixed / dynamic
    // dynamic 模式下的还款方式：'equalPrincipal' 等额本金 / 'interestOnly' 先息后本 / 'equalPayment' 等额本息
    dynamicPlan: varchar("dynamic_plan", { length: 16 }), // 仅 dynamic 使用
    accruedInterestCents: bigint("accrued_interest_cents", { mode: "number" }).notNull().default(0),
    paidInterestCents: bigint("paid_interest_cents", { mode: "number" }).notNull().default(0),
    lastAccrualMonth: char("last_accrual_month", { length: 7 }), // 'YYYY-MM'
    startDate: date("start_date", { mode: "string" }).notNull(),
    termMonths: int("term_months"),
    status: varchar("status", { length: 16 }).notNull().default("open"), // open / settled / closed
    origin: varchar("origin", { length: 16 }).notNull().default("manual"), // manual / advance
    advanceId: bigint("advance_id", { mode: "number", unsigned: true }),
    note: varchar("note", { length: 512 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(new Date()),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(new Date()),
  },
  (t) => [
    index("idx_accounts_person").on(t.personId, t.type, t.status),
    index("idx_accounts_status").on(t.status),
  ],
);

export const installmentBills = mysqlTable(
  "installment_bills",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    accountId: bigint("account_id", { mode: "number", unsigned: true }).notNull(),
    periodNo: int("period_no").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    principalCents: bigint("principal_cents", { mode: "number" }).notNull(),
    interestCents: bigint("interest_cents", { mode: "number" }).notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(), // = principal + interest
    paidCents: bigint("paid_cents", { mode: "number" }).notNull().default(0),
    paidInterestCents: bigint("paid_interest_cents", { mode: "number" }).notNull().default(0),
    paidPrincipalCents: bigint("paid_principal_cents", { mode: "number" }).notNull().default(0),
    advanced: tinyint("advanced").notNull().default(0),
    advanceId: bigint("advance_id", { mode: "number", unsigned: true }),
    status: varchar("status", { length: 16 }).notNull().default("pending"), // pending / partial / paid / advanced
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
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    personId: bigint("person_id", { mode: "number", unsigned: true }).notNull(),
    targetType: varchar("target_type", { length: 16 }).notNull(), // bill / personal
    billId: bigint("bill_id", { mode: "number", unsigned: true }),
    accountId: bigint("account_id", { mode: "number", unsigned: true }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    interestPartCents: bigint("interest_part_cents", { mode: "number" }).notNull(),
    principalPartCents: bigint("principal_part_cents", { mode: "number" }).notNull(),
    batchId: char("batch_id", { length: 36 }), // 超还溢出时同批流水共享 UUID
    repaidAt: date("repaid_at", { mode: "string" }).notNull(),
    note: varchar("note", { length: 512 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(new Date()),
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
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    personId: bigint("person_id", { mode: "number", unsigned: true }).notNull(),
    billId: bigint("bill_id", { mode: "number", unsigned: true }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    advanceDate: date("advance_date", { mode: "string" }).notNull(),
    generatedAccountId: bigint("generated_account_id", { mode: "number", unsigned: true }).notNull(),
    note: varchar("note", { length: 512 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(new Date()),
  },
  (t) => [
    uniqueIndex("uk_advances_bill").on(t.billId), // 一期只能垫付一次（幂等）
    index("idx_adv_person").on(t.personId),
  ],
);

export const users = mysqlTable(
  "users",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    username: varchar("username", { length: 64 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    // admin = 管理员（可查看所有客户账单）；user = 注册客户（只能查看自己的账单）
    role: varchar("role", { length: 16 }).notNull().default("user"),
    status: varchar("status", { length: 16 }).notNull().default("active"), // active / disabled
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(new Date()),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(new Date()),
  },
  (t) => [uniqueIndex("uk_users_username").on(t.username), index("idx_users_status").on(t.status)],
);

export const sessions = mysqlTable(
  "sessions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(new Date()),
    expiresAt: datetime("expires_at", { mode: "date", fsp: 3 }).notNull(),
    lastSeenAt: datetime("last_seen_at", { mode: "date", fsp: 3 }).notNull().default(new Date()),
  },
  (t) => [
    index("idx_sessions_user").on(t.userId),
    index("idx_sessions_expires").on(t.expiresAt),
  ],
);

export const loginAttempts = mysqlTable(
  "login_attempts",
  {
    username: varchar("username", { length: 64 }).primaryKey(),
    failCount: int("fail_count").notNull().default(0),
    lockedUntil: datetime("locked_until", { mode: "date", fsp: 3 }),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).notNull().default(new Date()),
  },
);

export type Person = typeof persons.$inferSelect;
export type DebtAccount = typeof debtAccounts.$inferSelect;
export type InstallmentBill = typeof installmentBills.$inferSelect;
export type Repayment = typeof repayments.$inferSelect;
export type Advance = typeof advances.$inferSelect;
