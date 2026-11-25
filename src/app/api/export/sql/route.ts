import { NextResponse } from "next/server";
import { exportSqlDump } from "@/server/services/sql-export-service";
import { requirePermission } from "@/server/lib/auth-context";
import { ForbiddenError, UnauthorizedError } from "@/server/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 导出整库 SQL（建表结构 + 全部数据）。
 * 含 users 表密码哈希，仅具备 backup:export_sql 权限的管理员可用。
 */
export async function GET() {
  try {
    await requirePermission("backup:export_sql");
    const { filename, content } = await exportSqlDump();
    return new NextResponse(content, {
      headers: {
        "Content-Type": "application/sql; charset=utf-8",
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
