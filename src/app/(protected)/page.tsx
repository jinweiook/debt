import Link from "next/link";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { StatCards } from "@/components/features/overview/stat-cards";
import { MonthlyForecastChart } from "@/components/features/overview/monthly-forecast";
import { PersonCard } from "@/components/features/person/person-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { listPersons } from "@/server/services/person-service";
import { overviewStats, monthlyForecast, personStats } from "@/server/services/stats-service";
import { getAuthContext } from "@/server/lib/auth-context";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // 数据隔离：普通客户只看自己的账单；管理员（ownerId=null）看全部
  const auth = await getAuthContext();
  const ownerId = auth?.ownerId ?? null;
  const isAdmin = !!auth?.isAdmin;

  const [persons, overview, forecast] = await Promise.all([
    listPersons(ownerId),
    overviewStats(ownerId),
    monthlyForecast(null, 12, ownerId),
  ]);
  const statsList = await Promise.all(persons.map((p) => personStats(p.id)));

  // 管理员视图：补充每个欠款人的归属客户名
  const ownerNames = new Map<string, string>();
  if (isAdmin) {
    const db = getDb();
    const userRows = await db.select({ id: users.id, username: users.username }).from(users);
    for (const u of userRows) ownerNames.set(u.id, u.username);
  }

  return (
    <AppShell>
      <PageHeader
        title="总览"
        description={`${overview.activePersons} 位欠款人${isAdmin ? " · 管理员视图（全部客户）" : " · 数据实时统计"}`}
        actions={
          <Link href="/persons/new">
            <Button size="md">+ 新增欠款人</Button>
          </Link>
        }
      />

      <div className="space-y-4 md:space-y-6">
        <StatCards stats={overview} />
        <MonthlyForecastChart data={forecast} />

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">欠款人</h2>
            <div className="flex gap-2">
              <Link href="/debts/installment/new">
                <Button variant="secondary" size="sm">+ 分期</Button>
              </Link>
              <Link href="/debts/personal/new">
                <Button variant="secondary" size="sm">+ 个人欠款</Button>
              </Link>
            </div>
          </div>
          {persons.length === 0 ? (
            <Card className="py-14 text-center">
              <p className="text-text-dim">还没有欠款人记录</p>
              <Link href="/persons/new" className="inline-block mt-4">
                <Button>添加第一位欠款人</Button>
              </Link>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
              {persons.map((p, i) => (
                <PersonCard
                  key={p.id}
                  person={p}
                  stats={statsList[i]}
                  ownerName={isAdmin ? (ownerNames.get(p.ownerUserId) ?? `用户#${p.ownerUserId}`) : undefined}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
