export async function register() {
  // 仅在 Node.js runtime（服务端）启动时执行
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { pingDb } = await import("@/server/db/client");
      const latency = await pingDb();
      console.log(`[db] 启动健康检查通过，延迟 ${latency}ms`);
    } catch (err) {
      // 不阻断进程：让页面层给出友好错误提示而非白屏
      console.error("[db] 启动健康检查失败：", err);
      if (isIpv6Unreachable(err)) {
        console.error(
          "[db] 这是 IPv6 不可达导致的连接失败。请检查：\n" +
            "  1. DATABASE_URL 必须用 Supabase 的 Transaction pooler（端口 6543），不要用 Direct connection（端口 5432）\n" +
            "  2. Supabase Dashboard → Connect → Transaction pooler 复制连接串，把 [YOUR-PASSWORD] 换成数据库密码\n" +
            "  3. 改完环境变量后必须重新部署才会生效",
        );
      }
    }
  }
}

/** 识别 serverless 环境下典型的 IPv6 出站失败 */
function isIpv6Unreachable(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const cause = (err as { cause?: { code?: string } })?.cause?.code;
  return code === "ENETUNREACH" || cause === "ENETUNREACH";
}
