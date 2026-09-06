import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // EdgeOne Pages 原生支持 next/image 优化，无需关闭
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
