import { cookies } from "next/headers";
import { getSession, type UserSession } from "@/server/services/auth-service";
import { SESSION_COOKIE } from "@/lib/auth-cookie";
import { UnauthorizedError } from "@/server/lib/errors";

export interface AuthContext {
  userId: number;
  username: string;
  role: string;
  isAdmin: boolean;
  /**
   * 数据隔离维度：
   * - 普通客户 = 自己的 userId，所有查询按此过滤
   * - 管理员 = null，表示不做归属过滤（可查看全部客户账单）
   */
  ownerId: number | null;
}

/** 从 session cookie 解析当前登录客户；未登录返回 null（用于页面层） */
export async function getAuthContext(): Promise<AuthContext | null> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  const session: UserSession | null = await getSession(sessionId);
  if (!session) return null;
  return toAuthContext(session);
}

/** server action / API 路由用：未登录直接抛 UnauthorizedError */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuthContext();
  if (!auth) throw new UnauthorizedError();
  return auth;
}

function toAuthContext(session: UserSession): AuthContext {
  const isAdmin = session.role === "admin";
  return {
    userId: session.userId,
    username: session.username,
    role: session.role,
    isAdmin,
    ownerId: isAdmin ? null : session.userId,
  };
}
