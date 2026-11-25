"use client";

import { cn } from "@/lib/utils";

export function Checkbox({
  checked,
  onChange,
  className,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className={cn(
        "h-4 w-4 shrink-0 cursor-pointer appearance-none rounded border border-border bg-surface-2",
        "checked:bg-accent checked:border-accent transition-fast",
        "checked:bg-[center] checked:bg-no-repeat",
        className,
      )}
      style={
        checked
          ? {
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='white' d='M6.5 11.2 3.2 7.9l1.1-1.1 2.2 2.2 5.2-5.2 1.1 1.1z'/%3E%3C/svg%3E\")",
            }
          : undefined
      }
    />
  );
}
