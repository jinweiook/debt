import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // EdgeOne Pages 不识别 standalone，删除后用默认输出（.next/）
  // output: "standalone",
  serverExternalPackages: ["postgres"],
  // EdgeOne Pages 没有内置 next/image 优化（Vercel 才有），关闭避免运行时 400
  images: {
    unoptimized: true,
  },
};

export default nextConfig;