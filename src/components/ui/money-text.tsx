import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/utils";

/** 金额展示：tabular-nums 等宽数字，可选渐变大字 */
export function MoneyText({
  cents,
  className,
  gradient,
  prefix = "¥",
}: {
  cents: number;
  className?: string;
  gradient?: boolean;
  prefix?: string;
}) {
  return (
    <span className={cn("tnum font-semibold", gradient && "gradient-text", className)}>
      {prefix}
      {formatCents(cents)}
    </span>
  );
}
