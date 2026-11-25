import { resolveSession, type UserSession } from "@/server/services/auth-service";
import { ForbiddenError, UnauthorizedError } from "@/server/lib/errors";
import { hasPermission, type DataScope, type PermissionCode } from "@/lib/rbac";

export interface AuthContext {
  /** users.id */
  userId: string;
  username: string;
  displayName: string | null;
  role: string;
  roles: string[];
  roleNames: string[];
  permissions: PermissionCode[];
  dataScope: DataScope;
  /** 是否拥有全局数据视野（dataScope === "all" 或包含 admin 角色） */
  isAdmin: boolean;
  /**
   * 数据隔离维度：
   * - dataScope === "self" = 自己的 userId，所有查询按此过滤
   * - dataScope === "all" = null，表示不做归属过滤（可查看全部客户及自身账单）
   */
  ownerId: string | null;
}

/** 从会话 cookie 解析当前登录客户；未登录返回 null（用于页面层） */
export async function getAuthContext(): Promise<AuthContext | null> {
  const session: UserSession | null = await resolveSession();
  if (!session) return null;
  return toAuthContext(session);
}

/** server action / API 路由用：未登录直接抛 UnauthorizedError */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuthContext();
  if (!auth) throw new UnauthorizedError();
  return auth;
}

/** 校验当前登录用户是否具备指定 RBAC 权限码；无权限抛 ForbiddenError */
export async function requirePermission(code: PermissionCode): Promise<AuthContext> {
  const auth = await requireAuth();
  if (!hasPerm(auth, code)) {
    throw new ForbiddenError("您没有权限执行该操作");
  }
  return auth;
}

export function hasPerm(auth: Pick<AuthContext, "permissions"> | null | undefined, code: PermissionCode): boolean {
  return hasPermission(auth?.permissions, code);
}

function toAuthContext(session: UserSession): AuthContext {
  const isAllScope = session.dataScope === "all";
  return {
    userId: session.userId,
    username: session.username,
    displayName: session.displayName,
    role: session.role,
    roles: session.roles,
    roleNames: session.roleNames,
    permissions: session.permissions,
    dataScope: session.dataScope,
    isAdmin: isAllScope || session.roles.includes("admin"),
    ownerId: isAllScope ? null : session.userId,
  };
}
