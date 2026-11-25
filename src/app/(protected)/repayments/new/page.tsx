import { Suspense } from "react";
import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { RepaymentForm } from "@/components/features/repayment/repayment-form";
import { listPersons } from "@/server/services/person-service";
import { getAuthContext, hasPerm } from "@/server/lib/auth-context";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { formatUserDisplayName } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function NewRepaymentPage() {
  const auth = await getAuthContext();
  if (!hasPerm(auth, "repayment:create")) {
    redirect("/");
  }

  const persons = await listPersons(auth?.ownerId ?? null);
  let ownerLabels: Record<string, string> | undefined;
  if (auth?.dataScope === "all") {
    const db = getDb();
    const userRows = await db
      .select({ id: users.id, username: users.username, displayName: users.displayName })
      .from(users)
      .orderBy(asc(users.createdAt));
    ownerLabels = Object.fromEntries(userRows.map((u) => [u.id, formatUserDisplayName(u)]));
  }

  return (
    <AppShell>
      <PageHeader title="记一笔还款" description="选择归还对象，系统按「先利息后本金」自动拆分" back="/" />
      <Suspense>
        <RepaymentForm persons={persons} ownerLabels={ownerLabels} />
      </Suspense>
    </AppShell>
  );
}
