"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MoneyText } from "@/components/ui/money-text";
import { AdvanceButton } from "./advance-button";
import { BillEditDialog } from "./bill-edit-dialog";
import { cn } from "@/lib/utils";
import type { DebtAccount, InstallmentBill } from "@/server/db/schema";

const statusMap: Record<string, { label: string; tone: "dim" | "warning" | "success" | "purple" }> = {
  pending: { label: "待还", tone: "warning" },
  partial: { label: "部分已还", tone: "dim" },
  paid: { label: "已还清", tone: "success" },
  advanced: { label: "已垫付", tone: "purple" },
};

export function BillTable({
  account,
  bills,
  personId,
}: {
  account: DebtAccount;
  bills: InstallmentBill[];
  personId: number;
}) {
  const [editing, setEditing] = useState<InstallmentBill | null>(null);

  return (
    <div className="overflow-x-auto -mx-5 px-5">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="text-left text-xs text-text-dim border-b border-border">
            <th className="py-2.5 pr-3 font-medium">期号</th>
            <th className="py-2.5 pr-3 font-medium">到期日</th>
            <th className="py-2.5 pr-3 font-medium text-right">本金</th>
            <th className="py-2.5 pr-3 font-medium text-right">利息</th>
            <th className="py-2.5 pr-3 font-medium text-right">合计</th>
            <th className="py-2.5 pr-3 font-medium text-right">已还</th>
            <th className="py-2.5 pr-3 font-medium">状态</th>
            <th className="py-2.5 font-medium text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {bills.map((b) => {
            const st = statusMap[b.status] ?? statusMap.pending;
            const actionable = b.status === "pending" || b.status === "partial";
            return (
              <tr key={b.id} className={cn("border-b border-border/50 transition-fast hover:bg-white/[0.03]", b.status === "advanced" && "opacity-60")}>
                <td className="py-3 pr-3 tnum">#{b.periodNo}</td>
                <td className="py-3 pr-3 tnum text-text-dim">{b.dueDate}</td>
                <td className="py-3 pr-3 text-right"><MoneyText cents={b.principalCents} prefix="" className="font-normal" /></td>
                <td className="py-3 pr-3 text-right"><MoneyText cents={b.interestCents} prefix="" className="font-normal text-text-dim" /></td>
                <td className="py-3 pr-3 text-right"><MoneyText cents={b.totalCents} prefix="" /></td>
                <td className="py-3 pr-3 text-right"><MoneyText cents={b.paidCents} prefix="" className="font-normal text-success" /></td>
                <td className="py-3 pr-3"><Badge tone={st.tone}>{st.label}</Badge></td>
                <td className="py-3">
                  <div className="flex justify-end gap-2">
                    {actionable && (
                      <>
                        <Link href={`/repayments/new?personId=${personId}&targetType=bill&targetId=${b.id}`}>
                          <Button size="sm">记还款</Button>
                        </Link>
                        <AdvanceButton
                          billId={b.id}
                          personId={personId}
                          remainingCents={b.totalCents - b.paidCents}
                          periodLabel={`${account.title} 第${b.periodNo}期`}
                        />
                      </>
                    )}
                    {b.status === "pending" && (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(b)}>编辑</Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {editing && (
        <BillEditDialog bill={editing} personId={personId} open onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
