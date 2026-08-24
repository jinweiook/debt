import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession } from "@/server/services/auth-service";
import { SESSION_COOKIE } from "@/lib/auth-cookie";

export const LAYOUT_MARKER = "layout-marker-12345";

/**
 * 受保护路由组的 session 校验（Node Runtime）。
 * middleware 在 Edge 上只做 cookie 存在性粗判断；这里才是真正的 Redis session 校验。
 * 未登录 / session 失效 → 重定向到 /login。
 */
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);

  if (!session) {
    redirect("/login");
  }

  return <>{children}</>;
}
