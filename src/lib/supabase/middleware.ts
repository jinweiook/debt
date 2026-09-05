import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export interface SessionRefreshResult {
  response: NextResponse;
  user: User | null;
  /** 把刷新后的 cookie 复制到另一个响应（重定向时需要） */
  applyCookies: <T extends NextResponse>(target: T) => T;
}

/**
 * 刷新 Supabase 会话，并把刷新后的 cookie 写回响应。
 *
 * 关键点：
 * 1. 必须用 getUser() 而不是 getSession()——只有 getUser() 会向 Auth 服务器校验并续期 token
 * 2. createServerClient 与 getUser 之间不要插入任何逻辑，否则刷新可能失效
 * 3. 后续若要返回别的响应（如 redirect），必须用 applyCookies 把 cookie 带过去
 */
export async function updateSession(request: NextRequest): Promise<SessionRefreshResult> {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    response: supabaseResponse,
    user,
    applyCookies: <T extends NextResponse>(target: T): T => {
      supabaseResponse.cookies.getAll().forEach((c) => target.cookies.set(c));
      return target;
    },
  };
}
