import { Card, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/utils";
import type { MonthlyForecast } from "@/server/services/stats-service";
import { cn } from "@/lib/utils";

/** 未来每月预计应收：纯 CSS 条形图 */
export function MonthlyForecastChart({ data }: { data: MonthlyForecast[] }) {
  const max = Math.max(...data.map((d) => d.amountCents), 1);
  return (
    <Card>
      <CardTitle>未来每月预计应收</CardTitle>
      <div className="mt-5 flex items-end gap-1.5 md:gap-2.5 h-36">
        {data.map((d, i) => {
          const heightPct = Math.max((d.amountCents / max) * 100, d.amountCents > 0 ? 6 : 1.5);
          return (
            <div key={d.month} className="flex-1 flex flex-col items-center gap-1.5 min-w-0 group">
              <span className="text-[10px] tnum text-text-dim opacity-0 group-hover:opacity-100 transition-fast">
                {d.amountCents > 0 ? formatCents(d.amountCents) : ""}
              </span>
              <div
                className={cn(
                  "w-full rounded-t-md transition-base",
                  d.amountCents > 0
                    ? "gradient-brand opacity-80 group-hover:opacity-100 group-hover:shadow-[var(--shadow-glow)]"
                    : "bg-surface-2",
                  i === 0 && d.amountCents > 0 && "opacity-100 shadow-[var(--shadow-glow)]",
                )}
                style={{ height: `${heightPct}%` }}
              />
              <span className="text-[10px] text-text-dim tnum">{d.month.slice(2)}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
