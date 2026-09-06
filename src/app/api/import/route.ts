import { NextResponse } from "next/server";
import { importSnapshot, validateSnapshot } from "@/server/services/backup-service";
import { requireAuth } from "@/server/lib/auth-context";
import { UnauthorizedError } from "@/server/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const auth = await requireAuth();
    const raw = await req.json();
    const snapshot = validateSnapshot(raw);
    // 普通客户只替换自己名下数据；管理员整库替换
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
    const status = err instanceof UnauthorizedError ? 401 : 400;
    const message = err instanceof Error ? err.message : "导入失败";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
