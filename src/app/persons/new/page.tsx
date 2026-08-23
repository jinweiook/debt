import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { PersonForm } from "@/components/features/person/person-form";

export default function NewPersonPage() {
  return (
    <AppShell>
      <PageHeader title="新增欠款人" back="/" />
      <PersonForm />
    </AppShell>
  );
}
