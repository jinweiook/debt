"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { closePersonalDebtAction } from "@/server/actions/debt-actions";

export function CloseDebtButton({ accountId, personId }: { accountId: number; personId: number }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const confirm = async () => {
    setLoading(true);
    const res = await closePersonalDebtAction(accountId, personId);
    setLoading(false);
    setOpen(false);
    if (res.ok) {
      toast("已关闭该笔欠款", "success");
      router.refresh();
    } else {
      toast(res.error.message, "error");
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>关闭</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="关闭欠款">
        <p className="text-sm text-text-dim">关闭后该笔欠款不再计入统计（仅无剩余金额时可关闭）。</p>
        <div className="mt-6 flex gap-3 justify-end">
          <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
          <Button variant="danger" onClick={confirm} loading={loading}>确认关闭</Button>
        </div>
      </Dialog>
    </>
  );
}
