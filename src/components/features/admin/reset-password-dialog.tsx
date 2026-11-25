"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { resetCustomerPasswordAction } from "@/server/actions/admin-actions";

export function ResetPasswordDialog({ userId, username }: { userId: string; username: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await resetCustomerPasswordAction(userId, password);
    setLoading(false);
    if (res.ok) {
      toast(`已重置 ${username} 的密码，其旧会话已全部失效`, "success");
      setOpen(false);
      setPassword("");
      router.refresh();
    } else {
      toast(res.error.message, "error");
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>重置密码</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`重置密码 · ${username}`}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="新密码" hint="6-64 位；重置后该用户的旧登录会话立即失效">
            <Input
              type="text"
              required
              minLength={6}
              maxLength={64}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入新密码"
            />
          </Field>
          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>取消</Button>
            <Button type="submit" loading={loading}>确认重置</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
