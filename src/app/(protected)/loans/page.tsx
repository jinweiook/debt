import Link from "next/link";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyText } from "@/components/ui/money-text";
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
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-text-dim border-b border-border">
                    <th className="py-2.5 pr-3 font-medium">类型</th>
                    <th className="py-2.5 pr-3 font-medium">标题</th>
                    <th className="py-2.5 pr-3 font-medium">欠款人</th>
                    {isAdmin && <th className="py-2.5 pr-3 font-medium">归属客户</th>}
                    <th className="py-2.5 pr-3 font-medium">状态</th>
                    <th className="py-2.5 pr-3 font-medium text-right">剩余应还</th>
                    <th className="py-2.5 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const acc = r.account;
                    return (
                      <tr key={acc.id} className="border-b border-border/50 transition-fast hover:bg-white/[0.03]">
                        <td className="py-3 pr-3">
                          {acc.type === "installment" ? <Badge tone="accent">分期</Badge> : <Badge tone="purple">个人</Badge>}
                        </td>
                        <td className="py-3 pr-3">
                          <Link href={`/loans/${acc.id}`} className="font-medium hover:text-accent transition-fast">
                            {acc.title}
                          </Link>
                          {acc.source && <span className="text-xs text-text-dim ml-1.5">{acc.source}</span>}
                          {acc.type === "installment" && (
                            <span className="text-xs text-text-dim ml-1.5 tnum">共 {acc.termMonths} 期</span>
                          )}
                        </td>
                        <td className="py-3 pr-3">
                          <Link href={`/persons/${acc.personId}`} className="text-text-dim hover:text-accent transition-fast">
                            {r.personName}
                          </Link>
                        </td>
                        {isAdmin && (
                          <td className="py-3 pr-3 text-text-dim">
                            {ownerNames.get(r.ownerUserId) ?? "-"}
                          </td>
                        )}
                        <td className="py-3 pr-3">
                          {acc.status === "open" ? (
                            <Badge tone="warning">进行中</Badge>
                          ) : acc.status === "settled" ? (
                            <Badge tone="success">已结清</Badge>
                          ) : (
                            <Badge tone="dim">已关闭</Badge>
                          )}
                        </td>
                        <td className="py-3 pr-3 text-right">
                          <MoneyText cents={r.remainingCents} prefix="" />
                        </td>
                        <td className="py-3">
                          <div className="flex justify-end gap-2">
                            <Link href={`/loans/${acc.id}`}>
                              <Button size="sm" variant="secondary">查看详情</Button>
                            </Link>
                            <Link
                              href={
                                acc.type === "personal"
                                  ? `/repayments/new?personId=${acc.personId}&targetType=personal&targetId=${acc.id}`
                                  : `/repayments/new?personId=${acc.personId}`
                              }
                            >
                              <Button size="sm">记还款</Button>
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
