import { NextResponse } from "next/server";
import { register } from "@/server/services/auth-service";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const username = String(body.username ?? "");
    const password = String(body.password ?? "");

    if (!username || !password) {
      return NextResponse.json({ ok: false, message: "账号和密码不能为空" }, { status: 400 });
    }

    const result = await register(username, password);
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions());
    return res;
  } catch (err) {
    console.error("[api/auth/register]", err);
    return NextResponse.json(
      { ok: false, message: `注册失败：${err instanceof Error ? err.message : "请稍后重试"}` },
      { status: 500 },
    );
  }
}
