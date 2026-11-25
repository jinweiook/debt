import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MoneyText } from "@/components/ui/money-text";
import { BillTable } from "@/components/features/installment/bill-table";
import { InstallmentAccountActions } from "@/components/features/installment/installment-account-actions";
import { InterestBadge } from "@/components/features/personal/interest-badge";
import { DeleteDebtButton } from "@/components/features/personal/delete-debt-button";
import { RepaymentTable, type RepaymentRow } from "@/components/features/repayment/repayment-table";
import { getLoanAccountDetail } from "@/server/services/loan-service";
import { virtualAccruedInterest } from "@/server/services/interest-service";
import { getAuthContext } from "@/server/lib/auth-context";
import { formatCents } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function LoanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const accountId = Number(id);
  if (!Number.isInteger(accountId) || accountId <= 0) notFound();

  const auth = await getAuthContext();
  if (!auth) notFound();

  let detail;
  try {
    detail = await getLoanAccountDetail(accountId, auth.ownerId);
  } catch {
    notFound();
  }

  const { account, person, bills, repayments, remainingCents } = detail;
  const isInstallment = account.type === "installment";

  // 统计
  const totalPrincipal = account.principalCents;
  const totalPaid = isInstallment
    ? bills!.reduce((s, b) => s + b.paidCents, 0)
    : account.paidInterestCents + (account.principalCents - account.remainingPrincipalCents);
  const virtualInterest = !isInstallment ? virtualAccruedInterest(account) : 0;
  const fixedRemaining =
    !isInstallment && account.interestType === "fixed"
      ? Math.max((account.fixedInterestCents ?? 0) - account.paidInterestCents, 0)
      : 0;

  const statusBadge =
    account.status === "open" ? (
      <Badge tone="warning">进行中</Badge>
    ) : account.status === "settled" ? (
      <Badge tone="success">已结清</Badge>
    ) : (
      <Badge tone="dim">已关闭</Badge>
    );

  return (
    <AppShell>
      <PageHeader
        title={account.title}
        description={[
          account.source,
          isInstallment ? `共 ${account.termMonths} 期` : undefined,
          account.note,
        ].filter(Boolean).join(" · ") || undefined}
        back="/loans"
        actions={
          <div className="flex items-center gap-2">
            {isInstallment && (
              <InstallmentAccountActions
                account={{
                  id: account.id,
                  title: account.title,
                  source: account.source,
                  startDate: account.startDate,
                  note: account.note,
                  interestMode: account.interestMode,
                  annualRateBps: account.annualRateBps,
                  termMonths: account.termMonths,
                }}
                personId={person.id}
              />
            )}
            {!isInstallment && (
              <DeleteDebtButton
                accountId={account.id}
                personId={person.id}
                title={account.title}
                isAdvanceGenerated={account.origin === "advance"}
                size="md"
              />
            )}
            <Link
              href={
                isInstallment
                  ? `/repayments/new?personId=${person.id}`
                  : `/repayments/new?personId=${person.id}&targetType=personal&targetId=${account.id}`
              }
            >
              <Button>记一笔还款</Button>
            </Link>
          </div>
        }
      />

      <div className="space-y-4 md:space-y-6">
        {/* 基本信息 */}
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-2.5">
            {isInstallment ? <Badge tone="accent">银行分期</Badge> : <Badge tone="purple">个人欠款</Badge>}
            {statusBadge}
            <InterestBadge account={account} />
            {account.origin === "advance" && <Badge tone="warning">垫付生成</Badge>}
            <Link href={`/persons/${person.id}`} className="text-sm text-text-dim hover:text-accent transition-fast ml-auto">
              欠款人：{person.name} →
            </Link>
          </div>
          <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-text-dim">剩余应还</p>
              <MoneyText cents={account.status === "open" ? remainingCents : 0} gradient className="text-xl md:text-2xl" />
            </div>
            <div>
              <p className="text-xs text-text-dim">本金总额</p>
              <MoneyText cents={totalPrincipal} prefix="" className="text-xl md:text-2xl" />
            </div>
            <div>
              <p className="text-xs text-text-dim">累计已还</p>
              <MoneyText cents={totalPaid} prefix="" className="text-xl md:text-2xl" />
            </div>
            <div>
              <p className="text-xs text-text-dim">开始日期</p>
              <p className="mt-1 text-xl md:text-2xl font-semibold tnum">{account.startDate}</p>
            </div>
          </div>
          {!isInstallment && account.interestType !== "none" && (
            <p className="mt-4 text-xs text-text-dim border-t border-border pt-3">
              {virtualInterest > 0 && <>已计提利息 ¥{formatCents(virtualInterest)}</>}
              {fixedRemaining > 0 && <>固定利息剩余 ¥{formatCents(fixedRemaining)}</>}
            </p>
          )}
        </Card>

        {/* 分期账单 */}
        {isInstallment && bills && (
          <Card>
            <div className="flex items-center justify-between mb-3">
              <CardTitle>逐期账单</CardTitle>
            </div>
            <BillTable account={account} bills={bills} personId={person.id} />
          </Card>
        )}

        {/* 还款流水 */}
        <Card>
          <CardTitle className="mb-3">还款流水（{repayments.length}）</CardTitle>
          <RepaymentTable
            personId={person.id}
            rows={repayments.map(
              (r): RepaymentRow => ({
                id: r.id,
                repaidAt: r.repaidAt,
                targetLabel:
                  r.targetType === "bill"
                    ? `${account.title} · 第${bills?.find((b) => b.id === r.billId)?.periodNo ?? "-"}期`
                    : account.title,
                hasBatch: r.batchId != null,
                amountCents: r.amountCents,
                interestPartCents: r.interestPartCents,
                principalPartCents: r.principalPartCents,
                note: r.note,
              }),
            )}
          />
        </Card>
      </div>
    </AppShell>
  );
}
