"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "info";
interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

const ToastContext = createContext<{ toast: (message: string, type?: ToastType) => void }>({
  toast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  // 仅在客户端水合完成后再挂载 portal，避免 SSR/客户端 HTML 不一致
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = nextId++;
    setItems((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3200);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {mounted &&
        createPortal(
          <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 px-4 w-full max-w-sm pointer-events-none">
            {items.map((t) => (
              <div
                key={t.id}
                className={cn(
                  "toast-in glass px-4 py-3 text-sm w-full text-center pointer-events-auto border",
                  t.type === "success" && "border-success/40 shadow-[0_0_20px_rgb(52_211_153/0.15)]",
                  t.type === "error" && "border-danger/40 shadow-[0_0_20px_rgb(244_63_94/0.15)]",
                  t.type === "info" && "border-accent/30",
                )}
              >
                {t.message}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
