import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { defineConfig } from "drizzle-kit";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

/** Postgres 方言（Supabase 部署）：npm run db:generate:pg */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.pg.ts",
  out: "./drizzle/pg",
  dbCredentials: {
    url: url ?? "",
  },
  // 迁移用直连（端口 5432）；事务池上跑 DDL 容易出问题
  verbose: true,
  strict: true,
});
