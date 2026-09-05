import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession } from "@/server/services/auth-service";
import { SESSION_COOKIE } from "@/lib/auth-cookie";
import { SessionProvider } from "@/components/layout/session";

/**
 * 受保护路由组的 session 校验（Node Runtime）。
 * middleware 在 Edge 上只做 cookie 存在性粗判断；这里才是真正的 session 校验（MySQL）。
 * 未登录 / session 失效 → 重定向到 /login。
 * 同时把登录客户信息注入 React Context，供 AppShell 等客户端组件展示。
 */
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);

  if (!session) {
    redirect("/login");
  }

  return (
    <SessionProvider
      user={{ userId: session.userId, username: session.username, role: session.role, isAdmin: session.role === "admin" }}
    >
      {children}
    </SessionProvider>
  );
}
