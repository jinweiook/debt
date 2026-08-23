"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export function Tabs({
  tabs,
  defaultValue,
  onChange,
}: {
  tabs: { value: string; label: string; content: React.ReactNode }[];
  defaultValue?: string;
  onChange?: (v: string) => void;
}) {
  const [active, setActive] = useState(defaultValue ?? tabs[0]?.value);
  return (
    <div>
      <div className="flex gap-1 p-1 rounded-[var(--radius-md)] bg-surface-2/60 border border-border overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.value}
            onClick={() => {
              setActive(t.value);
              onChange?.(t.value);
            }}
            className={cn(
              "flex-1 min-w-max px-4 h-9 rounded-[var(--radius-sm)] text-sm font-medium transition-fast whitespace-nowrap",
              active === t.value
                ? "gradient-brand text-[#04121a] shadow-[0_2px_12px_rgb(0_229_255/0.25)]"
                : "text-text-dim hover:text-text",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4">{tabs.find((t) => t.value === active)?.content}</div>
    </div>
  );
}
