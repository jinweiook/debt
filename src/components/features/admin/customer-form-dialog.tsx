"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { createCustomerAction, updateCustomerAction } from "@/server/actions/admin-actions";

export interface RoleOption {
  id: number;
  code: string;
  name: string;
  dataScope: "all" | "self";
}

export interface EditableCustomer {
  id: string;
  username: string;
  displayName: string | null;
  phone: string | null;
  note: string | null;
  status: string;
  roleIds: number[];
}

export function CustomerFormDialog({
  mode,
  roles,
  user,
  trigger,
}: {
  mode: "create" | "edit";
  roles: RoleOption[];
  user?: EditableCustomer;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const defaultRoleId = roles.find((r) => r.code === "user")?.id ?? roles[0]?.id;

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"active" | "disabled">("active");
  const [selectedRoleIds, setSelectedRoleIds] = useState<number[]>([]);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && user) {
      setUsername(user.username);
      setPassword("");
      setDisplayName(user.displayName ?? "");
      setPhone(user.phone ?? "");
      setNote(user.note ?? "");
      setStatus(user.status === "disabled" ? "disabled" : "active");
      setSelectedRoleIds(user.roleIds.length > 0 ? user.roleIds : defaultRoleId ? [defaultRoleId] : []);
    } else {
      setUsername("");
      setPassword("");
      setDisplayName("");
      setPhone("");
      setNote("");
      setStatus("active");
      setSelectedRoleIds(defaultRoleId ? [defaultRoleId] : []);
    }
  }, [open, mode, user, defaultRoleId]);

  const toggleRole = (roleId: number, checked: boolean) => {
    setSelectedRoleIds((prev) =>
      checked ? [...new Set([...prev, roleId])] : prev.filter((id) => id !== roleId),
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRoleIds.length === 0) {
      toast("请至少选择一个角色", "error");
      return;
    }

    setLoading(true);
    const res =
      mode === "create"
        ? await createCustomerAction({
            username,
            password,
            displayName,
            phone,
            note,
            status,
            roleIds: selectedRoleIds,
          })
        : await updateCustomerAction(user!.id, {
            username,
            displayName,
            phone,
            note,
            status,
            roleIds: selectedRoleIds,
          });
    setLoading(false);

    if (res.ok) {
      toast(mode === "create" ? `已新增用户 ${username}` : `已更新用户 ${username}`, "success");
      setOpen(false);
      router.refresh();
    } else {
      toast(res.error.message, "error");
    }
  };

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : mode === "create" ? (
        <Button size="md" onClick={() => setOpen(true)}>
          + 新增用户
        </Button>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          编辑
        </Button>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={mode === "create" ? "新增用户" : `编辑用户 · ${user?.username ?? ""}`}
        className="sm:max-w-lg max-h-[90dvh] overflow-y-auto"
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="登录账号" hint="3-32 位字母、数字或下划线">
              <Input
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="如 zhangsan"
              />
            </Field>
            <Field label="客户姓名" hint="支持中文，用于界面展示">
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="如 张三"
              />
            </Field>
          </div>

          {mode === "create" && (
            <Field label="初始密码" hint="6-64 位">
              <Input
                type="password"
                required
                minLength={6}
                maxLength={64}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="设置登录密码"
              />
            </Field>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="联系电话" hint="选填">
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="手机号 / 微信"
              />
            </Field>
            <Field label="账号状态" hint={status === "disabled" ? "禁用后立即踢下线" : undefined}>
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value === "disabled" ? "disabled" : "active")}
              >
                <option value="active">正常（允许登录）</option>
                <option value="disabled">已禁用（禁止登录）</option>
              </Select>
            </Field>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-text-dim">分配角色（RBAC）</span>
            <div className="grid grid-cols-1 gap-2 rounded-[var(--radius-md)] border border-border bg-surface-2/60 p-3">
              {roles.map((r) => {
                const checked = selectedRoleIds.includes(r.id);
                return (
                  <label
                    key={r.id}
                    className="flex items-center justify-between gap-2 cursor-pointer py-1"
                  >
                    <div className="flex items-center gap-2.5">
                      <Checkbox
                        checked={checked}
                        onChange={(c) => toggleRole(r.id, c)}
                        ariaLabel={`分配角色 ${r.name}`}
                      />
                      <span className="text-sm font-medium">{r.name}</span>
                      <span className="text-xs text-text-dim">({r.code})</span>
                    </div>
                    <Badge tone={r.dataScope === "all" ? "purple" : "accent"}>
                      {r.dataScope === "all" ? "全部客户数据" : "仅本人数据"}
                    </Badge>
                  </label>
                );
              })}
            </div>
          </div>

          <Field label="备注" hint="选填">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="客户背景、开户说明等"
            />
          </Field>

          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" loading={loading}>
              {mode === "create" ? "确认创建" : "保存修改"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
