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
    }
  }
}
