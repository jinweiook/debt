"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        router.push(searchParams.get("next") ?? "/");
        router.refresh();
      } else {
        setError(data.message || "登录失败");
      }
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="glass w-full max-w-sm p-8 space-y-5 toast-in">
      <div className="flex flex-col items-center gap-3 mb-2">
        <span className="h-12 w-12 rounded-[var(--radius-md)] gradient-brand shadow-[var(--shadow-glow)]" />
        <h1 className="text-xl font-bold">
          借还款<span className="gradient-text">规划</span>
        </h1>
        <p className="text-sm text-text-dim">请输入账号和密码</p>
      </div>
      <Input
        type="text"
        placeholder="账号"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoFocus
      />
      <Input
        type="password"
        placeholder="密码"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="text-sm text-danger text-center">{error}</p>}
      <Button type="submit" className="w-full" size="lg" loading={loading}>
        登录
      </Button>
      <p className="text-xs text-text-dim text-center">默认账号 admin，首次使用请初始化数据库</p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-dvh flex items-center justify-center p-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
