import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MoneyText } from "@/components/ui/money-text";
import { getAuthContext } from "@/server/lib/auth-context";
import { getDb } from "@/server/db/client";
import { persons, users } from "@/server/db/schema";
import { personStats } from "@/server/services/stats-service";

export const dynamic = "force-dynamic";

/** 客户管理（仅管理员）：查看注册客户与各客户名下欠款人、总欠款 */
export default async function AdminCustomersPage() {
  const auth = await getAuthContext();
  if (!auth?.isAdmin) {
    redirect("/");
  }

  const db = getDb();
  const [userRows, personRows] = await Promise.all([
    db.select().from(users).orderBy(asc(users.id)),
    db.select().from(persons),
  ]);

  // 每个客户名下的欠款人与总欠款
  const statsByUser = new Map<string, { personCount: number; totalOutstanding: number }>();
  const activePersons = personRows.filter((p) => p.status === "active");
  const statsList = await Promise.all(activePersons.map((p) => personStats(p.id)));
  for (let i = 0; i < activePersons.length; i++) {
    const ownerId = activePersons[i].ownerUserId;
    const cur = statsByUser.get(ownerId) ?? { personCount: 0, totalOutstanding: 0 };
    cur.personCount += 1;
    cur.totalOutstanding += statsList[i].totalOutstanding;
    statsByUser.set(ownerId, cur);
  }

  return (
    <AppShell>
      <PageHeader
        title="客户管理"
        description={`${userRows.length} 个账号 · ${personRows.filter((p) => p.status === "active").length} 位欠款人`}
        back="/"
      />
      <Card>
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-text-dim border-b border-border">
                <th className="py-2.5 pr-3 font-medium">账号</th>
                <th className="py-2.5 pr-3 font-medium">角色</th>
                <th className="py-2.5 pr-3 font-medium">状态</th>
                <th className="py-2.5 pr-3 font-medium text-right">欠款人数</th>
                <th className="py-2.5 pr-3 font-medium text-right">名下总欠款</th>
                <th className="py-2.5 font-medium">注册时间</th>
              </tr>
            </thead>
            <tbody>
              {userRows.map((u) => {
                const s = statsByUser.get(u.id) ?? { personCount: 0, totalOutstanding: 0 };
                return (
                  <tr key={u.id} className="border-b border-border/50">
                    <td className="py-3 pr-3 font-medium">{u.username}</td>
                    <td className="py-3 pr-3">
                      {u.role === "admin" ? <Badge tone="purple">管理员</Badge> : <Badge tone="accent">客户</Badge>}
                    </td>
                    <td className="py-3 pr-3">
                      {u.status === "active" ? <Badge tone="success">正常</Badge> : <Badge tone="danger">已禁用</Badge>}
                    </td>
                    <td className="py-3 pr-3 text-right tnum">{s.personCount}</td>
                    <td className="py-3 pr-3 text-right">
                      <MoneyText cents={s.totalOutstanding} prefix="" />
                    </td>
                    <td className="py-3 text-text-dim tnum text-xs">{u.createdAt.toISOString().slice(0, 10)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
