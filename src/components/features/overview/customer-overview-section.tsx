import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MoneyText } from "@/components/ui/money-text";
import type { CustomerOverview } from "@/server/services/stats-service";

export function CustomerOverviewSection({
  customers,
  currentUserId,
}: {
  customers: CustomerOverview[];
  currentUserId: string;
}) {
  const totals = customers.reduce(
    (acc, c) => ({
      activePersons: acc.activePersons + c.activePersons,
      openInstallmentCount: acc.openInstallmentCount + c.openInstallmentCount,
      openPersonalCount: acc.openPersonalCount + c.openPersonalCount,
      installmentRemaining: acc.installmentRemaining + c.installmentRemaining,
      personalRemaining: acc.personalRemaining + c.personalRemaining,
      totalOutstanding: acc.totalOutstanding + c.totalOutstanding,
      totalReceived: acc.totalReceived + c.totalReceived,
      totalAdvanced: acc.totalAdvanced + c.totalAdvanced,
    }),
    {
      activePersons: 0,
      openInstallmentCount: 0,
      openPersonalCount: 0,
      installmentRemaining: 0,
      personalRemaining: 0,
      totalOutstanding: 0,
      totalReceived: 0,
      totalAdvanced: 0,
    },
  );

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <CardTitle>各客户账单总览</CardTitle>
          <p className="text-xs text-text-dim mt-0.5">
            共 {customers.length} 个账号（含管理员自身数据），点击客户可切换查看其专属总览
          </p>
        </div>
        <Link href="/admin/customers">
          <Button variant="ghost" size="sm">
            管理客户 →
          </Button>
        </Link>
      </div>

      {/* 桌面端表格 */}
      <div className="hidden md:block overflow-x-auto -mx-4 px-4 sm:-mx-5 sm:px-5">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="text-left text-xs text-text-dim border-b border-border">
              <th className="py-2.5 pr-3 font-medium">客户 / 账号</th>
              <th className="py-2.5 pr-3 font-medium text-right">欠款人</th>
              <th className="py-2.5 pr-3 font-medium text-right">在途分期/个欠</th>
              <th className="py-2.5 pr-3 font-medium text-right">银行待还</th>
              <th className="py-2.5 pr-3 font-medium text-right">个欠剩余</th>
              <th className="py-2.5 pr-3 font-medium text-right">总欠款</th>
              <th className="py-2.5 pr-3 font-medium text-right">累计已收</th>
              <th className="py-2.5 pr-3 font-medium text-right">累计垫付</th>
              <th className="py-2.5 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.userId} className="border-b border-border/50 transition-fast hover:bg-white/[0.03]">
                <td className="py-3 pr-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Link
                      href={`/?customerId=${c.userId}`}
                      className="font-medium hover:text-accent transition-fast"
                    >
                      {c.displayName || c.username}
                    </Link>
                    {c.userId === currentUserId && <Badge tone="purple">本人</Badge>}
                    {c.status !== "active" && <Badge tone="danger">已禁用</Badge>}
                  </div>
                  <p className="text-xs text-text-dim">
                    @{c.username} · {c.roleNames.join(" / ")}
                  </p>
                </td>
                <td className="py-3 pr-3 text-right tnum">{c.activePersons}</td>
                <td className="py-3 pr-3 text-right tnum text-text-dim">
                  {c.openInstallmentCount} / {c.openPersonalCount}
                </td>
                <td className="py-3 pr-3 text-right">
                  <MoneyText cents={c.installmentRemaining} prefix="" className="font-normal" />
                </td>
                <td className="py-3 pr-3 text-right">
                  <MoneyText cents={c.personalRemaining} prefix="" className="font-normal" />
                </td>
                <td className="py-3 pr-3 text-right">
                  <MoneyText cents={c.totalOutstanding} prefix="" gradient={c.totalOutstanding > 0} />
                </td>
                <td className="py-3 pr-3 text-right">
                  <MoneyText cents={c.totalReceived} prefix="" className="font-normal text-success" />
                </td>
                <td className="py-3 pr-3 text-right">
                  <MoneyText cents={c.totalAdvanced} prefix="" className="font-normal text-text-dim" />
                </td>
                <td className="py-3">
                  <div className="flex justify-end gap-1.5">
                    <Link href={`/?customerId=${c.userId}`}>
                      <Button variant="secondary" size="sm">
                        查看总览
                      </Button>
                    </Link>
                    <Link href={`/loans?customerId=${c.userId}`}>
                      <Button variant="ghost" size="sm">
                        借贷款
                      </Button>
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-surface-2/40 font-semibold">
              <td className="py-3 pr-3 text-text-dim">全站合计</td>
              <td className="py-3 pr-3 text-right tnum">{totals.activePersons}</td>
              <td className="py-3 pr-3 text-right tnum text-text-dim">
                {totals.openInstallmentCount} / {totals.openPersonalCount}
              </td>
              <td className="py-3 pr-3 text-right">
                <MoneyText cents={totals.installmentRemaining} prefix="" />
              </td>
              <td className="py-3 pr-3 text-right">
                <MoneyText cents={totals.personalRemaining} prefix="" />
              </td>
              <td className="py-3 pr-3 text-right">
                <MoneyText cents={totals.totalOutstanding} prefix="" gradient />
              </td>
              <td className="py-3 pr-3 text-right">
                <MoneyText cents={totals.totalReceived} prefix="" className="text-success" />
              </td>
              <td className="py-3 pr-3 text-right">
                <MoneyText cents={totals.totalAdvanced} prefix="" className="text-text-dim" />
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 移动端卡片列表 */}
      <div className="md:hidden space-y-3">
        {customers.map((c) => (
          <div
            key={c.userId}
            className="rounded-[var(--radius-md)] border border-border bg-surface-2/50 p-3.5 space-y-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold truncate">{c.displayName || c.username}</span>
                  {c.userId === currentUserId && <Badge tone="purple">本人</Badge>}
                  {c.status !== "active" && <Badge tone="danger">已禁用</Badge>}
                </div>
                <p className="text-xs text-text-dim">
                  @{c.username} · {c.activePersons} 位欠款人
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[11px] text-text-dim">总欠款</p>
                <MoneyText cents={c.totalOutstanding} gradient={c.totalOutstanding > 0} className="text-base" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-text-dim">银行待还</p>
                <MoneyText cents={c.installmentRemaining} prefix="" className="text-xs" />
              </div>
              <div>
                <p className="text-text-dim">个欠剩余</p>
                <MoneyText cents={c.personalRemaining} prefix="" className="text-xs" />
              </div>
              <div>
                <p className="text-text-dim">累计已收</p>
                <MoneyText cents={c.totalReceived} prefix="" className="text-xs text-success" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1 border-t border-border/40">
              <Link href={`/loans?customerId=${c.userId}`}>
                <Button variant="ghost" size="sm">
                  借贷款
                </Button>
              </Link>
              <Link href={`/?customerId=${c.userId}`}>
                <Button variant="secondary" size="sm">
                  查看总览
                </Button>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
