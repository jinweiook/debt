"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useSession } from "@/components/layout/session";

const navItems = [
  { href: "/", label: "总览", icon: IconHome },
  { href: "/loans", label: "借贷款", icon: IconLoan },
  { href: "/repayments/new", label: "记还款", icon: IconPlus },
  { href: "/settings/backup", label: "备份", icon: IconDatabase },
];

const adminNavItems = [{ href: "/admin/customers", label: "客户管理", icon: IconUsers }];

function IconLoan({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3 10h18" />
      <path d="M7 14.5h4" strokeLinecap="round" />
    </svg>
  );
}

function IconHome({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9.5Z" strokeLinejoin="round" />
    </svg>
  );
}
function IconPlus({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" strokeLinecap="round" />
    </svg>
  );
}
function IconDatabase({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5v13c0 1.66 3.58 3 8 3s8-1.34 8-3v-13" />
      <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
    </svg>
  );
}
function IconUsers({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" strokeLinecap="round" />
      <path d="M16 5a3.5 3.5 0 0 1 0 7M17.5 14.5c2.4.7 4 2.8 4 5.5" strokeLinecap="round" />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const nav = session?.isAdmin ? [...navItems, ...adminNavItems] : navItems;

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="min-h-dvh md:flex">
      {/* 桌面端左侧栏 */}
      <aside className="hidden md:flex md:w-60 lg:w-64 shrink-0 flex-col border-r border-border bg-surface/40 backdrop-blur-xl sticky top-0 h-dvh p-5">
        <Link href="/" className="flex items-center gap-2.5 px-2 py-1">
          <span className="h-8 w-8 rounded-[var(--radius-sm)] gradient-brand shadow-[var(--shadow-glow)]" />
          <span className="text-lg font-bold tracking-wide">
            借还款<span className="gradient-text">规划</span>
          </span>
        </Link>
        <nav className="mt-8 flex flex-col gap-1.5">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-[var(--radius-md)] px-3.5 h-11 text-sm font-medium transition-fast",
                isActive(item.href)
                  ? "bg-accent/10 text-accent border border-accent/25 shadow-[0_0_16px_rgb(0_229_255/0.1)]"
                  : "text-text-dim hover:text-text hover:bg-white/5 border border-transparent",
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          {session && (
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-[var(--radius-md)] bg-surface-2/60 border border-border">
              <span className="h-7 w-7 shrink-0 rounded-full gradient-card border border-accent-2/30 flex items-center justify-center text-xs font-bold text-accent-2">
                {session.username.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{session.username}</p>
                <p className="text-[11px] text-text-dim">{session.isAdmin ? "管理员 · 可见全部" : "客户"}</p>
              </div>
            </div>
          )}
          <button
            onClick={async () => {
              try {
                await fetch("/api/auth/logout", { method: "POST" });
              } finally {
                router.push("/login");
                router.refresh();
              }
            }}
            className="w-full text-left px-3.5 h-10 rounded-[var(--radius-md)] text-sm text-text-dim hover:text-danger hover:bg-danger/10 transition-fast"
          >
            退出登录
          </button>
        </div>
      </aside>

      {/* 主内容 */}
      <main className="flex-1 min-w-0 px-4 pt-6 pb-24 md:px-8 md:py-8 md:pb-10 max-w-6xl mx-auto w-full">
        {children}
      </main>

      {/* 移动端底部 Tab */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 glass !rounded-none border-x-0 border-b-0 px-6 py-2 flex justify-around">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center gap-1 py-1.5 px-3 min-w-16 transition-fast",
              isActive(item.href) ? "text-accent" : "text-text-dim",
            )}
          >
            <item.icon className="h-5.5 w-5.5" />
            <span className="text-[11px] font-medium">{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  back?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {back && (
          <Link href={back} className="text-sm text-text-dim hover:text-accent transition-fast inline-flex items-center gap-1 mb-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            返回
          </Link>
        )}
        <h1 className="text-2xl md:text-[28px] font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-text-dim">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
