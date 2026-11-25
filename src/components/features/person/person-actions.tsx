"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { usePermission } from "@/components/layout/session";
import { PersonForm, type OwnerSelectOption } from "./person-form";
import { deletePersonAction } from "@/server/actions/person-actions";

/** 阻止卡片外层 Link 的跳转（包在操作按钮外侧使用） */
export function StopLink({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={className}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}

export interface PersonActionData {
  id: number;
  name: string;
  contact?: string | null;
  note?: string | null;
  defaultRepayDay?: number | null;
  ownerUserId?: string;
}

export function PersonActions({
  person,
  customers,
  size = "sm",
  /** 删除成功后跳转（详情页用）；不传则仅刷新（卡片用） */
  redirectAfterDelete,
}: {
  person: PersonActionData;
  customers?: OwnerSelectOption[];
  size?: "sm" | "md";
  redirectAfterDelete?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const canUpdate = usePermission("person:update");
  const canDelete = usePermission("person:delete");
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!canUpdate && !canDelete) return null;

  const doDelete = async () => {
    const res = await deletePersonAction(person.id);
    if (res.ok) {
      toast("欠款人及其全部数据已删除", "success");
      if (redirectAfterDelete) router.push(redirectAfterDelete);
      router.refresh();
    } else {
      toast(res.error.message, "error");
    }
  };

  return (
    <>
      {canUpdate && (
        <Button variant="secondary" size={size} onClick={() => setEditOpen(true)}>
          编辑
        </Button>
      )}
      {canDelete && (
        <Button variant="ghost" size={size} onClick={() => setDeleteOpen(true)}>
          删除
        </Button>
      )}

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} title="编辑欠款人">
        <PersonForm
          mode="edit"
          bare
          personId={person.id}
          customers={customers}
          initialValues={{
            name: person.name,
            contact: person.contact,
            note: person.note,
            defaultRepayDay: person.defaultRepayDay,
            ownerUserId: person.ownerUserId,
          }}
          onSaved={() => setEditOpen(false)}
        />
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={doDelete}
        title="删除欠款人"
        description={
          <>
            将删除 <span className="text-text font-medium">{person.name}</span> 及其名下全部分期、个人欠款、还款流水和垫付记录，
            <span className="text-danger">此操作不可恢复</span>。确认删除？
          </>
        }
      />
    </>
  );
}
