"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { yuanToCents, centsToYuan } from "@/lib/utils";
import { updateBillAction } from "@/server/actions/debt-actions";
import type { InstallmentBill } from "@/server/db/schema";

export function BillEditDialog({
  bill,
  personId,
  open,
  onClose,
}: {
  bill: InstallmentBill;
  personId: number;
  open: boolean;
  onClose: () => void;
}) {
  const [dueDate, setDueDate] = useState(bill.dueDate);
  const [principal, setPrincipal] = useState(centsToYuan(bill.principalCents));
  const [interest, setInterest] = useState(centsToYuan(bill.interestCents));
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const save = async () => {
    const principalCents = yuanToCents(principal);
    const interestCents = yuanToCents(interest);
    if (principalCents == null || interestCents == null || principalCents + interestCents <= 0) {
      toast("请输入正确的金额", "error");
      return;
    }
    setLoading(true);
    const res = await updateBillAction(bill.id, personId, { dueDate, principalCents, interestCents });
    setLoading(false);
    if (res.ok) {
      toast("账单已更新", "success");
      onClose();
      router.refresh();
    } else {
      toast(res.error.message, "error");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={`编辑第 ${bill.periodNo} 期账单`}>
      <div className="space-y-4">
        <Field label="到期日">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="应还本金（元）">
            <Input inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
          </Field>
          <Field label="应还利息（元）">
            <Input inputMode="decimal" value={interest} onChange={(e) => setInterest(e.target.value)} />
          </Field>
        </div>
        <div className="flex gap-3 justify-end pt-2">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={save} loading={loading}>保存</Button>
        </div>
      </div>
    </Dialog>
  );
}
