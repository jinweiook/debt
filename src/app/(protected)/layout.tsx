import { redirect } from "next/navigation";
import { resolveSession } from "@/server/services/auth-service";
import { createClient } from "@/lib/supabase/server";
import { SessionProvider } from "@/components/layout/session";

/**
 * 受保护路由组的会话校验（Node Runtime）。
 * middleware 在 Edge 上只做「有没有登录用户」的粗判断；这里用 Supabase 的
 * getUser() 精校验，并读取业务侧 users 档案（角色、状态、username）。
 * 未登录 / 账号被禁用 → 重定向到 /login。
 */
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const session = await resolveSession(supabase);

  if (!session) {
    redirect("/login");
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
