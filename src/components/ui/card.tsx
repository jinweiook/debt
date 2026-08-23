import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, hover, ...props }: HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return <div className={cn("glass p-5", hover && "card-hover", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-semibold text-text", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-text-dim", className)} {...props} />;
}
