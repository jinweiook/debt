"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { deleteDebtAccountsAction } from "@/server/actions/debt-actions";

/** 删除单条债务（分期或个人欠款）。垫付生成的欠款删除时会同时取消源账单的垫付状态。 */
export function DeleteDebtButton({
  accountId,
  personId,
  title,
  isAdvanceGenerated,
  size = "sm",
}: {
  accountId: number;
  personId: number;
  title: string;
  isAdvanceGenerated?: boolean;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const doDelete = async () => {
    const res = await deleteDebtAccountsAction([accountId], personId);
    if (res.ok) {
      toast("已删除", "success");
      router.refresh();
    } else {
      toast(res.error.message, "error");
    }
  };

  return (
    <>
      <Button variant="ghost" size={size} onClick={() => setOpen(true)}>删除</Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={doDelete}
        title="删除欠款"
        description={
          <>
            将删除「<span className="text-text font-medium">{title}</span>」及其关联还款流水。
            {isAdvanceGenerated && (
              <span className="block mt-2 text-warning">该笔为垫付生成：删除后对应分期账单将恢复为未垫付状态。</span>
            )}
            <span className="block mt-2 text-danger">此操作不可恢复，确认删除？</span>
          </>
        }
      />
    </>
  );
}
