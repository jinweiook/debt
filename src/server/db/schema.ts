import {
  bigint,
  bigserial,
  char,
  date,
  index,
  integer,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * 约定：
 * - 金额一律 BIGINT「分」，JS 侧以 number 处理（量级远小于 2^53）
 * - 利率用 INT「基点 bps」（万分之一，12% = 1200）
 * - 不建物理外键（便于迁移与批量恢复），一致性由 service 层事务 + UNIQUE 约束保证
 * - 身份相关 id 用 UUID，与 Supabase auth.users.id 对齐
 *
 * 关于 RLS：本应用的数据访问走 Drizzle + 直连 Postgres，不经过 PostgREST，
 * 因此 auth.uid() 取不到 JWT claims，RLS 不会生效。多租户隔离仍由 service 层的
 * owner_user_id 过滤保证（admin 传 null 表示不过滤）。
 */

/**
 * 归属维度类型：普通客户 = 自己的 users.id（UUID）；管理员 = null（不过滤，看全部）
 */
export type OwnerId = string | null;

export const persons = pgTable(
  "persons",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    // 归属客户（users.id，UUID）；数据隔离维度：客户只能看到自己名下欠款人的账单
    ownerUserId: uuid("owner_user_id").notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    note: varchar("note", { length: 512 }),
    contact: varchar("contact", { length: 128 }),
    defaultRepayDay: smallint("default_repay_day"),
    status: varchar("status", { length: 16 }).notNull().default("active"), // active / archived
    createdAt: timestamp("created_at", { mode: "date", precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", precision: 3 }).notNull().defaultNow(),
  },
  (t) => [index("idx_persons_owner").on(t.ownerUserId, t.status), index("idx_persons_status").on(t.status)],
);

export const debtAccounts = pgTable(
  "debt_accounts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    personId: bigint("person_id", { mode: "number" }).notNull(),
    type: varchar("type", { length: 16 }).notNull(), // installment / personal
    title: varchar("title", { length: 128 }).notNull(),
    source: varchar("source", { length: 64 }), // 银行名称（分期用）
    principalCents: bigint("principal_cents", { mode: "number" }).notNull(),
    remainingPrincipalCents: bigint("remaining_principal_cents", { mode: "number" }).notNull(),
    interestType: varchar("interest_type", { length: 16 }).notNull().default("none"), // none / fixed / annual
    fixedInterestCents: bigint("fixed_interest_cents", { mode: "number" }),
    annualRateBps: integer("annual_rate_bps"),
    // 分期账户专用：'fixed' = 每期利息手动录入/均分；'dynamic' = 按剩余本金 × 年化 ÷ 12 动态计算
    interestMode: varchar("interest_mode", { length: 16 }).notNull().default("fixed"), // fixed / dynamic
    // dynamic 模式下的还款方式：'equalPrincipal' 等额本金 / 'interestOnly' 先息后本 / 'equalPayment' 等额本息
    dynamicPlan: varchar("dynamic_plan", { length: 16 }), // 仅 dynamic 使用
    accruedInterestCents: bigint("accrued_interest_cents", { mode: "number" }).notNull().default(0),
    paidInterestCents: bigint("paid_interest_cents", { mode: "number" }).notNull().default(0),
    lastAccrualMonth: char("last_accrual_month", { length: 7 }), // 'YYYY-MM'
    startDate: date("start_date", { mode: "string" }).notNull(),
    termMonths: integer("term_months"),
    status: varchar("status", { length: 16 }).notNull().default("open"), // open / settled / closed
    origin: varchar("origin", { length: 16 }).notNull().default("manual"), // manual / advance
    advanceId: bigint("advance_id", { mode: "number" }),
    note: varchar("note", { length: 512 }),
    createdAt: timestamp("created_at", { mode: "date", precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_accounts_person").on(t.personId, t.type, t.status),
    index("idx_accounts_status").on(t.status),
  ],
);

export const installmentBills = pgTable(
  "installment_bills",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    accountId: bigint("account_id", { mode: "number" }).notNull(),
    periodNo: integer("period_no").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    principalCents: bigint("principal_cents", { mode: "number" }).notNull(),
    interestCents: bigint("interest_cents", { mode: "number" }).notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(), // = principal + interest
    paidCents: bigint("paid_cents", { mode: "number" }).notNull().default(0),
    paidInterestCents: bigint("paid_interest_cents", { mode: "number" }).notNull().default(0),
    paidPrincipalCents: bigint("paid_principal_cents", { mode: "number" }).notNull().default(0),
    advanced: smallint("advanced").notNull().default(0),
    advanceId: bigint("advance_id", { mode: "number" }),
    status: varchar("status", { length: 16 }).notNull().default("pending"), // pending / partial / paid / advanced
    note: varchar("note", { length: 512 }),
  },
  (t) => [
    uniqueIndex("uk_bill_account_period").on(t.accountId, t.periodNo),
    index("idx_bills_due").on(t.dueDate, t.status),
  ],
);

export const repayments = pgTable(
  "repayments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    personId: bigint("person_id", { mode: "number" }).notNull(),
    targetType: varchar("target_type", { length: 16 }).notNull(), // bill / personal
    billId: bigint("bill_id", { mode: "number" }),
    accountId: bigint("account_id", { mode: "number" }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    interestPartCents: bigint("interest_part_cents", { mode: "number" }).notNull(),
    principalPartCents: bigint("principal_part_cents", { mode: "number" }).notNull(),
    batchId: char("batch_id", { length: 36 }), // 超还溢出时同批流水共享 UUID
    repaidAt: date("repaid_at", { mode: "string" }).notNull(),
    note: varchar("note", { length: 512 }),
    createdAt: timestamp("created_at", { mode: "date", precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_rep_person").on(t.personId, t.repaidAt),
    index("idx_rep_bill").on(t.billId),
    index("idx_rep_account").on(t.accountId),
  ],
);

export const advances = pgTable(
  "advances",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    personId: bigint("person_id", { mode: "number" }).notNull(),
    billId: bigint("bill_id", { mode: "number" }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    advanceDate: date("advance_date", { mode: "string" }).notNull(),
    generatedAccountId: bigint("generated_account_id", { mode: "number" }).notNull(),
    note: varchar("note", { length: 512 }),
    createdAt: timestamp("created_at", { mode: "date", precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uk_advances_bill").on(t.billId), // 一期只能垫付一次（幂等）
    index("idx_adv_person").on(t.personId),
  ],
);

/**
 * 业务侧用户档案表。id 与 Supabase auth.users.id 一一对应（UUID）。
 * 密码、会话、邮箱验证全部由 Supabase Auth 托管，这里只存应用需要的角色与状态。
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    username: varchar("username", { length: 64 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    // admin = 管理员（可查看所有客户账单）；user = 注册客户（只能查看自己的账单）
    role: varchar("role", { length: 16 }).notNull().default("user"),
    status: varchar("status", { length: 16 }).notNull().default("active"), // active / disabled
    createdAt: timestamp("created_at", { mode: "date", precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uk_users_username").on(t.username),
    uniqueIndex("uk_users_email").on(t.email),
    index("idx_users_status").on(t.status),
  ],
);

/**
 * 登录失败计数（自建，Supabase Auth 不提供失败锁定）。
 * 达到 MAX_LOGIN_ATTEMPTS 后写入 locked_until 锁定一段时间。
 */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    username: varchar("username", { length: 64 }).primaryKey(),
    failCount: integer("fail_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { mode: "date", precision: 3 }),
    updatedAt: timestamp("updated_at", { mode: "date", precision: 3 }).notNull().defaultNow(),
  },
);

export type Person = typeof persons.$inferSelect;
export type DebtAccount = typeof debtAccounts.$inferSelect;
export type InstallmentBill = typeof installmentBills.$inferSelect;
export type Repayment = typeof repayments.$inferSelect;
export type Advance = typeof advances.$inferSelect;
export type User = typeof users.$inferSelect;
