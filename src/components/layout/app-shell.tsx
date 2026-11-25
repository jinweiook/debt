"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useSession } from "@/components/layout/session";
import { hasAnyPermission, hasPermission, shortUserDisplayName, type PermissionCode } from "@/lib/rbac";

interface NavItem {
  href: string;
  label: string;
  icon: (props: { className?: string }) => React.ReactNode;
  show: (perms: readonly PermissionCode[]) => boolean;
}

const allNavItems: NavItem[] = [
  {
    href: "/",
    label: "总览",
    icon: IconHome,
    show: (p) => hasPermission(p, "overview:read"),
  },
  {
    href: "/loans",
    label: "借贷款",
    icon: IconLoan,
    show: (p) => hasPermission(p, "debt:read"),
  },
  {
    href: "/repayments/new",
    label: "记还款",
    icon: IconPlus,
    show: (p) => hasPermission(p, "repayment:create"),
  },
  {
    href: "/settings/backup",
    label: "备份",
    icon: IconDatabase,
    show: (p) => hasAnyPermission(p, ["backup:export", "backup:import", "backup:export_sql", "backup:clear_all"]),
  },
  {
    href: "/admin/customers",
    label: "客户管理",
    icon: IconUsers,
    show: (p) => hasPermission(p, "user:read"),
  },
  {
    href: "/admin/roles",
    label: "角色权限",
    icon: IconShield,
    show: (p) => hasPermission(p, "role:manage"),
  },
];

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
function IconShield({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M12 3 4.5 6.2v5.4c0 4.7 3.2 8.9 7.5 10.1 4.3-1.2 7.5-5.4 7.5-10.1V6.2L12 3Z" strokeLinejoin="round" />
      <path d="m9.2 12.2 2 2 3.8-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();

  const perms = session?.permissions ?? [];
  const nav = session ? allNavItems.filter((item) => item.show(perms)) : [];

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const displayName = session ? shortUserDisplayName(session) : "";
  const roleLabel =
    session && session.roleNames.length > 0
      ? `${session.roleNames.join(" / ")}${session.dataScope === "all" ? " · 全部" : ""}`
      : session?.isAdmin
        ? "管理员 · 全部"
        : "客户";

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  };

  return (
    <div className="min-h-dvh md:flex">
      {/* 移动端顶部栏：品牌 + 当前账号 + 退出 */}
      <header className="md:hidden sticky top-0 z-40 glass !rounded-none border-x-0 border-t-0 px-4 h-14 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 min-w-0">
          <span className="h-7 w-7 shrink-0 rounded-[var(--radius-sm)] gradient-brand shadow-[var(--shadow-glow)]" />
          <span className="text-base font-bold tracking-wide whitespace-nowrap">
            借还款<span className="gradient-text">规划</span>
          </span>
        </Link>
        {session && (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="h-6 w-6 shrink-0 rounded-full gradient-card border border-accent-2/30 flex items-center justify-center text-[11px] font-bold text-accent-2">
                {displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="text-xs text-text-dim truncate max-w-20">{displayName}</span>
            </div>
            <button
              onClick={logout}
              aria-label="退出登录"
              className="shrink-0 p-1.5 text-text-dim hover:text-danger transition-fast"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4.5 w-4.5">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" strokeLinecap="round" />
                <path d="m16 17 5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}
      </header>

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
                {displayName.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{displayName}</p>
                <p className="text-[11px] text-text-dim truncate">{roleLabel}</p>
              </div>
            </div>
          )}
          <button
            onClick={logout}
            className="w-full text-left px-3.5 h-10 rounded-[var(--radius-md)] text-sm text-text-dim hover:text-danger hover:bg-danger/10 transition-fast"
          >
            退出登录
          </button>
        </div>
      </aside>

      {/* 主内容：移动端底部预留 Tab 栏 + 安全区高度 */}
      <main className="flex-1 min-w-0 px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-8 md:py-8 md:pb-10 max-w-6xl mx-auto w-full">
        {children}
      </main>

      {/* 移动端底部 Tab：含 Home 指示条安全区 */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 glass !rounded-none border-x-0 border-b-0 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex justify-around overflow-x-auto">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center gap-1 py-1.5 px-2 min-w-14 shrink-0 transition-fast",
              isActive(item.href) ? "text-accent" : "text-text-dim",
            )}
          >
            <item.icon className="h-5 w-5" />
            <span className="text-[11px] font-medium whitespace-nowrap">{item.label}</span>
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
