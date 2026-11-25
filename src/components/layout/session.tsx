"use client";

import { createContext, useContext } from "react";
import { hasAnyPermission, hasPermission, type DataScope, type PermissionCode } from "@/lib/rbac";

export interface SessionUser {
  /** users.id（UUID） */
  userId: string;
  username: string;
  displayName: string | null;
  role: string;
  roles: string[];
  roleNames: string[];
  permissions: PermissionCode[];
  dataScope: DataScope;
  isAdmin: boolean;
}

const SessionContext = createContext<SessionUser | null>(null);

export function SessionProvider({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionUser | null {
  return useContext(SessionContext);
}

export function usePermission(code: PermissionCode): boolean {
  const session = useSession();
  return hasPermission(session?.permissions, code);
}

export function useAnyPermission(codes: readonly PermissionCode[]): boolean {
  const session = useSession();
  return hasAnyPermission(session?.permissions, codes);
}
