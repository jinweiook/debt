import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { MoneyText } from "@/components/ui/money-text";
import { StatCards } from "@/components/features/overview/stat-cards";
import { MonthlyForecastChart } from "@/components/features/overview/monthly-forecast";
import { BillTable } from "@/components/features/installment/bill-table";
import { InstallmentAccountActions } from "@/components/features/installment/installment-account-actions";
import { InterestBadge } from "@/components/features/personal/interest-badge";
import { CloseDebtButton } from "@/components/features/personal/close-debt-button";
import { DeleteDebtButton } from "@/components/features/personal/delete-debt-button";
import { PersonActions } from "@/components/features/person/person-actions";
import { RepaymentTable, type RepaymentRow } from "@/components/features/repayment/repayment-table";
import { getPerson } from "@/server/services/person-service";
import { personStats, monthlyForecast } from "@/server/services/stats-service";
import { virtualAccruedInterest } from "@/server/services/interest-service";
import { listRepaymentsByPerson } from "@/server/services/repayment-service";
import { getAuthContext, hasPerm } from "@/server/lib/auth-context";
import { getDb } from "@/server/db/client";
import { debtAccounts, installmentBills, users } from "@/server/db/schema";
import { asc, eq } from "drizzle-orm";
import { formatCents } from "@/lib/utils";
import { formatUserDisplayName } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function PersonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const personId = Number(id);
  if (!Number.isInteger(personId) || personId <= 0) notFound();

  const auth = await getAuthContext();
  if (!auth) notFound();
  if (!hasPerm(auth, "person:read")) {
    redirect("/");
  }

  let person;
  try {
    person = await getPerson(personId, auth.ownerId);
  } catch {
    notFound();
  }

  const db = getDb();
  const canAssignOwner = hasPerm(auth, "person:assign_owner");
  const canCreateDebt = hasPerm(auth, "debt:create");
  const canUpdateDebt = hasPerm(auth, "debt:update");
  const canDeleteDebt = hasPerm(auth, "debt:delete");
  const canCreateRepay = hasPerm(auth, "repayment:create");

  const [stats, forecast, repayments, accounts, ownerRows] = await Promise.all([
    personStats(personId),
    monthlyForecast(personId, 12),
    listRepaymentsByPerson(personId),
    db.select().from(debtAccounts).where(eq(debtAccounts.personId, personId)).orderBy(asc(debtAccounts.id)),
    auth.dataScope === "all" || canAssignOwner
      ? db
          .select({ id: users.id, username: users.username, displayName: users.displayName })
          .from(users)
          .orderBy(asc(users.createdAt))
      : Promise.resolve([]),
  ]);

  const ownerUser = ownerRows.find((u) => u.id === person.ownerUserId);

  const installmentAccounts = accounts.filter((a) => a.type === "installment");
  const personalAccounts = accounts.filter((a) => a.type === "personal");
  const billsByAccount = new Map<number, (typeof installmentBills.$inferSelect)[]>();
  for (const acc of installmentAccounts) {
    const bills = await db
      .select()
      .from(installmentBills)
      .where(eq(installmentBills.accountId, acc.id))
      .orderBy(asc(installmentBills.periodNo));
    billsByAccount.set(acc.id, bills);
  }

  const statusLabel = (s: string) =>
    s === "open" ? (
      <Badge tone="accent">进行中</Badge>
    ) : s === "settled" ? (
      <Badge tone="success">已结清</Badge>
    ) : (
      <Badge tone="dim">已关闭</Badge>
    );

  return (
    <AppShell>
      <PageHeader
        title={person.name}
        description={[person.contact, person.note].filter(Boolean).join(" · ") || undefined}
        back={auth.dataScope === "all" ? `/?customerId=${person.ownerUserId}` : "/"}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {auth.dataScope === "all" && ownerUser && (
              <Link href={`/?customerId=${ownerUser.id}`}>
                <Badge tone="purple" className="cursor-pointer hover:opacity-80">
                  归属客户：{formatUserDisplayName(ownerUser)}
                </Badge>
              </Link>
            )}
            <PersonActions
              person={{
                id: person.id,
                name: person.name,
                contact: person.contact,
                note: person.note,
                defaultRepayDay: person.defaultRepayDay,
                ownerUserId: person.ownerUserId,
              }}
              customers={canAssignOwner ? ownerRows : undefined}
              redirectAfterDelete="/"
            />
            {canCreateRepay && (
              <Link href={`/repayments/new?personId=${personId}`}>
                <Button>记一笔还款</Button>
              </Link>
            )}
          </div>
        }
      />

      <div className="space-y-4 md:space-y-6">
        {canCreateDebt && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Link href={`/debts/installment/new?personId=${personId}`}>
              <Button variant="secondary" size="sm">+ 新增分期</Button>
            </Link>
            <Link href={`/debts/personal/new?personId=${personId}`}>
              <Button variant="secondary" size="sm">+ 新增个人欠款</Button>
            </Link>
          </div>
        )}

        <StatCards stats={stats} />

        <Tabs
          tabs={[
            {
              value: "installment",
              label: `银行分期 (${installmentAccounts.length})`,
              content: (
                <div className="space-y-4">
                  {installmentAccounts.length === 0 && (
                    <Card className="py-10 text-center text-text-dim text-sm">暂无分期记录</Card>
                  )}
                  {installmentAccounts.map((acc) => (
                    <Card key={acc.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                        <div className="flex items-center gap-3">
                          <CardTitle>{acc.title}</CardTitle>
                          {acc.source && <Badge tone="accent">{acc.source}</Badge>}
                          {statusLabel(acc.status)}
                        </div>
                        <div className="flex items-center gap-3">
                          <p className="text-sm text-text-dim tnum">
                            共 {acc.termMonths} 期 · 本金 ¥{formatCents(acc.principalCents)}
                          </p>
                          <InstallmentAccountActions
                            account={{
                              id: acc.id,
                              title: acc.title,
                              source: acc.source,
                              startDate: acc.startDate,
                              note: acc.note,
                              interestMode: acc.interestMode,
                              annualRateBps: acc.annualRateBps,
                              termMonths: acc.termMonths,
                            }}
                            personId={personId}
                          />
                        </div>
                      </div>
                      <BillTable account={acc} bills={billsByAccount.get(acc.id) ?? []} personId={personId} />
                    </Card>
                  ))}
                </div>
              ),
            },
            {
              value: "personal",
              label: `个人欠款 (${personalAccounts.length})`,
              content: (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {personalAccounts.length === 0 && (
                    <Card className="py-10 text-center text-text-dim text-sm lg:col-span-2">暂无个人欠款</Card>
                  )}
                  {personalAccounts.map((acc) => {
                    const interest = virtualAccruedInterest(acc);
                    const remaining = acc.remainingPrincipalCents + interest;
                    return (
                      <Card key={acc.id} hover>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <CardTitle>{acc.title}</CardTitle>
                            <InterestBadge account={acc} />
                            {acc.origin === "advance" && <Badge tone="warning">垫付生成</Badge>}
                            {statusLabel(acc.status)}
                          </div>
                        </div>
                        <div className="mt-4 flex items-end justify-between gap-3">
                          <div>
                            <p className="text-xs text-text-dim">剩余应还（本金+利息）</p>
                            <MoneyText cents={acc.status === "open" ? remaining : 0} gradient className="text-2xl" />
                            <p className="mt-1 text-xs text-text-dim tnum">
                              本金 ¥{formatCents(acc.remainingPrincipalCents)}
                              {interest > 0 && <> · 利息 ¥{formatCents(interest)}</>}
                              {" · "}借出 {acc.startDate}
                            </p>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            {acc.status === "open" && (
                              <>
                                {canCreateRepay && (
                                  <Link href={`/repayments/new?personId=${personId}&targetType=personal&targetId=${acc.id}`}>
                                    <Button size="sm">记还款</Button>
                                  </Link>
                                )}
                                {canUpdateDebt && <CloseDebtButton accountId={acc.id} personId={personId} />}
                              </>
                            )}
                            {canDeleteDebt && (
                              <DeleteDebtButton
                                accountId={acc.id}
                                personId={personId}
                                title={acc.title}
                                isAdvanceGenerated={acc.origin === "advance"}
                              />
                            )}
                          </div>
                        </div>
                        {acc.note && <p className="mt-3 text-xs text-text-dim/80 border-t border-border pt-3">{acc.note}</p>}
                      </Card>
                    );
                  })}
                </div>
              ),
            },
            {
              value: "repayments",
              label: `还款流水 (${repayments.length})`,
              content: (
                <Card>
                  <RepaymentTable
                    personId={personId}
                    rows={repayments.map(
                      (r): RepaymentRow => ({
                        id: r.id,
                        repaidAt: r.repaidAt,
                        targetLabel: repaymentTargetLabel(r.targetType, r.billId, r.accountId, billsByAccount, accounts),
                        hasBatch: r.batchId != null,
                        amountCents: r.amountCents,
                        interestPartCents: r.interestPartCents,
                        principalPartCents: r.principalPartCents,
                        note: r.note,
                      }),
                    )}
                  />
                </Card>
              ),
            },
            {
              value: "forecast",
              label: "未来计划",
              content: <MonthlyForecastChart data={forecast} />,
            },
          ]}
        />
      </div>
    </AppShell>
  );
}

function repaymentTargetLabel(
  targetType: string,
  billId: number | null,
  accountId: number | null,
  billsByAccount: Map<number, { id: number; periodNo: number; accountId: number }[]>,
  accounts: { id: number; title: string }[],
): string {
  if (targetType === "bill" && billId != null) {
    for (const bills of billsByAccount.values()) {
      const bill = bills.find((b) => b.id === billId);
      if (bill) {
        const acc = accounts.find((a) => a.id === bill.accountId);
        return `${acc?.title ?? "分期"} · 第${bill.periodNo}期`;
      }
    }
    return "分期账单";
  }
  const acc = accounts.find((a) => a.id === accountId);
  return acc?.title ?? "个人欠款";
}
