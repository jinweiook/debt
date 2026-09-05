import { Suspense } from "react";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { RepaymentForm } from "@/components/features/repayment/repayment-form";
import { listPersons } from "@/server/services/person-service";
import { getAuthContext } from "@/server/lib/auth-context";

export const dynamic = "force-dynamic";

export default async function NewRepaymentPage() {
  const auth = await getAuthContext();
  const persons = await listPersons(auth?.ownerId ?? null);
  return (
    <AppShell>
      <PageHeader title="记一笔还款" description="选择归还对象，系统按「先利息后本金」自动拆分" back="/" />
      <Suspense>
        <RepaymentForm persons={persons} />
      </Suspense>
    </AppShell>
  );
}
