export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export { formatCents, centsToYuan, yuanToCents, bpsToPercent, percentToBps, dailyInterestCents } from "@/server/lib/money";
