import { defineConfig } from "drizzle-kit";

const useSsl = process.env.DB_SSL === "true";

export default defineConfig({
  dialect: "mysql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "dev123",
    database: process.env.DB_NAME ?? "debt",
    ...(useSsl ? { ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true } as never } : {}),
  },
});
