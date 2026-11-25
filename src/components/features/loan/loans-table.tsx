"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MoneyText } from "@/components/ui/money-text";
import { useToast } from "@/components/ui/toast";
import { deleteDebtAccountsAction } from "@/server/actions/debt-actions";

export interface LoanRow {
  id: number;
  type: string;
  title: string;
  source: string | null;
  termMonths: number | null;
  personId: number;
  personName: string;
  ownerName?: string;
  status: string;
  remainingCents: number;
}

export function LoansTable({ rows, isAdmin }: { rows: LoanRow[]; isAdmin: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmIds, setConfirmIds] = useState<number[] | null>(null);

  const allChecked = rows.length > 0 && selected.size === rows.length;
  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set());
  };
  const toggle = (id: number, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const doDelete = async () => {
    if (!confirmIds || confirmIds.length === 0) return;
    // 同一批可能跨欠款人，action 按每条记录的 personId 校验；批量删除用第一条的 personId 做 revalidate 即可
    const personId = rows.find((r) => r.id === confirmIds[0])?.personId ?? 0;
    const res = await deleteDebtAccountsAction(confirmIds, personId);
    if (res.ok) {
      toast(`已删除 ${confirmIds.length} 笔借贷款及其关联数据`, "success");
      setSelected(new Set());
      router.refresh();
    } else {
      toast(res.error.message, "error");
    }
  };

  return (
    <div>
      {selected.size > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-[var(--radius-sm)] bg-surface-2/70 px-3 py-2">
          <span className="text-sm text-text-dim">已选 {selected.size} 笔</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>取消选择</Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmIds([...selected])}>批量删除</Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-xs text-text-dim border-b border-border">
              <th className="py-2.5 pr-3 font-medium w-8">
                <Checkbox checked={allChecked} onChange={toggleAll} ariaLabel="全选" />
              </th>
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
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/50 transition-fast hover:bg-white/[0.03]">
                <td className="py-3 pr-3">
                  <Checkbox checked={selected.has(r.id)} onChange={(c) => toggle(r.id, c)} ariaLabel={`选择 ${r.title}`} />
                </td>
                <td className="py-3 pr-3">
                  {r.type === "installment" ? <Badge tone="accent">分期</Badge> : <Badge tone="purple">个人</Badge>}
                </td>
                <td className="py-3 pr-3">
                  <Link href={`/loans/${r.id}`} className="font-medium hover:text-accent transition-fast">
                    {r.title}
                  </Link>
                  {r.source && <span className="text-xs text-text-dim ml-1.5">{r.source}</span>}
                  {r.type === "installment" && (
                    <span className="text-xs text-text-dim ml-1.5 tnum">共 {r.termMonths} 期</span>
                  )}
                </td>
                <td className="py-3 pr-3">
                  <Link href={`/persons/${r.personId}`} className="text-text-dim hover:text-accent transition-fast">
                    {r.personName}
                  </Link>
                </td>
                {isAdmin && <td className="py-3 pr-3 text-text-dim">{r.ownerName ?? "-"}</td>}
                <td className="py-3 pr-3">
                  {r.status === "open" ? (
                    <Badge tone="warning">进行中</Badge>
                  ) : r.status === "settled" ? (
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
                    <Link href={`/loans/${r.id}`}>
                      <Button size="sm" variant="secondary">查看详情</Button>
                    </Link>
                    <Link
                      href={
                        r.type === "personal"
                          ? `/repayments/new?personId=${r.personId}&targetType=personal&targetId=${r.id}`
                          : `/repayments/new?personId=${r.personId}`
                      }
                    >
                      <Button size="sm">记还款</Button>
                    </Link>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmIds([r.id])}>删除</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirmIds !== null}
        onClose={() => setConfirmIds(null)}
        onConfirm={doDelete}
        title="删除借贷款"
        description={
          <>
            将删除 {confirmIds?.length ?? 0} 笔借贷款及其关联的账单、还款流水、垫付记录
            （垫付生成的个人欠款会一并删除），<span className="text-danger">此操作不可恢复</span>。确认删除？
          </>
        }
      />
    </div>
  );
}
