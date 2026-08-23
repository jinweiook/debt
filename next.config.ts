import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["mysql2", "ioredis", "bcryptjs"],
};

export default nextConfig;
