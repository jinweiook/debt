import { NextResponse } from "next/server";
import { exportSnapshot } from "@/server/services/backup-service";
import { requirePermission } from "@/server/lib/auth-context";
import { ForbiddenError, UnauthorizedError } from "@/server/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const auth = await requirePermission("backup:export");
    const snapshot = await exportSnapshot(auth.ownerId);
    const filename = `debt-backup-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(snapshot, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const status = err instanceof UnauthorizedError ? 401 : err instanceof ForbiddenError ? 403 : 500;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "导出失败" },
      { status },
    );
  }
}
