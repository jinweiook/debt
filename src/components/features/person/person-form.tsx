"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createPersonAction, updatePersonAction } from "@/server/actions/person-actions";

export function PersonForm({
  mode = "create",
  personId,
  initialValues,
  bare = false,
  onSaved,
}: {
  mode?: "create" | "edit";
  /** edit 模式必填 */
  personId?: number;
  initialValues?: { name: string; contact?: string | null; note?: string | null; defaultRepayDay?: number | null };
  /** 为 true 时不包 Card（用于 Dialog 内嵌） */
  bare?: boolean;
  /** edit 模式保存成功回调（create 模式固定跳转详情页） */
  onSaved?: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: initialValues?.name ?? "",
    contact: initialValues?.contact ?? "",
    note: initialValues?.note ?? "",
    defaultRepayDay: initialValues?.defaultRepayDay ? String(initialValues.defaultRepayDay) : "",
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const payload = {
      name: form.name,
      contact: form.contact,
      note: form.note,
      defaultRepayDay: form.defaultRepayDay ? Number(form.defaultRepayDay) : null,
    };
    const res =
      mode === "edit" && personId != null
        ? await updatePersonAction(personId, payload)
        : await createPersonAction(payload);
    setLoading(false);
    if (res.ok) {
      toast(mode === "edit" ? "欠款人已更新" : "欠款人已创建", "success");
      if (mode === "edit") {
        onSaved?.();
        router.refresh();
      } else {
        router.push(`/persons/${(res.data as { id: number }).id}`);
        router.refresh();
      }
    } else {
      toast(res.error.message, "error");
    }
  };

  const body = (
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
        <Button type="submit" loading={loading}>{mode === "edit" ? "保存修改" : "保存"}</Button>
        <Button type="button" variant="ghost" onClick={() => (onSaved ? onSaved() : router.back())}>取消</Button>
      </div>
    </form>
  );

  return bare ? body : <Card className="max-w-lg">{body}</Card>;
}
