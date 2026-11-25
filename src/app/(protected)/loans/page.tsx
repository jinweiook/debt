import Link from "next/link";
import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { MoneyText } from "@/components/ui/money-text";
import { LoansTable, type LoanRow } from "@/components/features/loan/loans-table";
import { listLoanAccounts } from "@/server/services/loan-service";
import { getAuthContext, hasPerm } from "@/server/lib/auth-context";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { formatUserDisplayName } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function LoansPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; customerId?: string }>;
}) {
  const { q, customerId } = await searchParams;
  const auth = await getAuthContext();
  if (!auth) return null;
  if (!hasPerm(auth, "debt:read")) {
    redirect("/");
  }

  const isAllScope = auth.dataScope === "all";
  const canCreateDebt = hasPerm(auth, "debt:create");

  const ownerNames = new Map<string, string>();
  let userOptions: { id: string; username: string; displayName: string | null }[] = [];
  if (isAllScope) {
    const db = getDb();
    userOptions = await db
      .select({ id: users.id, username: users.username, displayName: users.displayName })
      .from(users)
      .orderBy(asc(users.createdAt));
    for (const u of userOptions) ownerNames.set(u.id, formatUserDisplayName(u));
  }

  const selectedCustomer =
    isAllScope && customerId ? userOptions.find((u) => u.id === customerId) : undefined;
  // 普通客户强制锁定本人 userId，忽略任何外部传入的 customerId
  const effectiveOwnerId = isAllScope
    ? (selectedCustomer ? selectedCustomer.id : null)
    : auth.userId;

  const rows = await listLoanAccounts(q, effectiveOwnerId);

  const totalRemaining = rows.reduce((s, r) => s + r.remainingCents, 0);
  const counts = {
    installment: rows.filter((r) => r.account.type === "installment").length,
    personal: rows.filter((r) => r.account.type === "personal").length,
  };

  const descParts = [];
  if (selectedCustomer) descParts.push(`客户：${formatUserDisplayName(selectedCustomer)}`);
  if (q) descParts.push(`“${q}” 的搜索结果`);
  descParts.push(`${rows.length} 笔借贷款 · 剩余待收 ¥${(totalRemaining / 100).toFixed(2)}`);

  return (
    <AppShell>
      <PageHeader
        title="借贷款列表"
        description={descParts.join(" · ")}
        back={selectedCustomer ? `/?customerId=${selectedCustomer.id}` : "/"}
      />

      <div className="space-y-4 md:space-y-6">
        {/* 搜索与客户筛选 */}
        <form action="/loans" method="GET" className="glass p-4 flex flex-col sm:flex-row gap-3">
          {isAllScope && (
            <Select
              name="customerId"
              defaultValue={selectedCustomer?.id ?? ""}
              className="sm:w-56"
              aria-label="按归属客户筛选"
            >
              <option value="">全部客户</option>
              {userOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {formatUserDisplayName(u)}
                </option>
              ))}
            </Select>
          )}
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder="搜索欠款人姓名或借贷款标题，如：张三 / 招行 e 招贷"
            className="flex-1"
          />
          <div className="flex gap-2">
            <Button type="submit" size="md">搜索</Button>
            {(q || selectedCustomer) && (
              <Link href="/loans">
                <Button variant="ghost" size="md">清除</Button>
              </Link>
            )}
          </div>
        </form>

        {/* 统计小卡片 */}
        <div className="grid grid-cols-3 gap-2 md:gap-3">
          <Card className="p-3.5 md:p-4">
            <p className="text-xs text-text-dim">银行分期</p>
            <p className="mt-1 text-lg md:text-xl font-bold tnum">{counts.installment}</p>
          </Card>
          <Card className="p-3.5 md:p-4">
            <p className="text-xs text-text-dim">个人欠款</p>
            <p className="mt-1 text-lg md:text-xl font-bold tnum">{counts.personal}</p>
          </Card>
          <Card className="p-3.5 md:p-4">
            <p className="text-xs text-text-dim">剩余待收</p>
            <MoneyText cents={totalRemaining} className="mt-1 text-lg md:text-xl" />
          </Card>
        </div>

        {/* 列表 */}
        {rows.length === 0 ? (
          <Card className="py-14 text-center">
            <p className="text-text-dim">{q || selectedCustomer ? "没有匹配的借贷款" : "还没有借贷款记录"}</p>
            {!q && canCreateDebt && (
              <div className="mt-4 flex justify-center gap-2">
                <Link href="/debts/installment/new"><Button variant="secondary" size="sm">+ 新增分期</Button></Link>
                <Link href="/debts/personal/new"><Button variant="secondary" size="sm">+ 新增个人欠款</Button></Link>
              </div>
            )}
          </Card>
        ) : (
          <Card>
            <LoansTable
              showOwner={isAllScope}
              rows={rows.map(
                (r): LoanRow => ({
                  id: r.account.id,
                  type: r.account.type,
                  title: r.account.title,
                  source: r.account.source,
                  termMonths: r.account.termMonths,
                  personId: r.account.personId,
                  personName: r.personName,
                  ownerUserId: r.ownerUserId,
                  ownerName: isAllScope ? ownerNames.get(r.ownerUserId) : undefined,
                  status: r.account.status,
                  remainingCents: r.remainingCents,
                }),
              )}
            />
          </Card>
        )}
      </div>
    </AppShell>
  );
}
