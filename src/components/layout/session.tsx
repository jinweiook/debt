"use client";

import { createContext, useContext } from "react";

export interface SessionUser {
  userId: number;
  username: string;
  role: string;
  isAdmin: boolean;
}

const SessionContext = createContext<SessionUser | null>(null);

export function SessionProvider({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionUser | null {
  return useContext(SessionContext);
}
