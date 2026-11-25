"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import {
  ADMIN_LOCKED_PERMISSIONS,
  PERMISSION_GROUPS,
  type DataScope,
  type PermissionCode,
} from "@/lib/rbac";
import { createRoleAction, updateRoleAction } from "@/server/actions/admin-actions";

export interface EditableRole {
  id: number;
  code: string;
  name: string;
  description: string | null;
  dataScope: DataScope;
  isSystem: number;
  permissions: PermissionCode[];
}

export function RoleFormDialog({
  mode,
  role,
}: {
  mode: "create" | "edit";
  role?: EditableRole;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dataScope, setDataScope] = useState<DataScope>("self");
  const [permissions, setPermissions] = useState<Set<PermissionCode>>(new Set());

  const isBuiltinAdmin = mode === "edit" && role?.code === "admin";

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && role) {
      setCode(role.code);
      setName(role.name);
      setDescription(role.description ?? "");
      setDataScope(role.dataScope);
      setPermissions(new Set(role.permissions));
    } else {
      setCode("");
      setName("");
      setDescription("");
      setDataScope("self");
      setPermissions(new Set(["overview:read", "person:read", "debt:read"]));
    }
  }, [open, mode, role]);

  const togglePerm = (permCode: PermissionCode, checked: boolean) => {
    if (isBuiltinAdmin && (ADMIN_LOCKED_PERMISSIONS as readonly string[]).includes(permCode)) {
      return;
    }
    setPermissions((prev) => {
      const next = new Set(prev);
      if (checked) next.add(permCode);
      else next.delete(permCode);
      return next;
    });
  };

  const toggleGroup = (groupCodes: readonly PermissionCode[], checked: boolean) => {
    setPermissions((prev) => {
      const next = new Set(prev);
      for (const c of groupCodes) {
        if (!checked && isBuiltinAdmin && (ADMIN_LOCKED_PERMISSIONS as readonly string[]).includes(c)) {
          continue;
        }
        if (checked) next.add(c);
        else next.delete(c);
      }
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const payload = {
      code,
      name,
      description,
      dataScope,
      permissions: [...permissions],
    };
    const res =
      mode === "create"
        ? await createRoleAction(payload)
        : await updateRoleAction(role!.id, payload);
    setLoading(false);

    if (res.ok) {
      toast(mode === "create" ? `已新增角色 ${name}` : `已更新角色 ${name}`, "success");
      setOpen(false);
      router.refresh();
    } else {
      toast(res.error.message, "error");
    }
  };

  return (
    <>
      {mode === "create" ? (
        <Button size="md" onClick={() => setOpen(true)}>
          + 新增角色
        </Button>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          配置权限
        </Button>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={mode === "create" ? "新增 RBAC 角色" : `配置角色 · ${role?.name ?? ""}`}
        className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto"
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="角色编码" hint={mode === "edit" ? "创建后不可更改" : "2-32 位小写字母、数字或下划线"}>
              <Input
                required
                disabled={mode === "edit"}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="如 operator"
              />
            </Field>
            <Field label="角色名称">
              <Input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如 客服专员"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field
              label="数据视野范围"
              hint={isBuiltinAdmin ? "超级管理员必须保留「全部客户」" : "决定该角色可看全站还是仅本人"}
            >
              <Select
                disabled={isBuiltinAdmin}
                value={dataScope}
                onChange={(e) => setDataScope(e.target.value === "all" ? "all" : "self")}
              >
                <option value="self">仅本人数据（普通客户隔离）</option>
                <option value="all">全部客户数据（含自己与所有客户）</option>
              </Select>
            </Field>
            <Field label="角色说明" hint="选填">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="该角色的职责说明"
              />
            </Field>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text-dim">功能权限矩阵</span>
              <span className="text-xs text-text-dim tnum">已选 {permissions.size} 项</span>
            </div>
            <div className="space-y-3">
              {PERMISSION_GROUPS.map((group) => {
                const groupCodes = group.permissions.map((p) => p.code);
                const allInGroup = groupCodes.every((c) => permissions.has(c));
                return (
                  <div
                    key={group.key}
                    className="rounded-[var(--radius-md)] border border-border bg-surface-2/50 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between border-b border-border/50 pb-1.5">
                      <span className="text-xs font-semibold text-accent">{group.label}</span>
                      <button
                        type="button"
                        onClick={() => toggleGroup(groupCodes, !allInGroup)}
                        className="text-xs text-text-dim hover:text-accent transition-fast"
                      >
                        {allInGroup ? "取消全选" : "全选本组"}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {group.permissions.map((perm) => {
                        const locked =
                          isBuiltinAdmin && (ADMIN_LOCKED_PERMISSIONS as readonly string[]).includes(perm.code);
                        return (
                          <label
                            key={perm.code}
                            className="flex items-start gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 hover:bg-white/[0.03] cursor-pointer"
                          >
                            <Checkbox
                              checked={permissions.has(perm.code)}
                              onChange={(c) => togglePerm(perm.code, c)}
                              ariaLabel={perm.label}
                            />
                            <div className="min-w-0 leading-tight">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-medium">{perm.label}</span>
                                {locked && <Badge tone="purple">锁定</Badge>}
                              </div>
                              <p className="text-[11px] text-text-dim mt-0.5">{perm.desc}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" loading={loading}>
              {mode === "create" ? "确认创建" : "保存配置"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
