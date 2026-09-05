"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function RegisterPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        // 注册成功即自动登录
        router.push("/");
        router.refresh();
      } else {
        setError(data.message || "注册失败");
      }
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-6">
      <form onSubmit={submit} className="glass w-full max-w-sm p-8 space-y-5 toast-in">
        <div className="flex flex-col items-center gap-3 mb-2">
          <span className="h-12 w-12 rounded-[var(--radius-md)] gradient-brand shadow-[var(--shadow-glow)]" />
          <h1 className="text-xl font-bold">
            注册<span className="gradient-text">客户账号</span>
          </h1>
          <p className="text-sm text-text-dim">注册后可录入并管理自己的账单</p>
        </div>
        <Input
          type="text"
          placeholder="账号（3-32 位字母/数字/下划线）"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />
        <Input
          type="password"
          placeholder="密码（至少 6 位）"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Input
          type="password"
          placeholder="确认密码"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && <p className="text-sm text-danger text-center">{error}</p>}
        <Button type="submit" className="w-full" size="lg" loading={loading}>
          注册并登录
        </Button>
        <p className="text-xs text-text-dim text-center">
          已有账号？
          <Link href="/login" className="text-accent hover:underline ml-1">
            返回登录
          </Link>
        </p>
      </form>
    </div>
  );
}
