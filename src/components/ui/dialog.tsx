"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm toast-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative glass w-full sm:max-w-md p-6 toast-in",
          "rounded-b-none sm:rounded-b-[var(--radius-lg)]",
          className,
        )}
      >
        {title && <h2 className="text-lg font-semibold mb-4">{title}</h2>}
        {children}
      </div>
    </div>,
    document.body,
  );
}
