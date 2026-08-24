import { Suspense } from "react";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { InstallmentForm } from "@/components/features/installment/installment-form";
import { listPersons } from "@/server/services/person-service";

export const dynamic = "force-dynamic";

export default async function NewInstallmentPage() {
  const persons = await listPersons();
  return (
    <AppShell>
      <PageHeader title="新增银行分期" description="录入银行与总额，批量生成每月账单后可逐期调整" back="/" />
      <Suspense>
        <InstallmentForm persons={persons} />
      </Suspense>
    </AppShell>
  );
}
