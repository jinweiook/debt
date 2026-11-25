import { redirect } from "next/navigation";
import { resolveSession } from "@/server/services/auth-service";
import { SessionProvider } from "@/components/layout/session";

/**
 * 受保护路由组的会话校验（Node Runtime）。
 * middleware 在 Edge 上只做「签名有效」的粗判断；这里查库精校验
 * users 档案（角色、状态、token_version）。未登录 / 账号被禁用 → 重定向到 /login。
 */
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await resolveSession();

  if (!session) {
    // 会话失效（改密后 token_version 变更 / 账号被禁用）时，必须先清掉旧 cookie，
    // 否则 middleware 仍认为「签名有效已登录」，会把 /login 又推回 /，形成死循环。
    redirect("/api/auth/logout?next=/login");
  }

  return (
    <SessionProvider
      user={{
        userId: session.userId,
        username: session.username,
        role: session.role,
        isAdmin: session.role === "admin",
      }}
    >
      {children}
    </SessionProvider>
  );
}
