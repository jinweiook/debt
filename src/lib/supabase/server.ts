import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/**
 * 服务端 Supabase 客户端（Server Component / Route Handler / Server Action）。
 *
 * cookie 适配器会把 Supabase 的会话 token 写进 Next 的 cookie store：
 * - Route Handler / Server Action：可写，登录、登出直接生效
 * - Server Component：不可写，抛错被 catch，由 middleware 负责刷新会话
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Component 中无法写 cookie，忽略即可（middleware 会刷新）
        }
      },
    },
  });
}
