"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { updateInstallmentAccountAction } from "@/server/actions/debt-actions";

export function InstallmentEditDialog({
  account,
  personId,
  open,
  onClose,
}: {
  account: {
    id: number;
    title: string;
    source: string | null;
    startDate: string;
    note: string | null;
    interestMode: string;
    annualRateBps: number | null;
  };
  personId: number;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const isDynamic = account.interestMode === "dynamic";
  const [form, setForm] = useState({
    title: account.title,
    source: account.source ?? "",
    startDate: account.startDate,
    note: account.note ?? "",
    annualRate: isDynamic && account.annualRateBps != null ? (account.annualRateBps / 100).toString() : "",
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await updateInstallmentAccountAction(account.id, personId, {
      title: form.title,
      source: form.source,
      startDate: form.startDate,
      note: form.note,
      annualRateBps: isDynamic && form.annualRate ? Math.round(Number(form.annualRate) * 100) : undefined,
    });
    setLoading(false);
    if (res.ok) {
      toast("分期信息已更新", "success");
      onClose();
      router.refresh();
    } else {
      toast(res.error.message, "error");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="编辑分期信息">
      <form onSubmit={submit} className="space-y-4">
        <Field label="名称">
          <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="来源银行" hint="选填">
          <Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
        </Field>
        <Field label="开始日期">
          <Input type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </Field>
        {isDynamic && (
          <Field label="年化利率 (%)" hint="仅无任何还款/垫付记录时可修改">
            <Input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={form.annualRate}
              onChange={(e) => setForm({ ...form, annualRate: e.target.value })}
            />
          </Field>
        )}
        <Field label="备注" hint="选填">
          <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        <div className="flex gap-3 pt-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
          <Button type="submit" loading={loading}>保存修改</Button>
        </div>
      </form>
    </Dialog>
  );
}
