"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { MoneyText } from "@/components/ui/money-text";
import { useToast } from "@/components/ui/toast";
import { markBillAdvancedAction } from "@/server/actions/repayment-actions";

export function AdvanceButton({
  billId,
  personId,
  remainingCents,
  periodLabel,
}: {
  billId: number;
  personId: number;
  remainingCents: number;
  periodLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const confirm = async () => {
    setLoading(true);
    const res = await markBillAdvancedAction(billId, personId);
    setLoading(false);
    setOpen(false);
    if (res.ok) {
      toast("已垫付，并生成一笔垫付款个人欠款", "success");
      router.refresh();
    } else {
      toast(res.error.message, "error");
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        我已垫付
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="确认垫付">
        <p className="text-sm text-text-dim leading-relaxed">
          你将为 <span className="text-text font-medium">{periodLabel}</span> 垫付剩余应还
          <MoneyText cents={remainingCents} className="mx-1 text-accent" />。
          垫付后该期标记为「已垫付」，同时自动生成一笔等额的无息「垫付款」个人欠款。
        </p>
        <div className="mt-6 flex gap-3 justify-end">
          <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={confirm} loading={loading}>确认垫付</Button>
        </div>
      </Dialog>
    </>
  );
}
