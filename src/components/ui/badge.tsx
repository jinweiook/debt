import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Tone = "accent" | "purple" | "success" | "warning" | "danger" | "dim";

const tones: Record<Tone, string> = {
  accent: "bg-accent/12 text-accent border-accent/30",
  purple: "bg-accent-2/12 text-accent-2 border-accent-2/30",
  success: "bg-success/12 text-success border-success/30",
  warning: "bg-warning/12 text-warning border-warning/30",
  danger: "bg-danger/12 text-danger border-danger/30",
  dim: "bg-white/5 text-text-dim border-white/10",
};

export function Badge({
  tone = "dim",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
