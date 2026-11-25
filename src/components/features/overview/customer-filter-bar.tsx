"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatUserDisplayName } from "@/lib/rbac";

export interface CustomerFilterOption {
  userId: string;
  username: string;
  displayName: string | null;
  activePersons: number;
}

export function CustomerFilterBar({
  customers,
  selectedCustomerId,
  currentUserId,
  basePath = "/",
}: {
  customers: CustomerFilterOption[];
  selectedCustomerId: string | null;
  currentUserId: string;
  basePath?: string;
}) {
  const router = useRouter();
  const selected = selectedCustomerId ? customers.find((c) => c.userId === selectedCustomerId) : undefined;

  const onChange = (val: string) => {
    if (!val) {
      router.push(basePath);
    } else {
      router.push(`${basePath}?customerId=${encodeURIComponent(val)}`);
    }
  };

  return (
    <div className="glass p-3.5 md:p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="text-xs font-medium text-text-dim">数据范围：</span>
        <Select
          value={selectedCustomerId ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-auto min-w-52 text-sm"
          aria-label="按客户筛选"
        >
          <option value="">全部客户（含管理员自身）</option>
          {customers.map((c) => (
            <option key={c.userId} value={c.userId}>
              {formatUserDisplayName(c)}
              {c.userId === currentUserId ? " [本人]" : ""} · {c.activePersons}人
            </option>
          ))}
        </Select>
        {selected && (
          <Badge tone="accent">
            当前仅显示：{formatUserDisplayName(selected)}
          </Badge>
        )}
      </div>

      {selected && (
        <Button variant="ghost" size="sm" onClick={() => router.push(basePath)}>
          返回全部客户
        </Button>
      )}
    </div>
  );
}
