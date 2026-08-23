import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { BackupPanel } from "@/components/features/backup/backup-panel";

export default function BackupPage() {
  return (
    <AppShell>
      <PageHeader title="备份与数据" description="JSON 快照导出 / 导入，换设备或防丢必备" />
      <BackupPanel />
    </AppShell>
  );
}
