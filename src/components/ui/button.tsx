import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "gradient-brand text-[#04121a] font-semibold shadow-[0_4px_20px_rgb(0_229_255/0.25)] hover:brightness-110 hover:shadow-[var(--shadow-glow)] active:scale-[0.98]",
  secondary:
    "bg-surface-2 text-text border border-border hover:border-accent/40 hover:text-accent active:scale-[0.98]",
  ghost: "text-text-dim hover:text-text hover:bg-white/5 active:scale-[0.98]",
  danger:
    "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25 hover:shadow-[0_0_20px_rgb(244_63_94/0.2)] active:scale-[0.98]",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm rounded-[var(--radius-sm)]",
  md: "h-11 px-5 text-sm rounded-[var(--radius-md)]",
  lg: "h-12 px-6 text-base rounded-[var(--radius-md)]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap transition-base select-none",
        "disabled:opacity-50 disabled:pointer-events-none",
        "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && (
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
});
