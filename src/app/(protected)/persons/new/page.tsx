import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { PersonForm } from "@/components/features/person/person-form";
import { getAuthContext, hasPerm } from "@/server/lib/auth-context";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";

export const dynamic = "force-dynamic";

export default async function NewPersonPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const auth = await getAuthContext();
  if (!hasPerm(auth, "person:create")) {
    redirect("/");
  }

  const { customerId } = await searchParams;
  const canAssignOwner = hasPerm(auth, "person:assign_owner");

  let customers: { id: string; username: string; displayName: string | null }[] | undefined;
  let defaultOwnerId = auth!.userId;

  if (canAssignOwner) {
    const db = getDb();
    const userRows = await db
      .select({ id: users.id, username: users.username, displayName: users.displayName })
      .from(users)
      .orderBy(asc(users.createdAt));
    customers = userRows;
    if (customerId && userRows.some((u) => u.id === customerId)) {
      defaultOwnerId = customerId;
    }
  }

  return (
    <AppShell>
      <PageHeader title="新增欠款人" back={customerId ? `/?customerId=${customerId}` : "/"} />
      <PersonForm customers={customers} defaultOwnerId={defaultOwnerId} />
    </AppShell>
  );
}
