import { NextResponse } from "next/server";
import { pingDb } from "@/server/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const latencyMs = await pingDb();
    return NextResponse.json({ ok: true, latencyMs });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "数据库连接失败" },
      { status: 503 },
    );
  }
}
