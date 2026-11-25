import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { BackupPanel } from "@/components/features/backup/backup-panel";
import { getAuthContext, hasPerm } from "@/server/lib/auth-context";

export const dynamic = "force-dynamic";

export default async function BackupPage() {
  const auth = await getAuthContext();
  const canAccess =
    hasPerm(auth, "backup:export") ||
    hasPerm(auth, "backup:import") ||
    hasPerm(auth, "backup:export_sql") ||
    hasPerm(auth, "backup:clear_all");
  if (!canAccess) {
    redirect("/");
  }

  return (
    <AppShell>
      <PageHeader
        title="备份与数据"
        description={
          auth?.dataScope === "all"
            ? "整库 JSON 快照导入 / 导出，支持整库 SQL 导出"
            : "仅针对您当前账号名下的账单进行 JSON 快照导出与恢复"
        }
      />
      <BackupPanel />
    </AppShell>
  );
}
