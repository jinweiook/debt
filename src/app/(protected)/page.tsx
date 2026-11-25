import Link from "next/link";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { StatCards } from "@/components/features/overview/stat-cards";
import { MonthlyForecastChart } from "@/components/features/overview/monthly-forecast";
import { CustomerOverviewSection } from "@/components/features/overview/customer-overview-section";
import { CustomerFilterBar } from "@/components/features/overview/customer-filter-bar";
import { PersonCard } from "@/components/features/person/person-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MoneyText } from "@/components/ui/money-text";
import { Badge } from "@/components/ui/badge";
import { listPersons } from "@/server/services/person-service";
import { customerOverviews, monthlyForecast, overviewStats, personStats } from "@/server/services/stats-service";
import { getAuthContext, hasPerm } from "@/server/lib/auth-context";
import { formatUserDisplayName } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const { customerId } = await searchParams;
  const auth = await getAuthContext();
  if (!auth) return null;

  if (!hasPerm(auth, "overview:read")) {
    return (
      <AppShell>
        <PageHeader title="总览" description="您当前角色未开启总览查看权限" />
        <Card className="py-12 text-center text-sm text-text-dim">
          请联系管理员在「角色权限管理」中配置相应权限，或通过左侧导航访问可用功能。
        </Card>
      </AppShell>
    );
  }

  const canViewAllCustomers = auth.dataScope === "all" && hasPerm(auth, "overview:all_customers");
  const canAssignOwner = hasPerm(auth, "person:assign_owner");
  const canCreatePerson = hasPerm(auth, "person:create");
  const canCreateDebt = hasPerm(auth, "debt:create");

  // 全站客户概览（仅管理员/全局视野查）
  const allCustomers = canViewAllCustomers ? await customerOverviews() : [];
  const ownerSelectOptions = canAssignOwner
    ? allCustomers.map((c) => ({ id: c.userId, username: c.username, displayName: c.displayName }))
    : undefined;
  const selectedCustomer =
    canViewAllCustomers && customerId
      ? allCustomers.find((c) => c.userId === customerId)
      : undefined;

  // 普通客户强制锁定为自己的 userId，绝不采信 URL 中的 customerId
  const effectiveOwnerId = canViewAllCustomers
    ? (selectedCustomer ? selectedCustomer.userId : null)
    : auth.userId;

  const [persons, overview, forecast] = await Promise.all([
    listPersons(effectiveOwnerId),
    overviewStats(effectiveOwnerId),
    monthlyForecast(null, 12, effectiveOwnerId),
  ]);
  const statsList = await Promise.all(persons.map((p) => personStats(p.id)));
  const statsByPersonId = new Map(persons.map((p, i) => [p.id, statsList[i]]));

  const customerMap = new Map(allCustomers.map((c) => [c.userId, c]));
  const newPersonHref = selectedCustomer ? `/persons/new?customerId=${selectedCustomer.userId}` : "/persons/new";

  const pageDescription = selectedCustomer
    ? `${formatUserDisplayName(selectedCustomer)} · ${overview.activePersons} 位欠款人`
    : canViewAllCustomers
      ? `${overview.activePersons} 位欠款人 · 全部客户总览（共 ${allCustomers.length} 个账号）`
      : `${overview.activePersons} 位欠款人 · 我的账单总览`;

  return (
    <AppShell>
      <PageHeader
        title="总览"
        description={pageDescription}
        actions={
          canCreatePerson ? (
            <Link href={newPersonHref}>
              <Button size="md">+ 新增欠款人</Button>
            </Link>
          ) : undefined
        }
      />

      <div className="space-y-4 md:space-y-6">
        {canViewAllCustomers && (
          <CustomerFilterBar
            customers={allCustomers.map((c) => ({
              userId: c.userId,
              username: c.username,
              displayName: c.displayName,
              activePersons: c.activePersons,
            }))}
            selectedCustomerId={selectedCustomer?.userId ?? null}
            currentUserId={auth.userId}
          />
        )}

        <StatCards stats={overview} />

        {/* 管理员查看「全部客户」时，按客户统计各个人的账单总览（含 admin 自己） */}
        {canViewAllCustomers && !selectedCustomer && (
          <CustomerOverviewSection customers={allCustomers} currentUserId={auth.userId} />
        )}

        <MonthlyForecastChart data={forecast} />

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">
              {selectedCustomer ? `${selectedCustomer.displayName || selectedCustomer.username} 的欠款人` : "欠款人"}
            </h2>
            {canCreateDebt && (
              <div className="flex gap-2">
                <Link href="/debts/installment/new">
                  <Button variant="secondary" size="sm">+ 分期</Button>
                </Link>
                <Link href="/debts/personal/new">
                  <Button variant="secondary" size="sm">+ 个人欠款</Button>
                </Link>
              </div>
            )}
          </div>

          {persons.length === 0 ? (
            <Card className="py-14 text-center">
              <p className="text-text-dim">
                {selectedCustomer ? "该客户名下还没有欠款人记录" : "还没有欠款人记录"}
              </p>
              {canCreatePerson && (
                <Link href={newPersonHref} className="inline-block mt-4">
                  <Button>添加第一位欠款人</Button>
                </Link>
              )}
            </Card>
          ) : canViewAllCustomers && !selectedCustomer ? (
            /* 管理员全站视图：欠款人按客户分组展示 */
            <div className="space-y-5">
              {allCustomers
                .map((cust) => ({
                  cust,
                  groupPersons: persons.filter((p) => p.ownerUserId === cust.userId),
                }))
                .filter((g) => g.groupPersons.length > 0)
                .map(({ cust, groupPersons }) => (
                  <div key={cust.userId} className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/?customerId=${cust.userId}`}
                          className="text-sm font-semibold hover:text-accent transition-fast"
                        >
                          {formatUserDisplayName(cust)}
                        </Link>
                        {cust.userId === auth.userId && <Badge tone="purple">本人</Badge>}
                        <span className="text-xs text-text-dim tnum">
                          {groupPersons.length} 位欠款人 · 合计待还
                        </span>
                        <MoneyText cents={cust.totalOutstanding} className="text-sm" prefix="" />
                      </div>
                      {canCreatePerson && (
                        <Link
                          href={`/persons/new?customerId=${cust.userId}`}
                          className="text-xs text-accent hover:underline"
                        >
                          + 为其新增欠款人
                        </Link>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                      {groupPersons.map((p) => (
                        <PersonCard
                          key={p.id}
                          person={p}
                          stats={statsByPersonId.get(p.id)!}
                          ownerName={formatUserDisplayName(cust)}
                          customers={ownerSelectOptions}
                        />
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
              {persons.map((p) => {
                const owner = customerMap.get(p.ownerUserId);
                return (
                  <PersonCard
                    key={p.id}
                    person={p}
                    stats={statsByPersonId.get(p.id)!}
                    ownerName={canViewAllCustomers && owner ? formatUserDisplayName(owner) : undefined}
                    customers={ownerSelectOptions}
                  />
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
