import { Suspense } from "react";
import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { PersonalDebtForm } from "@/components/features/personal/personal-debt-form";
import { listPersons } from "@/server/services/person-service";
import { getAuthContext, hasPerm } from "@/server/lib/auth-context";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { formatUserDisplayName } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function NewPersonalDebtPage() {
  const auth = await getAuthContext();
  if (!hasPerm(auth, "debt:create")) {
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
      <PageHeader title="新增个人欠款" description="直接借出、垫付款、临时周转等，支持无息 / 固定利息 / 年化利息" back="/" />
      <Suspense>
        <PersonalDebtForm persons={persons} ownerLabels={ownerLabels} />
      </Suspense>
    </AppShell>
  );
}
