# 双数据库（MySQL/Postgres 可配置）+ 自建认证 + 人员/借还款管理增强 实施计划

## Context

项目当前使用 Supabase（Postgres + Supabase Auth）。用户要求：
1. **双数据库支持**：本地开发走 MySQL（127.0.0.1:3306/debt, root/123456, utf8mb4，库中暂无表需初始化），同时保留 Postgres 能力（供 Supabase 部署），通过 `DB_DIALECT=mysql|postgres` 环境变量切换，方言差异全部隔离在 db 层
2. 欠款人管理：新增/编辑/删除（删除级联全部数据）
3. 借还款删除与批量删除：删还款回滚抵扣金额；分期可整批删除、编辑分期信息（允许改表结构）
4. 自建认证替代 Supabase Auth（两套数据库下都不依赖 Supabase Auth）：保留多用户，users 表加密码哈希、最后登录时间；管理员客户页支持改密码、显示最后登录

已确认决策：保留多用户、删还款回滚抵扣、删除全级联、双库配置切换。

## 一、数据库层（双方言架构）

- **双 schema**：新建 `src/server/db/schema.mysql.ts`（mysql-core）与 `src/server/db/schema.pg.ts`（pg-core，基于现 schema.ts 演进），列名/类型语义完全对齐；`src/server/db/schema.ts` 改为运行时按 `DB_DIALECT` re-export 其中一套（service 层 import 路径不变）
  - mysql 侧：`bigint(mode:"number").autoincrement()`、`varchar(36)` 替代 uuid、`datetime(fsp:3)`（不用 timestamp 类型避免时区转换）
  - pg 侧：维持 bigserial/uuid/timestamp，同步新增字段
  - users 表（两套同步）：删除 email 列，新增 `password_hash varchar(255)`、`last_login_at 可空`、`token_version int default 0`（改密/禁用后吊销旧会话）
- **方言差异收敛到 db 层 helpers**（`src/server/db/helpers.ts` 新建）：
  - `insertAndGetId(table, values)`：pg 走 `.returning({id})`，mysql 走 `.$returningId()`，内部按方言分支，对 service 暴露统一签名（替换现有约 6 处 `.returning()` 调用）
  - `upsertByKey(...)`：封装 pg `onConflictDoUpdate` / mysql `onDuplicateKeyUpdate` 差异（仅 auth-service 的 login_attempts、users 使用）；或改为"先查后插/改"消除方言 API
  - users.id 两套统一改为应用层 `crypto.randomUUID()` 预生成（mysql varchar(36)，pg uuid）
- `src/server/db/client.ts` 重写：按 `DB_DIALECT` 创建 postgres-js 连接（现有逻辑保留）或 `mysql2/promise` 连接池（`dateStrings: true` 防日期漂移）；统一导出 `getDb()/getSql?/pingDb()/resetDb()/closeDb()`，保留 globalThis 单例 + 自愈结构；`Db` 类型定义为两方 dialect 的联合类型，service 层使用的 select/insert/update/delete/transaction 为公共子集
- **双 drizzle 配置**：`drizzle.config.pg.ts`（out `./drizzle/pg`）+ `drizzle.config.mysql.ts`（out `./drizzle/mysql`）；package.json 增加 `db:generate:pg` / `db:generate:mysql`；删除旧 `./drizzle` 目录，两套各自 generate
- 环境变量：`DB_DIALECT=mysql|postgres`；mysql 用 `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD/DB_CHARSET`；postgres 用 `DATABASE_URL`（+可选 `DIRECT_URL` 迁移用）；公共 `AUTH_SECRET`、`ADMIN_USERNAME/ADMIN_PASSWORD`；`.env.example` 重写，本地新建 `.env`（默认 mysql）
- `scripts/init-db.ts`：按方言分支——mysql 先 `CREATE DATABASE IF NOT EXISTS debt ... utf8mb4` 再 mysql migrator；pg 走 postgres migrator（DIRECT_URL）；最后统一 seed 默认 admin（scrypt 哈希写 users，不再依赖 Supabase）
- `scripts/set-admin-password.ts` 改为更新 password_hash + token_version+1（经 drizzle 写，方言无关）；`reset.ts/seed.ts/verify.ts` 检查裸 SQL 方言兼容性
- 依赖：移除 `@supabase/ssr`、`@supabase/supabase-js`（Auth 不再用），保留 `postgres`，新增 `mysql2`

## 二、自建认证（替代 Supabase Auth）

