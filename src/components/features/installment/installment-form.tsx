"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { yuanToCents, percentToBps, bpsToPercent, formatCents, cn } from "@/lib/utils";
import { createInstallmentDebtAction } from "@/server/actions/debt-actions";
import type { Person } from "@/server/db/schema";

interface BillRow {
  periodNo: number;
  dueDate: string;
  principal: string; // 元
  interest: string; // 元
}

type InterestMode = "fixed" | "dynamic";
type DynamicPlan = "equalPrincipal" | "interestOnly" | "equalPayment";

const DYNAMIC_PLAN_OPTIONS: { value: DynamicPlan; label: string; desc: string }[] = [
  { value: "equalPrincipal", label: "等额本金", desc: "每月本金相等，利息随剩余本金逐月下降" },
  { value: "interestOnly", label: "先息后本", desc: "前 N-1 期只还利息，末期一次性还本金" },
  { value: "equalPayment", label: "等额本息", desc: "每月总额固定，利息递减本金递增" },
];

function addMonthsToDate(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1 + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  const day = Math.min(d, lastDay);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function InstallmentForm({ persons }: { persons: Person[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [personId, setPersonId] = useState(searchParams.get("personId") ?? "");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [totalYuan, setTotalYuan] = useState("");
  const [termMonths, setTermMonths] = useState("12");
  const [firstDueDate, setFirstDueDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [interestPerMonth, setInterestPerMonth] = useState("0");
  const [interestMode, setInterestMode] = useState<InterestMode>("fixed");
  const [annualRatePercent, setAnnualRatePercent] = useState("2.6");
  const [dynamicPlan, setDynamicPlan] = useState<DynamicPlan>("equalPrincipal");
  const [note, setNote] = useState("");
  const [bills, setBills] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(false);
  // 客户端水合后再写入今天，避免 SSR/客户端跨午夜的字符串不一致
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    setStartDate(today);
    if (!firstDueDate) setFirstDueDate(today);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totalCents = useMemo(() => yuanToCents(totalYuan), [totalYuan]);

  const generate = () => {
    const term = Number(termMonths);
    if (!totalCents || totalCents <= 0) return toast("请输入正确的本金总额", "error");
    if (!Number.isInteger(term) || term < 1 || term > 360) return toast("期数应为 1-360 的整数", "error");
    if (!firstDueDate) return toast("请选择首期到期日", "error");

    let annualRateBps: number | null = null;
    if (interestMode === "dynamic") {
      annualRateBps = percentToBps(annualRatePercent);
      if (annualRateBps == null || annualRateBps <= 0) return toast("请输入正确的年化利率", "error");
    }

    // 客户端按服务端的同一份逻辑生成预览（仅做 UI 展示；服务端会再算一次以保证权威）
    const monthRate = annualRateBps == null ? 0 : annualRateBps / 120000;
    const planPrincipal: number[] = Array(term).fill(0);
    if (interestMode === "fixed") {
      const perInterest = yuanToCents(interestPerMonth) ?? 0;
      const base = Math.floor(totalCents / term);
      const remainder = totalCents - base * term;
      setBills(
        Array.from({ length: term }, (_, i) => ({
          periodNo: i + 1,
          dueDate: addMonthsToDate(firstDueDate, i),
          principal: ((base + (i === 0 ? remainder : 0)) / 100).toFixed(2),
          interest: (perInterest / 100).toFixed(2),
        })),
      );
      return;
    }
    if (dynamicPlan === "equalPrincipal") {
      const base = Math.floor(totalCents / term);
      const remainder = totalCents - base * term;
      for (let i = 0; i < term; i++) planPrincipal[i] = base + (i === term - 1 ? remainder : 0);
    } else if (dynamicPlan === "interestOnly") {
      for (let i = 0; i < term - 1; i++) planPrincipal[i] = 0;
      planPrincipal[term - 1] = totalCents;
    } else {
      // equalPayment 客户端预览：用相同公式求 X
      let x = 0;
      if (monthRate === 0) {
        x = totalCents / term;
      } else {
        const pow = Math.pow(1 + monthRate, term);
        x = (totalCents * monthRate * pow) / (pow - 1);
      }
      let remaining = totalCents;
      for (let i = 0; i < term - 1; i++) {
        const interest = Math.round(remaining * monthRate);
        const principal = Math.max(0, Math.round(x) - interest);
        const actual = Math.min(principal, remaining);
        planPrincipal[i] = actual;
        remaining -= actual;
      }
      planPrincipal[term - 1] = Math.max(0, remaining);
    }
    let remainingAtStart = totalCents;
    const rows: BillRow[] = [];
    for (let i = 0; i < term; i++) {
      const interest = Math.round(remainingAtStart * monthRate);
      rows.push({
        periodNo: i + 1,
        dueDate: addMonthsToDate(firstDueDate, i),
        principal: (planPrincipal[i] / 100).toFixed(2),
        interest: (interest / 100).toFixed(2),
      });
      remainingAtStart -= planPrincipal[i];
    }
    setBills(rows);
  };

  const updateBill = (idx: number, patch: Partial<BillRow>) => {
    setBills((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  const billsSummary = useMemo(() => {
    let principal = 0;
    let interest = 0;
    for (const b of bills) {
      principal += yuanToCents(b.principal) ?? 0;
      interest += yuanToCents(b.interest) ?? 0;
    }
    return { principal, interest, total: principal + interest };
  }, [bills]);

  const submit = async () => {
    if (!personId) return toast("请选择欠款人", "error");
    if (!title.trim()) return toast("请填写分期名称", "error");
    if (bills.length === 0) return toast("请先生成账单", "error");
    const billInputs = [];
    for (const b of bills) {
      const p = yuanToCents(b.principal);
      const it = yuanToCents(b.interest);
      if (p == null || it == null || p + it <= 0) {
        return toast(`第 ${b.periodNo} 期金额不合法`, "error");
      }
      billInputs.push({ periodNo: b.periodNo, dueDate: b.dueDate, principalCents: p, interestCents: it });
    }
    setLoading(true);
    const annualRateBps = interestMode === "dynamic" ? percentToBps(annualRatePercent) : null;
    const res = await createInstallmentDebtAction({
      personId: Number(personId),
      title: title.trim(),
      source: source.trim(),
      startDate,
      note: note.trim(),
      interestMode,
      annualRateBps,
      dynamicPlan: interestMode === "dynamic" ? dynamicPlan : null,
      bills: billInputs,
    });
    setLoading(false);
    if (res.ok) {
      toast("分期已创建", "success");
      router.push(`/persons/${res.data.personId}`);
      router.refresh();
    } else {
      toast(res.error.message, "error");
    }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <Card className="space-y-4">
        <CardTitle>基本信息</CardTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="欠款人">
            <Select value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">请选择</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="分期名称" hint="如：招行 e 招贷">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="这笔分期叫什么" />
          </Field>
          <Field label="来源银行" hint="选填">
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="如：招商银行" />
          </Field>
          <Field label="放款日期">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
        </div>
        <Field label="备注" hint="选填">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Card>

      <Card className="space-y-4">
        <CardTitle>账单生成</CardTitle>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Field label="本金总额（元）">
            <Input inputMode="decimal" value={totalYuan} onChange={(e) => setTotalYuan(e.target.value)} placeholder="如 24000" />
          </Field>
          <Field label="期数">
            <Input type="number" min={1} max={360} value={termMonths} onChange={(e) => setTermMonths(e.target.value)} />
          </Field>
          {interestMode === "fixed" ? (
            <Field label="每期利息（元）" hint="默认 0，可生成后逐期改">
              <Input inputMode="decimal" value={interestPerMonth} onChange={(e) => setInterestPerMonth(e.target.value)} />
            </Field>
          ) : (
            <Field label="年化利率（%）" hint={`按剩余本金计算 · 月利率 ${(Number(annualRatePercent) / 12).toFixed(4)}%`}>
              <Input inputMode="decimal" value={annualRatePercent} onChange={(e) => setAnnualRatePercent(e.target.value)} />
            </Field>
          )}
          <Field label="首期到期日">
            <Input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} />
          </Field>
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium text-text-dim">利息模式</span>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: "fixed" as const, label: "固定利息", desc: "每期利息相同，生成后逐期可改" },
              { value: "dynamic" as const, label: "年化动态", desc: "按剩余本金 × 年化 ÷ 12 · 还本金后下期利息下降" },
            ]).map((opt) => (
              <button
                type="button"
                key={opt.value}
                onClick={() => setInterestMode(opt.value)}
                className={cn(
                  "rounded-[var(--radius-md)] border p-3 text-left transition-fast",
                  interestMode === opt.value
                    ? "border-accent/60 bg-accent/10 shadow-[var(--shadow-glow)]"
                    : "border-border bg-surface-2 hover:border-white/20",
                )}
              >
                <p className={cn("text-sm font-semibold", interestMode === opt.value && "text-accent")}>{opt.label}</p>
                <p className="mt-0.5 text-[11px] text-text-dim leading-tight">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {interestMode === "dynamic" && (
          <div className="space-y-2">
            <span className="text-sm font-medium text-text-dim">还款方式</span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {DYNAMIC_PLAN_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => setDynamicPlan(opt.value)}
                  className={cn(
                    "rounded-[var(--radius-md)] border p-3 text-left transition-fast",
                    dynamicPlan === opt.value
                      ? "border-accent-2/60 bg-accent-2/10 shadow-[var(--shadow-glow-2)]"
                      : "border-border bg-surface-2 hover:border-white/20",
                  )}
                >
                  <p className={cn("text-sm font-semibold", dynamicPlan === opt.value && "text-accent-2")}>{opt.label}</p>
                  <p className="mt-0.5 text-[11px] text-text-dim leading-tight">{opt.desc}</p>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-text-dim/80">💡 等额本金：每月本金固定，利息按剩余本金逐月下降。先息后本：前 N-1 期只还利息，末期一次性还本金。等额本息：每月总额固定，初期多还利息少还本金。</p>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <Button type="button" variant="secondary" onClick={generate}>
            批量生成账单
          </Button>
          {bills.length > 0 && (
            <p className="text-sm text-text-dim tnum">
              共 {bills.length} 期 · 本金 ¥{formatCents(billsSummary.principal)} · 利息 ¥{formatCents(billsSummary.interest)} ·
              <span className={cn("ml-1", billsSummary.total > 0 ? "text-accent" : "text-danger")}>
                合计 ¥{formatCents(billsSummary.total)}
              </span>
            </p>
          )}
        </div>

        {bills.length > 0 && (
          <div className="overflow-x-auto -mx-5 px-5">
            {interestMode === "dynamic" && (
              <p className="text-[11px] text-text-dim/80 mb-2">⚙️ 当前为初始计划表。实际每期利息会按当时的剩余本金动态计算；提前还本金会让下期利息降低。</p>
            )}
            <table className="w-full min-w-[640px] text-sm mt-2">
              <thead>
                <tr className="text-left text-xs text-text-dim border-b border-border">
                  <th className="py-2 pr-3 font-medium w-14">期号</th>
                  <th className="py-2 pr-3 font-medium">到期日</th>
                  <th className="py-2 pr-3 font-medium">本金（元）</th>
                  <th className="py-2 font-medium">利息（元）</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b, i) => (
                  <tr key={b.periodNo} className="border-b border-border/40">
                    <td className="py-1.5 pr-3 tnum text-text-dim">#{b.periodNo}</td>
                    <td className="py-1.5 pr-3">
                      <Input type="date" value={b.dueDate} onChange={(e) => updateBill(i, { dueDate: e.target.value })} className="h-9" />
                    </td>
                    <td className="py-1.5 pr-3">
                      <Input inputMode="decimal" value={b.principal} onChange={(e) => updateBill(i, { principal: e.target.value })} className="h-9" />
                    </td>
                    <td className="py-1.5">
                      <Input inputMode="decimal" value={b.interest} onChange={(e) => updateBill(i, { interest: e.target.value })} className="h-9" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex gap-3">
        <Button size="lg" onClick={submit} loading={loading}>保存分期</Button>
        <Button size="lg" variant="ghost" onClick={() => router.back()}>取消</Button>
      </div>
    </div>
  );
}
