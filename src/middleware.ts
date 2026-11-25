import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-cookie";
import { verifySessionToken } from "@/lib/session-token";

/**
 * 登录拦截（Edge Runtime）。
 *
 * - 只做「cookie 签名是否有效 + 未过期」的粗判断，不查库
 *   （角色、账号状态、token_version 由 (protected)/layout.tsx 在 Node Runtime 精校验）
 * - /api/health、/api/auth/* 保持公开
 *
 * 注意：Edge Runtime 不能 import mysql2/postgres 等 Node-only 模块，
 * session-token 只用 Web Crypto，可安全运行。
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/api/health" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  const payload = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const loggedIn = payload !== null;

  if (pathname.startsWith("/login") || pathname.startsWith("/register")) {
    // 已登录用户访问登录/注册页 → 直接回首页
    if (loggedIn) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  if (!loggedIn) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
