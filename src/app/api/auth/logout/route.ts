import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  } catch (err) {
    console.error("[api/auth/logout]", err);
    return NextResponse.json({ ok: false, message: "退出失败" }, { status: 500 });
  }
}

/**
 * GET 用于「会话已失效」场景：Server Component 内不能写 cookie，
 * 因此 (protected)/layout.tsx 检测到 token_version 不匹配时跳到这里，
 * 先清掉浏览器里的过期 cookie，再落到登录页，避免与 middleware 互相重定向死循环。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const res = NextResponse.redirect(new URL(next, url.origin));
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

/** 只允许站内相对路径，防止开放重定向 */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/login";
  return value;
}
