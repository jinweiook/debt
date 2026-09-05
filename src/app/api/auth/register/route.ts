import { NextRequest, NextResponse } from "next/server";
import { register } from "@/server/services/auth-service";
import { SESSION_COOKIE } from "@/lib/auth-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
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
    res.cookies.set(SESSION_COOKIE, result.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    return res;
  } catch (err) {
    console.error("[api/auth/register]", err);
    return NextResponse.json({ ok: false, message: "注册失败，请稍后重试" }, { status: 500 });
  }
}
