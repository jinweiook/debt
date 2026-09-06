/**
 * 启动钩子。
 *
 * 注意：instrumentation.ts 会被 Next.js 同时编译进 Node 与 Edge bundle，
 * 所以这里**不能 import 任何 Node-only 模块**（postgres / node:net / node:tls 等），
 * 否则 Edge 打包阶段直接报 Module not found。
 * 需要用到数据库能力时，一律通过全局标记让 db client 自己去处理。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    installGlobalGuards();
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __debtNeedsDbReset: boolean | undefined;
}

/**
 * serverless 兜底：postgres-js 在僵死连接上产生的 rejection 可能逃逸出业务 try/catch。
 * Node 15+ 默认遇到 unhandledRejection 会终止进程，在 EdgeOne Pages / Vercel 上
 * 表现为实例被反复回收、页面随机 500。这里统一接住，
 * 并打一个标记让 db client 下次取连接时重建（避免在这里 import 数据库模块）。
 */
function installGlobalGuards(): void {
  if ((globalThis as { __debtGuardsInstalled?: boolean }).__debtGuardsInstalled) return;
  (globalThis as { __debtGuardsInstalled?: boolean }).__debtGuardsInstalled = true;

  process.on("unhandledRejection", (reason) => {
    console.error("[runtime] unhandledRejection（已捕获，避免进程被回收）：", reason);
    const code = (reason as { code?: string })?.code;
    if (code === "57014" || code === "ENETUNREACH") {
      globalThis.__debtNeedsDbReset = true;
    }
  });
}
