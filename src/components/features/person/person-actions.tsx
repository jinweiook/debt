"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { PersonForm } from "./person-form";
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
}

export function PersonActions({
  person,
  size = "sm",
  /** 删除成功后跳转（详情页用）；不传则仅刷新（卡片用） */
  redirectAfterDelete,
}: {
  person: PersonActionData;
  size?: "sm" | "md";
  redirectAfterDelete?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
      <Button variant="secondary" size={size} onClick={() => setEditOpen(true)}>编辑</Button>
      <Button variant="ghost" size={size} onClick={() => setDeleteOpen(true)}>删除</Button>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} title="编辑欠款人">
        <PersonForm
          mode="edit"
          bare
          personId={person.id}
          initialValues={{
            name: person.name,
            contact: person.contact,
            note: person.note,
            defaultRepayDay: person.defaultRepayDay,
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
