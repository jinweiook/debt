# 借/还款规划

仅本人使用的借还款管理 Web 应用：按欠款人管理多笔借款、银行分期、还款、垫付与统计。
暗色科技感 UI · Next.js 全栈 · MySQL 协议数据库（TiDB Cloud Serverless / 本地 Docker MySQL）。

## 功能

- **欠款人管理**：姓名、备注、联系方式、默认还款日
- **银行分期**：按月账单记录，批量生成 + 逐期可编辑（应还本金/利息/到期日）
- **个人欠款**：直接借出/垫付/周转，支持无息、固定利息、年化利息（按月计提）
- **记还款**：先息后本自动拆分；超还自动溢出分配到下一笔债务（同一 batch 可追溯）
- **垫付**：某期未还时一键垫付，自动生成一笔垫付款个人欠款（幂等，一期只能垫一次）
- **统计**：总欠款、银行剩余待还、个欠剩余、累计已收、累计垫付、未来 12 月应收
- **备份**：JSON 快照导出/导入（zod 校验 + 事务恢复，失败整体回滚）
- **密码门**：`APP_PASSWORD` 环境变量控制的极简访问密码

## 快速开始（本地 Docker MySQL）

```bash
docker compose up -d          # 启动 MySQL 8（端口 3306）
cp .env.example .env.local    # 已包含本地默认值
npm install
npm run db:migrate            # 建表
npm run db:seed               # 可选：演示数据
npm run dev                   # http://localhost:3000
```

默认访问密码见 `.env.local` 的 `APP_PASSWORD`（本地默认 `change-me`，部署时务必修改）。

## 接入 TiDB Cloud Serverless（免费 25GB）

1. 到 https://tidbcloud.com 创建免费 Serverless 集群，创建数据库 `debt` 与账号
2. 修改 `.env.local`：

```bash
DB_HOST=xxxx.tidbcloud.com
DB_PORT=4000
DB_USER=xxxxx.root
DB_PASSWORD=你的密码
DB_NAME=debt
DB_SSL=true          # TiDB 必须开启 TLS
```

3. 重新执行 `npm run db:migrate && npm run dev` —— 代码零改动（标准 MySQL 协议）

> 也可切换到 Aiven Free MySQL（永久免费 1CPU/1GB/5GB）或任意 MySQL 8，只需改环境变量。

## 常用脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run build && npm start` | 生产构建与启动 |
| `npm run db:migrate` | 执行数据库 migration（scripts/init-db.ts） |
| `npm run db:seed` | 写入演示数据 |
| `npm run db:reset` | 清空数据并重置自增 ID（仅开发用） |
| `npm run verify` | 业务全流程回归（29 项断言：还款拆分/超还溢出/垫付/计提/备份恢复） |
| `npm run db:generate` | 修改 schema 后重新生成 migration |

## 架构分层

```
src/
├── app/                  # 页面（RSC）+ Route Handlers（/api/health|export|import）
├── server/
│   ├── db/               # Drizzle schema + mysql2 连接池单例（globalThis 防连接爆炸）
│   ├── services/         # 领域服务：分期/个欠/利息懒计提/还款拆分/垫付/统计/备份
│   ├── actions/          # Server Actions 薄壳（校验→service→revalidatePath）
│   └── lib/              # money（分⇄元、bps 利率）、dates、errors
├── components/           # ui 基础组件 + features 业务组件（暗色玻璃拟态）
└── lib/repayment-split.ts# 先息后本拆分纯函数（前后端共享）
```

关键约定：金额一律 BIGINT「分」、利率 INT「基点」、不建物理外键（TiDB 兼容）、一致性靠 service 层事务 + UNIQUE 约束。
