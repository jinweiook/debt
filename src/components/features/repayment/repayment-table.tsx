"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MoneyText } from "@/components/ui/money-text";
import { useToast } from "@/components/ui/toast";
import { usePermission } from "@/components/layout/session";
import { deleteRepaymentsAction } from "@/server/actions/repayment-actions";
import { formatCents } from "@/lib/utils";

export interface RepaymentRow {
  id: number;
  repaidAt: string;
  targetLabel: string;
  hasBatch: boolean;
  amountCents: number;
  interestPartCents: number;
  principalPartCents: number;
  note: string | null;
}

export function RepaymentTable({ rows, personId }: { rows: RepaymentRow[]; personId: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const canDelete = usePermission("repayment:delete");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmIds, setConfirmIds] = useState<number[] | null>(null);

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-text-dim">暂无还款记录</p>;
  }

  const allChecked = selected.size === rows.length;
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
    const res = await deleteRepaymentsAction(confirmIds, personId);
    if (res.ok) {
      toast(`已删除 ${confirmIds.length} 笔还款记录，抵扣金额已回滚`, "success");
      setSelected(new Set());
      router.refresh();
    } else {
      toast(res.error.message, "error");
    }
  };

  return (
    <div>
      {canDelete && selected.size > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-[var(--radius-sm)] bg-surface-2/70 px-3 py-2">
          <span className="text-sm text-text-dim">已选 {selected.size} 笔</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>取消选择</Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmIds([...selected])}>批量删除</Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs text-text-dim border-b border-border">
              {canDelete && (
                <th className="py-2.5 pr-3 font-medium w-8">
                  <Checkbox checked={allChecked} onChange={toggleAll} ariaLabel="全选" />
                </th>
              )}
              <th className="py-2.5 pr-3 font-medium">日期</th>
              <th className="py-2.5 pr-3 font-medium">归还对象</th>
              <th className="py-2.5 pr-3 font-medium text-right">金额</th>
              <th className="py-2.5 pr-3 font-medium text-right">其中利息</th>
              <th className="py-2.5 pr-3 font-medium text-right">其中本金</th>
              <th className="py-2.5 pr-3 font-medium">备注</th>
              {canDelete && <th className="py-2.5 font-medium text-right">操作</th>}
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.id} className="border-b border-border/50 transition-fast hover:bg-white/[0.03]">
                {canDelete && (
                  <td className="py-3 pr-3">
                    <Checkbox
                      checked={selected.has(r.id)}
                      onChange={(c) => toggle(r.id, c)}
                      ariaLabel={`选择还款 ${r.id}`}
                    />
                  </td>
                )}
                <td className="py-3 pr-3 tnum text-text-dim">{r.repaidAt}</td>
                <td className="py-3 pr-3">
                  {r.targetLabel}
                  {r.hasBatch && <Badge tone="purple" className="ml-2">合并分配</Badge>}
                </td>
                <td className="py-3 pr-3 text-right"><MoneyText cents={r.amountCents} prefix="" /></td>
                <td className="py-3 pr-3 text-right tnum text-text-dim">{formatCents(r.interestPartCents)}</td>
                <td className="py-3 pr-3 text-right tnum text-text-dim">{formatCents(r.principalPartCents)}</td>
                <td className="py-3 pr-3 text-text-dim text-xs">{r.note}</td>
                {canDelete && (
                  <td className="py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setConfirmIds([r.id])}>删除</Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirmIds !== null}
        onClose={() => setConfirmIds(null)}
        onConfirm={doDelete}
        title="删除还款记录"
        description={
          <>
            将删除 {confirmIds?.length ?? 0} 笔还款记录，<span className="text-text font-medium">已抵扣的本金/利息会回滚到对应账单或欠款</span>，恢复为未还状态。确认删除？
          </>
        }
      />
    </div>
  );
}
