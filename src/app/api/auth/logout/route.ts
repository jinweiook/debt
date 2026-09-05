import { NextResponse } from "next/server";
import { logout } from "@/server/services/auth-service";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const supabase = await createClient();
    await logout(supabase);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/auth/logout]", err);
    return NextResponse.json({ ok: false, message: "退出失败" }, { status: 500 });
  }
}
