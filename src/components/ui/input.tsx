import { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

const baseField =
  "w-full h-11 px-3.5 rounded-[var(--radius-md)] bg-surface-2 border border-border text-text text-sm tnum " +
  "placeholder:text-text-dim/60 transition-fast " +
  "hover:border-white/20 focus:border-accent/60 focus:outline-none focus:shadow-[0_0_0_3px_rgb(0_229_255/0.12)]";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(baseField, className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(baseField, "h-auto min-h-20 py-2.5 resize-y", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn(baseField, "appearance-none cursor-pointer pr-9", className)} {...props}>
      {children}
    </select>
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-sm font-medium text-text-dim">{label}</span>
      {children}
      {error ? (
        <span className="block text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-text-dim/70">{hint}</span>
      ) : null}
    </label>
  );
}
