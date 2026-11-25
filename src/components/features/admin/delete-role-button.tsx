"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { deleteRoleAction } from "@/server/actions/admin-actions";

export function DeleteRoleButton({
  roleId,
  roleName,
  disabledReason,
}: {
  roleId: number;
  roleName: string;
  disabledReason?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const doDelete = async () => {
    const res = await deleteRoleAction(roleId);
    if (res.ok) {
      toast(`已删除角色「${roleName}」`, "success");
      router.refresh();
    } else {
      toast(res.error.message, "error");
    }
  };

  if (disabledReason) {
    return (
      <Button variant="ghost" size="sm" disabled title={disabledReason}>
        删除
      </Button>
    );
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        删除
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={doDelete}
        title="删除角色"
        description={
          <>
            确认删除自定义角色「<span className="text-text font-medium">{roleName}</span>」？
            <span className="text-danger">此操作不可恢复</span>。
          </>
        }
      />
    </>
  );
}
