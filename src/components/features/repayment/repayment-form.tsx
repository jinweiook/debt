"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { yuanToCents, formatCents, cn } from "@/lib/utils";
import { SplitPreview } from "./split-preview";
import {
  listRepaymentTargetsAction,
  previewRepaymentAction,
  createRepaymentAction,
} from "@/server/actions/repayment-actions";
import type { SplitTarget, Allocation } from "@/lib/repayment-split";
import type { Person } from "@/server/db/schema";

const steps = ["选择欠款人", "选择归还对象", "金额与确认"];

export function RepaymentForm({ persons }: { persons: Person[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [personId, setPersonId] = useState(searchParams.get("personId") ?? "");
  const [targets, setTargets] = useState<SplitTarget[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [amountYuan, setAmountYuan] = useState("");
  const [repaidAt, setRepaidAt] = useState("");
  const [note, setNote] = useState("");
  const [allocation, setAllocation] = useState<Allocation | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 客户端水合后再写入今天，避免 SSR/客户端跨午夜的字符串不一致
  useEffect(() => {
    setRepaidAt(new Date().toISOString().slice(0, 10));
  }, []);

  // 加载目标列表
  useEffect(() => {
    if (!personId) {
      setTargets([]);
      return;
    }
    setTargetsLoading(true);
    listRepaymentTargetsAction(Number(personId)).then((res) => {
      setTargetsLoading(false);
      if (res.ok) {
        setTargets(res.data);
        const qt = searchParams.get("targetType");
        const qid = searchParams.get("targetId");
        const pre = qt && qid ? `${qt}:${qid}` : "";
        setSelectedKey(pre && res.data.some((t) => t.key === pre) ? pre : (res.data[0]?.key ?? ""));
        if (pre) setStep(2);
      } else {
        setTargets([]);
        toast(res.error.message, "error");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId]);

  const selected = useMemo(() => targets.find((t) => t.key === selectedKey), [targets, selectedKey]);
  const amountCents = useMemo(() => yuanToCents(amountYuan), [amountYuan]);

  const preview = async () => {
    if (!selected || !amountCents || amountCents <= 0) return toast("请输入正确的还款金额", "error");
    setPreviewLoading(true);
    const res = await previewRepaymentAction({
      personId: Number(personId),
      targetType: selected.kind,
      targetId: selected.id,
      amountCents,
    });
    setPreviewLoading(false);
    if (res.ok) {
      setAllocation(res.data);
    } else {
      toast(res.error.message, "error");
    }
  };

  const submit = async () => {
    if (!selected || !amountCents || !allocation) return;
    if (allocation.remainder > 0) return toast("超出全部待还总额，请调整金额", "error");
    setSubmitting(true);
    const res = await createRepaymentAction({
      personId: Number(personId),
      targetType: selected.kind,
      targetId: selected.id,
      amountCents,
      repaidAt,
      note: note.trim(),
    });
    setSubmitting(false);
    if (res.ok) {
      toast(
        res.data.count > 1 ? `已记账，自动分配到 ${res.data.count} 笔债务` : "还款已记账",
        "success",
      );
      router.push(`/persons/${res.data.personId}`);
      router.refresh();
    } else {
      toast(res.error.message, "error");
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      {/* 步骤指示 */}
      <div className="flex items-center gap-2">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center gap-2 flex-1">
            <span
              className={cn(
                "h-7 w-7 shrink-0 rounded-full text-xs font-bold flex items-center justify-center transition-base",
                i < step && "bg-success/20 text-success border border-success/40",
                i === step && "gradient-brand text-[#04121a] shadow-[var(--shadow-glow)]",
                i > step && "bg-surface-2 text-text-dim border border-border",
              )}
            >
              {i + 1}
            </span>
            <span className={cn("text-xs md:text-sm truncate", i === step ? "text-text font-medium" : "text-text-dim")}>
              {label}
            </span>
            {i < steps.length - 1 && <span className="flex-1 h-px bg-border" />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <Card className="space-y-4">
          <div>
            <CardTitle>这次是谁还的钱？</CardTitle>
            <CardDescription>选择欠款人后进入下一步</CardDescription>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {persons.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setPersonId(String(p.id));
                  setAllocation(null);
                  setStep(1);
                }}
                className={cn(
                  "glass card-hover p-4 text-left",
                  personId === String(p.id) && "border-accent/50",
                )}
              >
                <span className="h-9 w-9 rounded-full gradient-card border border-accent-2/30 flex items-center justify-center font-bold text-accent-2">
                  {p.name.slice(0, 1)}
                </span>
                <p className="mt-2 font-medium truncate">{p.name}</p>
              </button>
            ))}
          </div>
          {persons.length === 0 && <p className="text-sm text-text-dim">请先在首页添加欠款人</p>}
        </Card>
      )}

      {step === 1 && (
        <Card className="space-y-4">
          <div>
            <CardTitle>还到哪一笔？</CardTitle>
            <CardDescription>列表按建议顺序排列：最早到期账单 → 垫付款 → 其他个欠</CardDescription>
          </div>
          {targetsLoading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-16" />)}</div>
          ) : targets.length === 0 ? (
            <p className="text-sm text-text-dim py-6 text-center">该欠款人没有未结清债务</p>
          ) : (
            <div className="space-y-2">
              {targets.map((t) => (
                <button
                  key={t.key}
                  onClick={() => {
                    setSelectedKey(t.key);
                    setAllocation(null);
                    setStep(2);
                  }}
                  className={cn(
                    "w-full rounded-[var(--radius-md)] border p-4 text-left transition-fast",
                    selectedKey === t.key
                      ? "border-accent/50 bg-accent/8 shadow-[var(--shadow-glow)]"
                      : "border-border bg-surface-2/50 hover:border-white/20",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium flex items-center gap-2">
                      {t.label}
                      {t.kind === "personal" ? <Badge tone="purple">个欠</Badge> : <Badge tone="accent">账单</Badge>}
                    </p>
                    <p className="text-sm tnum text-text-dim">
                      剩余 <span className="text-text font-semibold">¥{formatCents(t.interestRemaining + t.principalRemaining)}</span>
                    </p>
                  </div>
                  {t.interestRemaining > 0 && (
                    <p className="mt-1 text-xs tnum text-text-dim">含利息 ¥{formatCents(t.interestRemaining)}</p>
                  )}
                </button>
              ))}
            </div>
          )}
          <Button variant="ghost" onClick={() => setStep(0)}>上一步</Button>
        </Card>
      )}

      {step === 2 && selected && (
        <>
          <Card className="space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle>输入金额</CardTitle>
                <CardDescription>
                  归还对象：<span className="text-text">{selected.label}</span>
                  <button className="ml-2 text-accent hover:underline" onClick={() => setStep(1)}>更换</button>
                </CardDescription>
              </div>
              <Badge tone="accent">剩余 ¥{formatCents(selected.interestRemaining + selected.principalRemaining)}</Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="还款金额（元）">
                <Input
                  inputMode="decimal"
                  autoFocus
                  value={amountYuan}
                  onChange={(e) => {
                    setAmountYuan(e.target.value);
                    setAllocation(null);
                  }}
                  placeholder="如 2000"
                />
              </Field>
              <Field label="还款日期">
                <Input type="date" value={repaidAt} onChange={(e) => setRepaidAt(e.target.value)} />
              </Field>
            </div>
            <Field label="备注" hint="选填">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="flex gap-3">
              <Button onClick={preview} loading={previewLoading} variant="secondary">
                计算抵扣拆分
              </Button>
              <Button variant="ghost" onClick={() => setStep(1)}>上一步</Button>
            </div>
          </Card>

          {allocation && (
            <Card className="space-y-4 gradient-card border-accent/25">
              <CardTitle>确认抵扣明细</CardTitle>
              <SplitPreview allocation={allocation} selectedKey={selectedKey} />
              <div className="flex gap-3 pt-1">
                <Button size="lg" onClick={submit} loading={submitting} disabled={allocation.remainder > 0}>
                  确认记账
                </Button>
                <Button size="lg" variant="ghost" onClick={() => setAllocation(null)}>重新计算</Button>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
