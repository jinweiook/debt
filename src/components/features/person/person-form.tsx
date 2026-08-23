"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createPersonAction } from "@/server/actions/person-actions";

export function PersonForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: "", contact: "", note: "", defaultRepayDay: "" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await createPersonAction({
      name: form.name,
      contact: form.contact,
      note: form.note,
      defaultRepayDay: form.defaultRepayDay ? Number(form.defaultRepayDay) : null,
    });
    setLoading(false);
    if (res.ok) {
      toast("欠款人已创建", "success");
      router.push(`/persons/${res.data.id}`);
      router.refresh();
    } else {
      toast(res.error.message, "error");
    }
  };

  return (
    <Card className="max-w-lg">
      <form onSubmit={submit} className="space-y-4">
        <Field label="姓名" >
          <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="欠款人姓名" />
        </Field>
        <Field label="联系方式" hint="选填">
          <Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="手机号 / 微信" />
        </Field>
        <Field label="默认还款日" hint="每月几号，选填（1-31）">
          <Input
            type="number"
            min={1}
            max={31}
            value={form.defaultRepayDay}
            onChange={(e) => setForm({ ...form, defaultRepayDay: e.target.value })}
            placeholder="如 15"
          />
        </Field>
        <Field label="备注" hint="选填">
          <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="关系、背景等" />
        </Field>
        <div className="flex gap-3 pt-2">
          <Button type="submit" loading={loading}>保存</Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>取消</Button>
        </div>
      </form>
    </Card>
  );
}
