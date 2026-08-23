import { NextResponse } from "next/server";
import { exportSnapshot } from "@/server/services/backup-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await exportSnapshot();
    const filename = `debt-backup-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(snapshot, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "导出失败" },
      { status: 500 },
    );
  }
}
