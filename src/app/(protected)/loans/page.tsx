import Link from "next/link";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyText } from "@/components/ui/money-text";
import { LoansTable, type LoanRow } from "@/components/features/loan/loans-table";
import { listLoanAccounts } from "@/server/services/loan-service";
import { getAuthContext } from "@/server/lib/auth-context";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";

export const dynamic = "force-dynamic";

export default async function LoansPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const auth = await getAuthContext();
  const ownerId = auth?.ownerId ?? null;
  const isAdmin = !!auth?.isAdmin;

  const rows = await listLoanAccounts(q, ownerId);

  // 管理员视图补充归属客户名
  const ownerNames = new Map<string, string>();
  if (isAdmin) {
    const db = getDb();
    const userRows = await db.select({ id: users.id, username: users.username }).from(users);
    for (const u of userRows) ownerNames.set(u.id, u.username);
  }

  const totalRemaining = rows.reduce((s, r) => s + r.remainingCents, 0);
  const counts = {
    installment: rows.filter((r) => r.account.type === "installment").length,
    personal: rows.filter((r) => r.account.type === "personal").length,
  };

  return (
    <AppShell>
      <PageHeader
        title="借贷款列表"
        description={q ? `“${q}” 的搜索结果 · 共 ${rows.length} 笔` : `${rows.length} 笔借贷款 · 剩余待收 ¥${(totalRemaining / 100).toFixed(2)}`}
        back="/"
      />

      <div className="space-y-4 md:space-y-6">
        {/* 搜索 */}
        <form action="/loans" method="GET" className="glass p-4 flex flex-col sm:flex-row gap-3">
          <Input
            name="q"
            defaultValue={q ?? ""}
            placeholder="搜索欠款人姓名或借贷款标题，如：张三 / 招行 e 招贷"
            className="flex-1"
          />
          <div className="flex gap-2">
            <Button type="submit" size="md">搜索</Button>
            {q && (
              <Link href="/loans">
                <Button variant="ghost" size="md">清除</Button>
              </Link>
            )}
          </div>
        </form>

        {/* 统计小卡片 */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-4">
            <p className="text-xs text-text-dim">银行分期</p>
            <p className="mt-1 text-xl font-bold tnum">{counts.installment}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-text-dim">个人欠款</p>
            <p className="mt-1 text-xl font-bold tnum">{counts.personal}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-text-dim">剩余待收</p>
            <MoneyText cents={totalRemaining} className="mt-1 text-xl" />
          </Card>
        </div>

        {/* 列表 */}
        {rows.length === 0 ? (
          <Card className="py-14 text-center">
            <p className="text-text-dim">{q ? "没有匹配的借贷款" : "还没有借贷款记录"}</p>
            {!q && (
              <div className="mt-4 flex justify-center gap-2">
                <Link href="/debts/installment/new"><Button variant="secondary" size="sm">+ 新增分期</Button></Link>
                <Link href="/debts/personal/new"><Button variant="secondary" size="sm">+ 新增个人欠款</Button></Link>
              </div>
            )}
          </Card>
        ) : (
          <Card>
            <LoansTable
              isAdmin={isAdmin}
              rows={rows.map(
                (r): LoanRow => ({
                  id: r.account.id,
                  type: r.account.type,
                  title: r.account.title,
                  source: r.account.source,
                  termMonths: r.account.termMonths,
                  personId: r.account.personId,
                  personName: r.personName,
                  ownerName: isAdmin ? ownerNames.get(r.ownerUserId) : undefined,
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
