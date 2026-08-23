import { Badge } from "@/components/ui/badge";
import { bpsToPercent } from "@/lib/utils";
import type { DebtAccount } from "@/server/db/schema";

export function InterestBadge({ account }: { account: DebtAccount }) {
  if (account.interestType === "fixed") {
    return <Badge tone="purple">固定利息</Badge>;
  }
  if (account.interestType === "annual") {
    return <Badge tone="purple">年化 {bpsToPercent(account.annualRateBps ?? 0)}%</Badge>;
  }
  return <Badge tone="dim">无息</Badge>;
}
