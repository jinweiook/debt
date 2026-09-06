# 借/还款规划

仅本人/小团队使用的借还款管理 Web 应用：按欠款人管理多笔借款、银行分期、还款、垫付与统计。
暗色科技感 UI · Next.js 15 App Router · Supabase（Auth + Postgres）。

## 功能

### 核心业务
- **欠款人管理**：姓名、备注、联系方式、默认还款日
- **银行分期**：按月账单记录，批量生成 + 逐期可编辑（应还本金/利息/到期日）
- **个人欠款**：直接借出/垫付/周转，支持无息、固定利息、年化利息（按月计提）
- **记还款**：先息后本自动拆分；超还自动溢出分配到下一笔债务（同一 batch 可追溯）
- **垫付**：某期未还时一键垫付，自动生成一笔垫付款个人欠款（幂等，一期只能垫一次）
- **统计**：总欠款、银行剩余待还、个欠剩余、累计已收、累计垫付、未来 12 月应收
- **备份**：JSON 快照导出/导入（zod 校验 + 事务恢复，失败整体回滚）

### 认证与多租户
- **Supabase Auth** 管理账号（自带邮箱+密码、token 刷新、会话安全）
- **三种登录方式**：默认 `admin` 账号、注册新账号（`/register`）、Supabase Auth 直签
- **3 次失败锁定**：自建 `login_attempts` 表，5 分钟内连续 3 次密码错误即锁
- **多租户数据隔离**：每个 `users` 记录下挂一份欠款人/账单/还款，业务表不冗余 ownerId，归属校验走 `assertPersonAccess()`
- **角色**：admin 看全部数据；普通用户只能看自己名下的欠款人

## 技术栈

- **前端**：Next.js 15 App Router · React 19 · TypeScript · Tailwind v4 暗色玻璃拟态
- **数据层**：Drizzle ORM（Postgres 方言）+ postgres-js + Supabase Postgres
- **认证**：Supabase Auth（`@supabase/ssr`）+ 自建 3 次失败锁定
- **部署**：EdgeOne Pages / Vercel / Netlify 任一支持 Next.js 全栈的边缘平台

## 快速开始（本地）

### 0. 准备 Supabase 项目
1. 打开 [Supabase Dashboard](https://supabase.com/dashboard) → New Project
2. **Project Settings → API** 复制 `URL` 和 `anon public` key
3. **Project Settings → API → service_role** 复制 `service_role` key（仅服务端用）
4. **Project Settings → Database** 重置数据库密码，**Connect → Transaction pooler** 复制连接串（含端口 6543）

### 1. 克隆 & 安装
```bash
git clone <your-repo>
cd debt
npm install
```

### 2. 配置环境变量
```bash
cp .env.example .env.local
```
把 `.env.local` 里的 4 个占位符换成自己的值：
- `NEXT_PUBLIC_SUPABASE_URL` → 步骤 0 的 URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` → 步骤 0 的 anon key
- `SUPABASE_SERVICE_ROLE_KEY` → 步骤 0 的 service_role key
- `DATABASE_URL` / `DIRECT_URL` → 步骤 0 的两个连接串（替换 `[YOUR-PASSWORD]` 和区域）

### 3. 建表 + 创建默认管理员
```bash
npm run db:migrate    # 执行 Drizzle 迁移 + 创建默认 admin 账号
```
默认账号是 `admin / 456123`，可在 `.env.local` 的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 覆盖。
改密码：`npm run db:set-admin-password 新密码`

### 4. 启动开发服务
```bash
npm run dev           # http://localhost:3000
```

### 5. （可选）造演示数据
```bash
npm run db:seed
npm run verify        # 跑业务全流程回归（断言还款拆分/超还溢出/垫付/计提/备份恢复）
```

## 部署

EdgeOne Pages、Vercel、Netlify 三选一，环境变量都是同一套（见 `.env.example`）。

### 通用前置（不管部署到哪都要做）
1. Supabase Dashboard 配好 → 拿到 4 个连接值
2. 本地先执行 `npm run db:migrate`（在 Supabase 上建表 + 创建 admin），EdgeOne/Vercel 构建时**不会**自动跑迁移

### EdgeOne Pages（推荐，国内访问快）
1. EdgeOne Pages 控制台 → 从 Git 导入项目
2. 构建命令：`npm run build` · 输出目录：`.next` · Node 版本：20
3. 把 `.env.local` 的 9 个变量填到「环境变量」
4. 部署成功后访问 `https://<your-domain>/login`，用 `admin / 456123` 登录

### Vercel
1. Vercel → Import Project
2. Build Command 默认即可
3. 把 9 个环境变量填到 Project Settings → Environment Variables
4. Deploy

## 常用脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run build` | 生产构建 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run db:migrate` | Drizzle 迁移 + 写入默认 admin |
| `npm run db:seed` | 写入演示数据 |
| `npm run db:reset` | 清空业务数据并重置序列（仅开发用） |
| `npm run db:set-admin-password <新密码>` | 重置默认管理员密码 |
| `npm run verify` | 业务全流程回归（29+ 项断言） |
| `npm run db:generate` | 改 schema 后重新生成 migration |

## 架构分层

```
src/
├── app/                          # 页面（RSC）+ Route Handlers
│   ├── (protected)/              # 需要登录的页面组（layout.tsx 校验 session + role）
│   ├── login/                    # 登录页
│   ├── register/                 # 注册页（注册即登录）
│   └── api/auth/                 # 登录/注册/登出 API（Node Runtime）
├── server/
│   ├── db/                       # Drizzle schema（pg-core）+ postgres-js 连接池
│   ├── services/                 # 领域服务：分期/个欠/还款拆分/垫付/统计/备份/认证
│   ├── actions/                  # Server Actions（表单提交→service→revalidate）
│   └── lib/                      # auth-context（session 解析）、money、errors
├── lib/supabase/                 # Supabase 客户端（server/client/middleware/admin）
└── components/                   # ui 基础组件 + features 业务组件（暗色玻璃拟态）
```

## 关键约定

- **金额**：一律 bigint「分」（保留 number 体验），前端不接触浮点
- **利率**：smallint「基点 bps」，100 bps = 1%
- **不建物理外键**：一致性靠 service 层事务 + UNIQUE 约束
- **多租户归属校验链**：账单 → 账户 → 欠款人（`assertPersonAccess`），越权一律返回 404
- **API routes 强制 Node Runtime**（postgres-js / Supabase Admin API 都不支持 Edge）
- **middleware 跑 Edge Runtime**：只做 cookie + `getUser()`，零 DB 调用