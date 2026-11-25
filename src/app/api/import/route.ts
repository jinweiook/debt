import { NextResponse } from "next/server";
import { importSnapshot, validateSnapshot } from "@/server/services/backup-service";
import { requirePermission } from "@/server/lib/auth-context";
import { ForbiddenError, UnauthorizedError } from "@/server/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const auth = await requirePermission("backup:import");
    const raw = await req.json();
    const snapshot = validateSnapshot(raw);
    await importSnapshot(snapshot, auth.ownerId);
    return NextResponse.json({
      ok: true,
      data: {
        persons: snapshot.persons.length,
        accounts: snapshot.debtAccounts.length,
        bills: snapshot.installmentBills.length,
        repayments: snapshot.repayments.length,
        advances: snapshot.advances.length,
      },
    });
  } catch (err) {
    const status = err instanceof UnauthorizedError ? 401 : err instanceof ForbiddenError ? 403 : 400;
    const message = err instanceof Error ? err.message : "导入失败";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
