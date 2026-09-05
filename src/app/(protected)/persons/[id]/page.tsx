import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { MoneyText } from "@/components/ui/money-text";
import { StatCards } from "@/components/features/overview/stat-cards";
import { MonthlyForecastChart } from "@/components/features/overview/monthly-forecast";
import { BillTable } from "@/components/features/installment/bill-table";
import { InterestBadge } from "@/components/features/personal/interest-badge";
import { CloseDebtButton } from "@/components/features/personal/close-debt-button";
import { getPerson } from "@/server/services/person-service";
import { personStats, monthlyForecast } from "@/server/services/stats-service";
import { virtualAccruedInterest } from "@/server/services/interest-service";
import { listRepaymentsByPerson } from "@/server/services/repayment-service";
import { getAuthContext } from "@/server/lib/auth-context";
import { getDb } from "@/server/db/client";
import { debtAccounts, installmentBills } from "@/server/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { formatCents } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PersonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const personId = Number(id);
  if (!Number.isInteger(personId) || personId <= 0) notFound();

  // 归属校验：普通客户访问他人欠款人 → 404；管理员可查看任意客户的账单
  const auth = await getAuthContext();
  if (!auth) notFound();

  let person;
  try {
    person = await getPerson(personId, auth.ownerId);
  } catch {
    notFound();
  }

  const db = getDb();
  const [stats, forecast, repayments, accounts] = await Promise.all([
    personStats(personId),
    monthlyForecast(personId, 12),
    listRepaymentsByPerson(personId),
    db.select().from(debtAccounts).where(eq(debtAccounts.personId, personId)).orderBy(asc(debtAccounts.id)),
  ]);

  const installmentAccounts = accounts.filter((a) => a.type === "installment");
  const personalAccounts = accounts.filter((a) => a.type === "personal");
  const billsByAccount = new Map<number, typeof installmentBills.$inferSelect[]>();
  for (const acc of installmentAccounts) {
    const bills = await db
      .select()
      .from(installmentBills)
      .where(eq(installmentBills.accountId, acc.id))
      .orderBy(asc(installmentBills.periodNo));
    billsByAccount.set(acc.id, bills);
  }

  const statusLabel = (s: string) =>
    s === "open" ? <Badge tone="accent">进行中</Badge> : s === "settled" ? <Badge tone="success">已结清</Badge> : <Badge tone="dim">已关闭</Badge>;

  return (
    <AppShell>
      <PageHeader
        title={person.name}
        description={[person.contact, person.note].filter(Boolean).join(" · ") || undefined}
        back="/"
        actions={
          <Link href={`/repayments/new?personId=${personId}`}>
            <Button>记一笔还款</Button>
          </Link>
        }
      />

      <div className="space-y-4 md:space-y-6">
        <StatCards stats={stats} />

        <Tabs
          tabs={[
            {
              value: "installment",
              label: `银行分期 (${installmentAccounts.length})`,
              content: (
                <div className="space-y-4">
                  {installmentAccounts.length === 0 && (
                    <Card className="py-10 text-center text-text-dim text-sm">
                      暂无分期记录
                      <div className="mt-3">
                        <Link href={`/debts/installment/new?personId=${personId}`}>
                          <Button variant="secondary" size="sm">+ 新增分期</Button>
                        </Link>
                      </div>
                    </Card>
                  )}
                  {installmentAccounts.map((acc) => (
                    <Card key={acc.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                        <div className="flex items-center gap-3">
                          <CardTitle>{acc.title}</CardTitle>
                          {acc.source && <Badge tone="accent">{acc.source}</Badge>}
                          {statusLabel(acc.status)}
                        </div>
                        <p className="text-sm text-text-dim tnum">
                          共 {acc.termMonths} 期 · 本金 ¥{formatCents(acc.principalCents)}
                        </p>
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
                    <Card className="py-10 text-center text-text-dim text-sm lg:col-span-2">
                      暂无个人欠款
                      <div className="mt-3">
                        <Link href={`/debts/personal/new?personId=${personId}`}>
                          <Button variant="secondary" size="sm">+ 新增个人欠款</Button>
                        </Link>
                      </div>
                    </Card>
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
                          {acc.status === "open" && (
                            <div className="flex gap-2 shrink-0">
                              <Link href={`/repayments/new?personId=${personId}&targetType=personal&targetId=${acc.id}`}>
                                <Button size="sm">记还款</Button>
                              </Link>
                              <CloseDebtButton accountId={acc.id} personId={personId} />
                            </div>
                          )}
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
                  {repayments.length === 0 ? (
                    <p className="py-8 text-center text-sm text-text-dim">暂无还款记录</p>
                  ) : (
                    <div className="overflow-x-auto -mx-5 px-5">
                      <table className="w-full min-w-[560px] text-sm">
                        <thead>
                          <tr className="text-left text-xs text-text-dim border-b border-border">
                            <th className="py-2.5 pr-3 font-medium">日期</th>
                            <th className="py-2.5 pr-3 font-medium">归还对象</th>
                            <th className="py-2.5 pr-3 font-medium text-right">金额</th>
                            <th className="py-2.5 pr-3 font-medium text-right">其中利息</th>
                            <th className="py-2.5 pr-3 font-medium text-right">其中本金</th>
                            <th className="py-2.5 font-medium">备注</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...repayments].reverse().map((r) => (
                            <tr key={r.id} className="border-b border-border/50">
                              <td className="py-3 pr-3 tnum text-text-dim">{r.repaidAt}</td>
                              <td className="py-3 pr-3">
                                <RepaymentTargetLabel targetType={r.targetType} billId={r.billId} accountId={r.accountId} billsByAccount={billsByAccount} accounts={accounts} />
                                {r.batchId && <Badge tone="purple" className="ml-2">合并分配</Badge>}
                              </td>
                              <td className="py-3 pr-3 text-right"><MoneyText cents={r.amountCents} prefix="" /></td>
                              <td className="py-3 pr-3 text-right tnum text-text-dim">{formatCents(r.interestPartCents)}</td>
                              <td className="py-3 pr-3 text-right tnum text-text-dim">{formatCents(r.principalPartCents)}</td>
                              <td className="py-3 text-text-dim text-xs">{r.note}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
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

function RepaymentTargetLabel({
  targetType,
  billId,
  accountId,
  billsByAccount,
  accounts,
}: {
  targetType: string;
  billId: number | null;
  accountId: number | null;
  billsByAccount: Map<number, { id: number; periodNo: number; accountId: number }[]>;
  accounts: { id: number; title: string }[];
}) {
  if (targetType === "bill" && billId != null) {
    for (const bills of billsByAccount.values()) {
      const bill = bills.find((b) => b.id === billId);
      if (bill) {
        const acc = accounts.find((a) => a.id === bill.accountId);
        return <span>{acc?.title} · 第{bill.periodNo}期</span>;
      }
    }
    return <span>分期账单</span>;
  }
  const acc = accounts.find((a) => a.id === accountId);
  return <span>{acc?.title ?? "个人欠款"}</span>;
}
