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
 * Postgres 方言 schema（DB_DIALECT=postgres 时使用，供 Supabase 部署）。
 * 列定义必须与 schema.mysql.ts 保持同步（列名、语义一致）。
 *
 * 约定：
 * - 金额一律 BIGINT「分」，JS 侧以 number 处理（量级远小于 2^53）
 * - 利率用 INT「基点 bps」（万分之一，12% = 1200）
 * - 不建物理外键（便于迁移与批量恢复），一致性由 service 层事务 + UNIQUE 约束保证
 * - 身份相关 id 用 UUID 字符串，应用层 crypto.randomUUID() 预生成
 *
 * 多租户隔离由 service 层的 owner_user_id 过滤保证（admin 传 null 表示不过滤）。
 */

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
 * 业务侧用户表（自建认证）。
 * id 由应用层 crypto.randomUUID() 预生成；密码为 scrypt 哈希，登录失败锁定见 login_attempts。
 * token_version：改密/禁用时 +1，使旧会话 token 立即失效。
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    username: varchar("username", { length: 64 }).notNull(),
    displayName: varchar("display_name", { length: 64 }),
    phone: varchar("phone", { length: 32 }),
    note: varchar("note", { length: 512 }),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    // 冗余主角色编码（兼容字段），实际权限由 user_roles + role_permissions 决定
    role: varchar("role", { length: 16 }).notNull().default("user"),
    status: varchar("status", { length: 16 }).notNull().default("active"), // active / disabled
    lastLoginAt: timestamp("last_login_at", { mode: "date", precision: 3 }),
    tokenVersion: integer("token_version").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date", precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uk_users_username").on(t.username),
    index("idx_users_status").on(t.status),
  ],
);

/** RBAC 角色定义 */
export const roles = pgTable(
  "roles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    code: varchar("code", { length: 32 }).notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    description: varchar("description", { length: 255 }),
    // all = 查看并管理全部客户账单；self = 仅管理自己名下账单
    dataScope: varchar("data_scope", { length: 16 }).notNull().default("self"),
    isSystem: smallint("is_system").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date", precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", precision: 3 }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uk_roles_code").on(t.code)],
);

/** RBAC 角色权限映射 */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    roleId: bigint("role_id", { mode: "number" }).notNull(),
    permissionCode: varchar("permission_code", { length: 64 }).notNull(),
  },
  (t) => [
    uniqueIndex("uk_role_perm").on(t.roleId, t.permissionCode),
    index("idx_role_perm_role").on(t.roleId),
  ],
);

/** RBAC 用户角色关联 */
export const userRoles = pgTable(
  "user_roles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull(),
    roleId: bigint("role_id", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("uk_user_role").on(t.userId, t.roleId),
    index("idx_user_role_user").on(t.userId),
  ],
);

/**
 * 登录失败计数（数据库持久化，多实例共享）。
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
