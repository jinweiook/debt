"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { yuanToCents, percentToBps, cn } from "@/lib/utils";
import { createPersonalDebtAction } from "@/server/actions/debt-actions";
import type { Person } from "@/server/db/schema";

type InterestType = "none" | "fixed" | "annual";

const interestOptions: { value: InterestType; label: string; desc: string }[] = [
  { value: "none", label: "无息", desc: "只还本金" },
  { value: "fixed", label: "固定利息", desc: "到期一次性计入" },
  { value: "annual", label: "年化利息", desc: "按月计提：剩余本金 × 年化 ÷ 12" },
];

export function PersonalDebtForm({ persons }: { persons: Person[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [personId, setPersonId] = useState(searchParams.get("personId") ?? "");
  const [title, setTitle] = useState("");
  const [amountYuan, setAmountYuan] = useState("");
  const [startDate, setStartDate] = useState("");
  const [interestType, setInterestType] = useState<InterestType>("none");
  const [fixedInterestYuan, setFixedInterestYuan] = useState("");
  const [annualPercent, setAnnualPercent] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  // 客户端水合后再写入今天，避免 SSR/客户端跨午夜的字符串不一致
  useEffect(() => {
    setStartDate(new Date().toISOString().slice(0, 10));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!personId) return toast("请选择欠款人", "error");
    const principalCents = yuanToCents(amountYuan);
    if (!principalCents || principalCents <= 0) return toast("请输入正确的金额", "error");
    if (!title.trim()) return toast("请填写名称", "error");

    let fixedInterestCents: number | null = null;
    let annualRateBps: number | null = null;
    if (interestType === "fixed") {
      fixedInterestCents = yuanToCents(fixedInterestYuan);
      if (fixedInterestCents == null || fixedInterestCents < 0) return toast("请输入正确的固定利息", "error");
    }
    if (interestType === "annual") {
      annualRateBps = percentToBps(annualPercent);
      if (annualRateBps == null || annualRateBps <= 0) return toast("请输入正确的年化利率", "error");
    }

    setLoading(true);
    const res = await createPersonalDebtAction({
      personId: Number(personId),
      title: title.trim(),
      principalCents,
      startDate,
      interestType,
      fixedInterestCents,
      annualRateBps,
      note: note.trim(),
    });
    setLoading(false);
    if (res.ok) {
      toast("个人欠款已创建", "success");
      router.push(`/persons/${res.data.personId}`);
      router.refresh();
    } else {
      toast(res.error.message, "error");
    }
  };

  return (
    <Card className="max-w-lg">
      <form onSubmit={submit} className="space-y-4">
        <Field label="欠款人">
          <Select value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">请选择</option>
            {persons.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="名称" hint="如：直接借出 / 临时周转">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="这笔欠款叫什么" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="金额（元）">
            <Input inputMode="decimal" value={amountYuan} onChange={(e) => setAmountYuan(e.target.value)} placeholder="如 5000" />
          </Field>
          <Field label="借出日期">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium text-text-dim">利息类型</span>
          <div className="grid grid-cols-3 gap-2">
            {interestOptions.map((opt) => (
              <button
                type="button"
                key={opt.value}
                onClick={() => setInterestType(opt.value)}
                className={cn(
                  "rounded-[var(--radius-md)] border p-3 text-left transition-fast",
                  interestType === opt.value
                    ? "border-accent/60 bg-accent/10 shadow-[var(--shadow-glow)]"
                    : "border-border bg-surface-2 hover:border-white/20",
                )}
              >
                <p className={cn("text-sm font-semibold", interestType === opt.value && "text-accent")}>{opt.label}</p>
                <p className="mt-0.5 text-[11px] text-text-dim leading-tight">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {interestType === "fixed" && (
          <Field label="固定利息（元）" hint="结算时计入应还">
            <Input inputMode="decimal" value={fixedInterestYuan} onChange={(e) => setFixedInterestYuan(e.target.value)} placeholder="如 200" />
          </Field>
        )}
        {interestType === "annual" && (
          <Field label="年化利率（%）" hint="如 6 表示年化 6%，按月计提">
            <Input inputMode="decimal" value={annualPercent} onChange={(e) => setAnnualPercent(e.target.value)} placeholder="如 6" />
          </Field>
        )}

        <Field label="备注" hint="选填">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex gap-3 pt-2">
          <Button type="submit" loading={loading}>保存</Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>取消</Button>
        </div>
      </form>
    </Card>
  );
}
