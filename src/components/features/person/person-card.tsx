import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MoneyText } from "@/components/ui/money-text";
import type { Person } from "@/server/db/schema";
import type { PersonStats } from "@/server/services/stats-service";

export function PersonCard({
  person,
  stats,
  ownerName,
}: {
  person: Person;
  stats: PersonStats;
  /** 管理员视图下的归属客户名（普通客户不显示） */
  ownerName?: string;
}) {
  return (
    <Link href={`/persons/${person.id}`}>
      <Card hover className="h-full">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <span className="h-10 w-10 shrink-0 rounded-full gradient-card border border-accent-2/30 flex items-center justify-center text-base font-bold text-accent-2">
              {person.name.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <p className="font-semibold truncate">{person.name}</p>
              {ownerName ? <p className="text-xs text-text-dim truncate">客户：{ownerName}</p> : person.note && <p className="text-xs text-text-dim truncate">{person.note}</p>}
            </div>
          </div>
          {stats.totalOutstanding <= 0 ? (
            <Badge tone="success">已结清</Badge>
          ) : (
            <Badge tone="accent">欠款中</Badge>
          )}
        </div>
        <div className="mt-4">
          <p className="text-xs text-text-dim">总欠款</p>
          <MoneyText cents={stats.totalOutstanding} gradient className="text-xl md:text-2xl" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-[var(--radius-sm)] bg-surface-2/70 px-2.5 py-2">
            <p className="text-text-dim">银行待还</p>
            <MoneyText cents={stats.installmentRemaining} className="text-sm" prefix="" />
          </div>
          <div className="rounded-[var(--radius-sm)] bg-surface-2/70 px-2.5 py-2">
            <p className="text-text-dim">个欠剩余</p>
            <MoneyText cents={stats.personalRemaining} className="text-sm" prefix="" />
          </div>
        </div>
      </Card>
    </Link>
  );
}
