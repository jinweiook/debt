import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/server/services/auth-service";
import { SESSION_COOKIE } from "@/lib/auth-cookie";

export const runtime = "nodejs";

/**
 * 基于 Redis session 的登录拦截：
 * - 未登录访问受保护页面 → 重定向到 /login
 * - 已登录访问 /login → 回首页
 * - /api/health 保持公开，供部署平台探活
 */

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // 公开 API：健康检查、登录认证
  if (pathname === "/api/health" || pathname.startsWith("/api/auth/")) return NextResponse.next();

  const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSession(sessionId);
  const isAuthenticated = !!session;

  if (pathname.startsWith("/login")) {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  if (!isAuthenticated) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
