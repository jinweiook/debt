"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { usePermission } from "@/components/layout/session";
import { InstallmentEditDialog } from "./installment-edit-dialog";
import { deleteDebtAccountsAction } from "@/server/actions/debt-actions";

/** 分期账户级操作：编辑分期信息 + 整批删除（账户及全部账单、还款、垫付） */
export function InstallmentAccountActions({
  account,
  personId,
}: {
  account: {
    id: number;
    title: string;
    source: string | null;
    startDate: string;
    note: string | null;
    interestMode: string;
    annualRateBps: number | null;
    termMonths: number | null;
  };
  personId: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const canUpdate = usePermission("debt:update");
  const canDelete = usePermission("debt:delete");
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!canUpdate && !canDelete) return null;

  const doDelete = async () => {
    const res = await deleteDebtAccountsAction([account.id], personId);
    if (res.ok) {
      toast("该分期及其全部账单已删除", "success");
      router.refresh();
    } else {
      toast(res.error.message, "error");
    }
  };

  return (
    <>
      {canUpdate && <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>编辑分期</Button>}
      {canDelete && <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)}>整批删除</Button>}

      <InstallmentEditDialog account={account} personId={personId} open={editOpen} onClose={() => setEditOpen(false)} />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={doDelete}
        title="整批删除分期"
        description={
          <>
            将删除「<span className="text-text font-medium">{account.title}</span>」全部 {account.termMonths ?? 0} 期账单、
            关联的还款流水与垫付记录（含垫付生成的个人欠款），<span className="text-danger">此操作不可恢复</span>。确认删除？
          </>
        }
      />
    </>
  );
}
