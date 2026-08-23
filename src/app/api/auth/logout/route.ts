import { NextRequest, NextResponse } from "next/server";
import { deleteSession } from "@/server/services/auth-service";
import { SESSION_COOKIE } from "@/lib/auth-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const sessionId = req.cookies.get(SESSION_COOKIE)?.value;
    await deleteSession(sessionId);

    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  } catch (err) {
    console.error("[api/auth/logout]", err);
    return NextResponse.json({ ok: false, message: "退出失败" }, { status: 500 });
  }
}
