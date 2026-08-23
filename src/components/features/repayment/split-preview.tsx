import { MoneyText } from "@/components/ui/money-text";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Allocation } from "@/lib/repayment-split";

/** 先息后本拆分预览：逐笔展示分配明细 */
export function SplitPreview({ allocation, selectedKey }: { allocation: Allocation; selectedKey?: string }) {
  if (allocation.results.length === 0) return null;
  return (
    <div className="space-y-2.5">
      {allocation.results.map((r) => {
        const isSelected = r.key === selectedKey;
        return (
          <div
            key={r.key}
            className={cn(
              "rounded-[var(--radius-md)] border p-4 transition-base",
              isSelected
                ? "border-accent/50 bg-accent/8 shadow-[var(--shadow-glow)]"
                : "border-border bg-surface-2/60",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium flex items-center gap-2">
                {r.label}
                {isSelected && <Badge tone="accent">本次选择</Badge>}
                {r.kind === "personal" && <Badge tone="purple">个人欠款</Badge>}
              </p>
              <MoneyText cents={r.applied} className={cn("text-lg", isSelected && "text-accent")} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-[var(--radius-sm)] bg-bg/60 px-2.5 py-1.5 tnum text-text-dim">
                利息抵扣 <span className="text-text">{`¥${(r.interestPart / 100).toFixed(2)}`}</span>
              </div>
              <div className="rounded-[var(--radius-sm)] bg-bg/60 px-2.5 py-1.5 tnum text-text-dim">
                本金抵扣 <span className="text-text">{`¥${(r.principalPart / 100).toFixed(2)}`}</span>
              </div>
            </div>
          </div>
        );
      })}
      {allocation.remainder > 0 && (
        <p className="text-sm text-danger">
          超出该欠款人全部待还总额 ¥{(allocation.remainder / 100).toFixed(2)}，请减少还款金额
        </p>
      )}
      {allocation.results.length > 1 && (
        <p className="text-xs text-text-dim">
          金额超出所选目标，已按系统建议顺序（最早到期账单 → 垫付款 → 其他个欠）自动分配到 {allocation.results.length} 笔。
        </p>
      )}
    </div>
  );
}