- 密码哈希：Node `crypto.scrypt`（零新依赖），格式 `scrypt:<salt>:<hash>`，`timingSafeEqual` 校验，仅 Node runtime
- 新建 `src/lib/session-token.ts`：`base64url(JSON{uid,exp,tv}) + "." + HMAC-SHA256(payload, AUTH_SECRET)`，只用 `globalThis.crypto.subtle`（Edge/Node 通用，不 import node:*）
- Cookie：复用 `SESSION_COOKIE="debt_session"`，HttpOnly/SameSite=Lax，7 天
- `src/middleware.ts`：删 updateSession，内联纯签名校验（Edge 不查库）
- `src/server/services/auth-service.ts` 重写：login（锁检查→scrypt 校验→写 last_login_at→返回 token）、register（插 users+token）、resolveSession（验 token + status + token_version）、logout（清 cookie）、seedDefaultAdmin（本地化）、新增 `resetUserPassword(adminId, targetUserId, newPwd)`（改 hash + token_version+1）
- `src/server/lib/auth-context.ts`：改从 cookie resolveSession，对外 AuthContext 接口不变，service 层零感知
- 3 个 auth API 路由改为 `res.cookies.set()`；`(protected)/layout.tsx` 用新 resolveSession
- 删除 `src/lib/supabase/` 目录、`src/lib/auth-token.ts`
- `src/instrumentation.ts`：`57014` 换 MySQL 错误码 `PROTOCOL_CONNECTION_LOST`

## 三、删除/编辑服务（全部单事务 + 归属校验）

- `deletePerson(personId, ownerId)`：按 backup-service 逆序级联 advances → repayments → installmentBills → debtAccounts → persons
- `deleteDebtAccounts(ids[], ownerId)`：分期账户先处理垫付生成的个欠（advances.generatedAccountId 引用），再删 repayments → advances → 个欠 → bills → account；`origin=advance` 个欠删除时同事务回写源账单 `{advanced:0, advanceId:null, status 重算}`
- `deleteRepayments(ids[], ownerId)` 回滚核心：按 target 分组累计后一次性落库——bill 类减 paidInterest/paidPrincipal、重算 status（advanced 保持）；personal 类加回 remaining/accrued、减 paidInterest、status 复活 open；dynamic 账户调 `recomputeDynamicBills`，fixed 按既有公式重算；最后删流水
- `updateInstallmentAccount(accountId, patch, ownerId)`：title/source/startDate/note 随时可改；annualRateBps 仅 dynamic 且无已还/垫付账单时可改，改后重算
- 所有删除/编辑路径清 `persons:list` + `stats` 两个缓存命名空间

## 四、UI 改造（server action + client 组件模式不变）

- 新增 actions：`deletePersonAction`、`deleteDebtAccountsAction(ids)`、`updateInstallmentAccountAction`、`deleteRepaymentsAction(ids)`、`admin-actions.ts/resetCustomerPasswordAction`
- 新增 `components/ui/checkbox.tsx`、`confirm-dialog.tsx`（基于现有 dialog）
- `person-card.tsx`：加编辑（复用 PersonForm 扩展 edit 模式）/删除按钮；首页及 `persons/[id]` 页头加编辑/删除欠款人
- `persons/[id]/page.tsx`：还款流水表抽成客户端 `RepaymentTable`（checkbox 多选 + 批量/单行删除）；分期卡片加"编辑分期/整批删除"，新建 `installment-edit-dialog.tsx`
- `loans/page.tsx`：列表抽成客户端 `LoansTable`（checkbox 批量删除）；`loans/[id]/page.tsx` 加删除入口
- `admin/customers/page.tsx`：加"最后登录"列 + 每行 `ResetPasswordDialog`

## 五、实施顺序

1. 依赖更换 → 2. 双 schema + helpers → 3. client.ts（双方言）→ 4. 双 drizzle 配置 + 删旧 drizzle + 两套生成迁移 → 5. 脚本（init-db/set-admin-password 等）→ 6. 认证全套 → 7. 删除/编辑 service + actions → 8. UI → 9. 验证

## 六、验证

- `npm run typecheck` → `npm run build`
- MySQL 主线：`DB_DIALECT=mysql` + `npm run db:migrate`（自动建库建表 + admin）→ 手动清单：admin 登录/锁定 → 注册新客户 → 新增欠款人/分期(dynamic)/个欠 → 记还款（超还溢出）→ 垫付 → 删单笔还款看回滚 → 批量删同人同账单多笔 → 整批删分期（含垫付联动）→ 删欠款人 → 管理员改密后旧会话失效 → 备份导出/导入
- Postgres 副线：`DB_DIALECT=postgres` + 指向原 Supabase 库 `db:migrate`（users 表结构变更走迁移）→ 冒烟：登录、新增欠款人、记还款、删还款回滚，确认两套方言行为一致

## 风险点

- R1 `$returningId()` 仅 mysql 自增主键表可用，pg 用 `.returning()`——统一走 helpers.insertAndGetId，service 不直接碰方言 API
- R2 双 schema 列定义必须人工保持同步（加字段时两边都改），typecheck 只能保证本地方言
- R3 mysql2 必须 `dateStrings:true`，DATETIME 不用 timestamp 类型
- R4 Edge Runtime 不能 import mysql2/postgres；session-token 纯 Web Crypto
- R5 先还后垫付的账单删还款时只减金额、保持 advanced；删垫付个欠必须回写源账单
- R6 token_version 实现改密/禁用后吊销会话
- R8 所有写路径同步清 persons:list + stats 缓存
- R9 批量删还款必须先累计减法、后统一重算，避免中间态覆盖
