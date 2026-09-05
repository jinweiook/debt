import { NextResponse } from "next/server";
import { login } from "@/server/services/auth-service";
import { createClient } from "@/lib/supabase/server";

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

    const supabase = await createClient();
    const result = await login(supabase, username, password);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, message: result.message, remainingSeconds: result.remainingSeconds },
        { status: result.locked ? 423 : 401 },
      );
    }

    // 会话 cookie 由 @supabase/ssr 的 cookie 适配器写入，这里不要再手动 set
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/auth/login]", err);
    return NextResponse.json(
      { ok: false, message: `登录失败：${err instanceof Error ? err.message : "请稍后重试"}` },
      { status: 500 },
    );
  }
}
