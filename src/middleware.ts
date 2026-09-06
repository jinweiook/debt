import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * 登录拦截 + Supabase 会话刷新（Edge Runtime，Next.js middleware 默认就是 edge）。
 *
 * - 会话刷新：每次请求都用 getUser() 向 Auth 服务器校验并续期 token，
 *   过期 token 会在这里被换成新 cookie，避免用户被莫名登出
 * - 路由保护：这里只做「有没有登录用户」的粗判断；
 *   角色与状态（admin/user、disabled）由 (protected)/layout.tsx 在 Node Runtime 精校验
 * - /api/health、/api/auth/* 保持公开，不参与刷新（登录接口自己会写 cookie）
 *
 * 注意：postgres-js 是 Node-only，不能在这里 import；
 * EdgeOne Pages 会自动把 middleware 编译到 edge function。
 */

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/api/health" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  const { user, response, applyCookies } = await updateSession(req);

  if (pathname.startsWith("/login") || pathname.startsWith("/register")) {
    // 已登录用户访问登录/注册页 → 直接回首页
    if (user) {
      return applyCookies(NextResponse.redirect(new URL("/", req.url)));
    }
    return response;
  }

  if (!user) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return applyCookies(NextResponse.redirect(url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
