import Link from "next/link";
import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MoneyText } from "@/components/ui/money-text";
import { ResetPasswordDialog } from "@/components/features/admin/reset-password-dialog";
import { CustomerFormDialog } from "@/components/features/admin/customer-form-dialog";
import { getAuthContext, hasPerm } from "@/server/lib/auth-context";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { getUserRoleBindingsMap, listRolesWithDetails } from "@/server/services/rbac-service";
import { customerOverviews } from "@/server/services/stats-service";

export const dynamic = "force-dynamic";

/** 客户管理：查看账号、新增/编辑用户、分配 RBAC 角色、查看名下总欠款 */
export default async function AdminCustomersPage() {
  const auth = await getAuthContext();
  if (!hasPerm(auth, "user:read")) {
    redirect("/");
  }

  const db = getDb();
  const [userRows, roleDetails, userBindings, overviews] = await Promise.all([
    db.select().from(users).orderBy(asc(users.createdAt)),
    listRolesWithDetails(),
    getUserRoleBindingsMap(),
    customerOverviews(),
  ]);

  const overviewByUser = new Map(overviews.map((o) => [o.userId, o]));
  const roleOptions = roleDetails.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    dataScope: r.dataScope,
  }));

  const canCreate = hasPerm(auth, "user:create");
  const canUpdate = hasPerm(auth, "user:update");
  const canResetPwd = hasPerm(auth, "user:reset_password");
  const canManageRoles = hasPerm(auth, "role:manage");
  const canViewAllOverviews = hasPerm(auth, "overview:all_customers") && auth?.dataScope === "all";

  const totalActivePersons = overviews.reduce((s, o) => s + o.activePersons, 0);

  return (
    <AppShell>
      <PageHeader
        title="客户管理"
        description={`${userRows.length} 个账号 · ${totalActivePersons} 位欠款人`}
        back="/"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManageRoles && (
              <Link href="/admin/roles">
                <Button variant="secondary" size="md">
                  角色权限管理
                </Button>
              </Link>
            )}
            {canCreate && <CustomerFormDialog mode="create" roles={roleOptions} />}
          </div>
        }
      />

      <Card>
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="text-left text-xs text-text-dim border-b border-border">
                <th className="py-2.5 pr-3 font-medium">客户 / 账号</th>
                <th className="py-2.5 pr-3 font-medium">联系方式</th>
                <th className="py-2.5 pr-3 font-medium">角色</th>
                <th className="py-2.5 pr-3 font-medium">状态</th>
                <th className="py-2.5 pr-3 font-medium text-right">欠款人数</th>
                <th className="py-2.5 pr-3 font-medium text-right">名下总欠款</th>
                <th className="py-2.5 pr-3 font-medium">最后登录</th>
                <th className="py-2.5 pr-3 font-medium">创建时间</th>
                <th className="py-2.5 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {userRows.map((u) => {
                const s = overviewByUser.get(u.id);
                const boundRoles = userBindings.get(u.id) ?? [];
                const roleIds =
                  boundRoles.length > 0
                    ? boundRoles.map((r) => r.id)
                    : roleOptions.filter((r) => r.code === u.role).map((r) => r.id);

                return (
                  <tr key={u.id} className="border-b border-border/50 transition-fast hover:bg-white/[0.03]">
                    <td className="py-3 pr-3">
                      <div className="font-medium">
                        {u.displayName || u.username}
                        {u.id === auth?.userId && (
                          <span className="ml-1.5 text-[11px] text-accent">(当前)</span>
                        )}
                      </div>
                      <div className="text-xs text-text-dim">
                        @{u.username}
                        {u.note && <span className="ml-2 text-text-dim/70">· {u.note}</span>}
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-xs text-text-dim tnum">{u.phone || "-"}</td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {(boundRoles.length > 0
                          ? boundRoles
                          : [{ id: 0, code: u.role, name: u.role === "admin" ? "超级管理员" : "普通客户", dataScope: u.role === "admin" ? "all" : "self" }]
                        ).map((r) => (
                          <Badge key={`${u.id}-${r.code}`} tone={r.dataScope === "all" ? "purple" : "accent"}>
                            {r.name}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      {u.status === "active" ? (
                        <Badge tone="success">正常</Badge>
                      ) : (
                        <Badge tone="danger">已禁用</Badge>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-right tnum">{s?.activePersons ?? 0}</td>
                    <td className="py-3 pr-3 text-right">
                      <MoneyText cents={s?.totalOutstanding ?? 0} prefix="" />
                    </td>
                    <td className="py-3 pr-3 text-text-dim tnum text-xs">
                      {u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 16).replace("T", " ") : "从未登录"}
                    </td>
                    <td className="py-3 pr-3 text-text-dim tnum text-xs">{u.createdAt.toISOString().slice(0, 10)}</td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end items-center gap-1.5">
                        {canViewAllOverviews && (
                          <Link href={`/?customerId=${u.id}`}>
                            <Button variant="ghost" size="sm">
                              查看账单
                            </Button>
                          </Link>
                        )}
                        {canUpdate && (
                          <CustomerFormDialog
                            mode="edit"
                            roles={roleOptions}
                            user={{
                              id: u.id,
                              username: u.username,
                              displayName: u.displayName ?? null,
                              phone: u.phone ?? null,
                              note: u.note ?? null,
                              status: u.status,
                              roleIds,
                            }}
                          />
                        )}
                        {canResetPwd && <ResetPasswordDialog userId={u.id} username={u.username} />}
                      </div>
                    </td>
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
