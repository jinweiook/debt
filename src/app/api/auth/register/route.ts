import { NextResponse } from "next/server";
import { register } from "@/server/services/auth-service";
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
    const result = await register(supabase, username, password);
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/auth/register]", err);
    return NextResponse.json(
      { ok: false, message: `注册失败：${err instanceof Error ? err.message : "请稍后重试"}` },
      { status: 500 },
    );
  }
}
