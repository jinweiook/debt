import { Suspense } from "react";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { PersonalDebtForm } from "@/components/features/personal/personal-debt-form";
import { listPersons } from "@/server/services/person-service";

export const dynamic = "force-dynamic";

export default async function NewPersonalDebtPage() {
  const persons = await listPersons();
  return (
    <AppShell>
      <PageHeader title="新增个人欠款" description="直接借出、垫付款、临时周转等，支持无息 / 固定利息 / 年化利息" back="/" />
      <Suspense>
        <PersonalDebtForm persons={persons} />
      </Suspense>
    </AppShell>
  );
}
