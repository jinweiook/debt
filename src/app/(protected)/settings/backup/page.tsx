import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { BackupPanel } from "@/components/features/backup/backup-panel";

export default function BackupPage() {
  return (
    <AppShell>
      <PageHeader title="备份与数据" description="JSON 快照导入 / 导出，管理员可导出整库 SQL" />
      <BackupPanel />
    </AppShell>
  );
}
