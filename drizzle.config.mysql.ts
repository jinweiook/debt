import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { defineConfig } from "drizzle-kit";

/** MySQL 方言（本地开发默认）：npm run db:generate:mysql */
export default defineConfig({
  dialect: "mysql",
  schema: "./src/server/db/schema.mysql.ts",
  out: "./drizzle/mysql",
  dbCredentials: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "debt",
  },
  verbose: true,
  strict: true,
});
