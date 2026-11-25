import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RoleFormDialog } from "@/components/features/admin/role-form-dialog";
import { DeleteRoleButton } from "@/components/features/admin/delete-role-button";
import { getAuthContext, hasPerm } from "@/server/lib/auth-context";
import { listRolesWithDetails } from "@/server/services/rbac-service";
import { PERMISSION_GROUPS } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const permLabelMap = new Map<string, string>(
  PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => [p.code, p.label] as const)),
);

/** RBAC 角色与权限管理页面 */
export default async function AdminRolesPage() {
  const auth = await getAuthContext();
  if (!hasPerm(auth, "role:manage")) {
    redirect("/");
  }

  const roleList = await listRolesWithDetails();

  return (
    <AppShell>
      <PageHeader
        title="角色权限管理"
        description={`共 ${roleList.length} 个角色 · 支持数据范围（全部客户 / 仅本人）与功能权限矩阵`}
        back="/admin/customers"
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin/customers">
              <Button variant="secondary" size="md">
                返回客户管理
              </Button>
            </Link>
            <RoleFormDialog mode="create" />
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {roleList.map((role) => (
          <Card key={role.id} className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle>{role.name}</CardTitle>
                  <Badge tone={role.dataScope === "all" ? "purple" : "accent"}>
                    {role.dataScope === "all" ? "全部客户数据" : "仅本人数据"}
                  </Badge>
                  {role.isSystem === 1 && <Badge tone="dim">内置</Badge>}
                </div>
                <p className="text-xs text-text-dim">
                  编码：<code className="text-text">{role.code}</code>
                  <span className="mx-2">·</span>
                  关联用户：<span className="text-text tnum">{role.userCount}</span> 人
                </p>
                {role.description && <p className="text-xs text-text-dim/90">{role.description}</p>}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <RoleFormDialog
                  mode="edit"
                  role={{
                    id: role.id,
                    code: role.code,
                    name: role.name,
                    description: role.description,
                    dataScope: role.dataScope,
                    isSystem: role.isSystem,
                    permissions: role.permissions,
                  }}
                />
                <DeleteRoleButton
                  roleId={role.id}
                  roleName={role.name}
                  disabledReason={
                    role.isSystem === 1
                      ? "系统内置角色不可删除"
                      : role.userCount > 0
                        ? "仍有用户绑定该角色"
                        : undefined
                  }
                />
              </div>
            </div>

            <div className="border-t border-border/50 pt-3">
              <p className="text-xs text-text-dim mb-2">已分配权限（{role.permissions.length}）</p>
              {role.permissions.length === 0 ? (
                <p className="text-xs text-text-dim/70">未配置任何功能权限</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {role.permissions.map((code) => (
                    <Badge key={code} tone="dim">
                      {permLabelMap.get(code) ?? code}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
