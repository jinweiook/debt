import { Card } from "@/components/ui/card";
import { MoneyText } from "@/components/ui/money-text";
import type { PersonStats } from "@/server/services/stats-service";

export function StatCards({ stats }: { stats: PersonStats }) {
  const items = [
    { label: "总欠款", value: stats.totalOutstanding, gradient: true, accent: true },
    { label: "银行剩余待还", value: stats.installmentRemaining },
    { label: "个人欠款剩余", value: stats.personalRemaining },
    { label: "累计已收", value: stats.totalReceived },
    { label: "累计垫付", value: stats.totalAdvanced },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
      {items.map((item) => (
        <Card
          key={item.label}
          hover
          className={item.accent ? "gradient-card border-accent/25" : undefined}
        >
          <p className="text-xs md:text-sm text-text-dim">{item.label}</p>
          <MoneyText
            cents={item.value}
            gradient={item.gradient}
            className="mt-2 block text-lg md:text-2xl"
          />
        </Card>
      ))}
    </div>
  );
}
