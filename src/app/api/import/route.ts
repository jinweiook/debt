import { NextResponse } from "next/server";
import { importSnapshot, validateSnapshot } from "@/server/services/backup-service";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const snapshot = validateSnapshot(raw);
    await importSnapshot(snapshot);
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
    const message = err instanceof Error ? err.message : "导入失败";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
