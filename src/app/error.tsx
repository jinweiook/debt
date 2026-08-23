"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-dvh flex items-center justify-center p-6">
      <Card className="max-w-md w-full text-center py-10 space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full bg-danger/15 border border-danger/30 flex items-center justify-center text-danger text-xl">
          !
        </div>
        <h1 className="text-lg font-semibold">数据加载失败</h1>
        <p className="text-sm text-text-dim px-6">
          可能是数据库连接中断或配置有误。请检查数据库服务是否可达、环境变量是否正确，然后重试。
        </p>
        <div className="flex justify-center gap-3">
          <Button onClick={reset}>重试</Button>
          <Button variant="secondary" onClick={() => (window.location.href = "/api/health")}>
            查看健康检查
          </Button>
        </div>
      </Card>
    </div>
  );
}
