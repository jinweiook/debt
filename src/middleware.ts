import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-cookie";

/**
 * 登录拦截（Edge Runtime 安全）：
 * - 只做「是否携带 session cookie」的粗判断，不触碰 MySQL（Edge 上无 Node 原生模块）
 * - 真正的 session 有效性校验由 (protected)/layout.tsx 在 Node Runtime 完成
 * - /api/health、/api/auth/* 保持公开
 */

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // 公开 API：健康检查、登录认证
  if (pathname === "/api/health" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  const hasSessionCookie = !!req.cookies.get(SESSION_COOKIE)?.value;

  if (pathname.startsWith("/login") || pathname.startsWith("/register")) {
    // 携带 cookie 时先放行到登录页，由页面层判断是否有效；无效仍停留在登录页
    if (hasSessionCookie) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  // 无 cookie 直接重定向；有 cookie 放行，交由 (protected)/layout 做真校验
  if (!hasSessionCookie) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
