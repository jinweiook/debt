import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 自托管/容器化部署使用 Next.js standalone 产物（含运行时依赖，体积最小）
  output: "standalone",
  // EdgeOne Pages 原生支持 next/image 优化，无需关闭
  serverExternalPackages: ["postgres"],
  // SQL 导出（postgres 方言）需要在运行时读取迁移文件，确保 standalone 产物包含它们
  outputFileTracingIncludes: {
    "/api/export/sql": ["./drizzle/pg/**/*.sql"],
  },
};

export default nextConfig;
