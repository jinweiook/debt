import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { getDb, type Db } from "@/server/db/client";
import { loginAttempts, roles, userRoles, users } from "@/server/db/schema";
import { SESSION_COOKIE } from "@/lib/auth-cookie";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSessionToken, verifySessionToken } from "@/lib/session-token";
import type { DataScope, PermissionCode } from "@/lib/rbac";
import { BusinessRuleError, NotFoundError, ValidationError } from "@/server/lib/errors";
import { getUserRbac, listActiveAdminUserIds, seedDefaultRbac, setUserRoles } from "./rbac-service";

/**
 * 认证服务（自建，替代原 Supabase Auth）。
 * - 密码：scrypt 哈希存 users.password_hash
 * - 会话：HMAC 签名 cookie（见 src/lib/session-token.ts）
 * - 本服务负责：登录/注册/会话解析、用户增改/启停、登录失败锁定
 * - 业务数据访问仍走 Drizzle，多租户靠 owner_user_id + RBAC dataScope 过滤
 */

export interface UserSession {
  userId: string;
  username: string;
  displayName: string | null;
  role: string;
  roles: string[];
  roleNames: string[];
  permissions: PermissionCode[];
  dataScope: DataScope;
}

export const MAX_LOGIN_ATTEMPTS = 3;
export const LOCK_DURATION_SECONDS = 5 * 60; // 5 分钟

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,32}$/, "账号需为 3-32 位字母、数字或下划线");

export const adminCreateUserSchema = z.object({
  username: usernameSchema,
  password: z.string().min(6, "密码长度需为 6-64 位").max(64, "密码长度需为 6-64 位"),
  displayName: z.string().trim().max(64, "姓名最多 64 字").optional().or(z.literal("")),
  phone: z.string().trim().max(32, "联系电话最多 32 位").optional().or(z.literal("")),
  note: z.string().trim().max(512, "备注最多 512 字").optional().or(z.literal("")),
  status: z.enum(["active", "disabled"]).default("active"),
  roleIds: z.array(z.number().int().positive()).min(1, "请至少分配一个角色"),
});

export const adminUpdateUserSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().max(64, "姓名最多 64 字").optional().or(z.literal("")),
  phone: z.string().trim().max(32, "联系电话最多 32 位").optional().or(z.literal("")),
  note: z.string().trim().max(512, "备注最多 512 字").optional().or(z.literal("")),
  status: z.enum(["active", "disabled"]),
  roleIds: z.array(z.number().int().positive()).min(1, "请至少分配一个角色"),
});

/** 按 username 查用户 */
export async function findUserByUsername(username: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.username, username.trim().toLowerCase()))
    .limit(1);
  return row;
}

/** 按 id 查用户 */
export async function findUserById(id: string) {
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

interface LockStatus {
  locked: boolean;
  remainingSeconds: number;
}

/** 检查账号是否被锁定 */
export async function getLockStatus(username: string): Promise<LockStatus> {
  const db = getDb();
  const name = username.trim().toLowerCase();
  const [row] = await db.select().from(loginAttempts).where(eq(loginAttempts.username, name)).limit(1);
  if (row?.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
    return {
      locked: true,
      remainingSeconds: Math.ceil((row.lockedUntil.getTime() - Date.now()) / 1000),
    };
  }
  return { locked: false, remainingSeconds: 0 };
}

/** upsert 登录失败记录（先查后插/改，方言无关） */
async function upsertLoginAttempt(username: string, failCount: number, lockedUntil: Date | null): Promise<void> {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .select({ username: loginAttempts.username })
    .from(loginAttempts)
    .where(eq(loginAttempts.username, username))
    .limit(1);
  if (row) {
    await db
      .update(loginAttempts)
      .set({ failCount, lockedUntil, updatedAt: now })
      .where(eq(loginAttempts.username, username));
  } else {
    await db.insert(loginAttempts).values({ username, failCount, lockedUntil, updatedAt: now });
  }
}

/** 记录一次登录失败，达到阈值则锁定 */
export async function recordLoginFailure(
  username: string,
): Promise<{ locked: boolean; remainingSeconds: number }> {
  const db = getDb();
  const name = username.trim().toLowerCase();
  const now = new Date();
  const [row] = await db.select().from(loginAttempts).where(eq(loginAttempts.username, name)).limit(1);
  // 锁定已过期时从头计数，否则累计
  const base = row && (!row.lockedUntil || row.lockedUntil.getTime() <= now.getTime()) ? row.failCount : 0;
  const count = base + 1;

  if (count >= MAX_LOGIN_ATTEMPTS) {
    const lockedUntil = new Date(now.getTime() + LOCK_DURATION_SECONDS * 1000);
    await upsertLoginAttempt(name, 0, lockedUntil);
    return { locked: true, remainingSeconds: LOCK_DURATION_SECONDS };
  }

  await upsertLoginAttempt(name, count, null);
  return { locked: false, remainingSeconds: 0 };
}

/** 登录成功后清零失败计数 */
export async function clearLoginFailures(username: string): Promise<void> {
  const db = getDb();
  await db.delete(loginAttempts).where(eq(loginAttempts.username, username.trim().toLowerCase()));
}

export interface LoginFailure {
  ok: false;
  locked: boolean;
  remainingSeconds: number;
  message: string;
}

async function failureResult(name: string, message: string): Promise<LoginFailure> {
  const failure = await recordLoginFailure(name);
  if (failure.locked) {
    return {
      ok: false,
      locked: true,
      remainingSeconds: failure.remainingSeconds,
      message: `连续输错密码，账号已锁定，请 ${formatDuration(failure.remainingSeconds)} 后重试`,
    };
  }
  return { ok: false, locked: false, remainingSeconds: 0, message };
}

/** 登录：校验锁 → 校验密码 → 写最后登录时间 → 返回会话 token */
export async function login(
  username: string,
  password: string,
): Promise<{ ok: true; token: string } | LoginFailure> {
  const name = username.trim().toLowerCase();
  const lock = await getLockStatus(name);
  if (lock.locked) {
    return {
      ok: false,
      locked: true,
      remainingSeconds: lock.remainingSeconds,
      message: `账号已锁定，请 ${formatDuration(lock.remainingSeconds)} 后重试`,
    };
  }

  const profile = await findUserByUsername(name);
  if (!profile || profile.status !== "active") {
    // 用户不存在或已禁用均走失败计数，避免枚举用户名
    return failureResult(name, "账号或密码不正确");
  }

  const ok = await verifyPassword(password, profile.passwordHash);
  if (!ok) {
    return failureResult(name, "账号或密码不正确");
  }

  const db = getDb();
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, profile.id));
  await clearLoginFailures(name);
  const token = await createSessionToken(profile.id, profile.tokenVersion);
  return { ok: true, token };
}

/**
 * 注册新客户账号（role=user）。
 * 说明：公开注册默认已关闭（由路由与页面拦截）；保留此函数供测试脚本或开关启用时调用。
 */
export async function register(
  username: string,
  password: string,
): Promise<{ ok: true; token: string; userId: string } | { ok: false; message: string }> {
  const name = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(name)) {
    return { ok: false, message: "账号需为 3-32 位字母、数字或下划线" };
  }
  if (password.length < 6 || password.length > 64) {
    return { ok: false, message: "密码长度需为 6-64 位" };
  }

  const existing = await findUserByUsername(name);
  if (existing) {
    return { ok: false, message: "该账号已被注册" };
  }

  const db = getDb();
  const userId = randomUUID();
  const pwdHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      username: name,
      passwordHash: pwdHash,
      role: "user",
      status: "active",
      lastLoginAt: new Date(),
    });
    const [userRoleRow] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, "user")).limit(1);
    if (userRoleRow) {
      await tx.insert(userRoles).values({ userId, roleId: userRoleRow.id });
    }
  });

  const token = await createSessionToken(userId, 0);
  return { ok: true, token, userId };
}

/** 管理员后台新建用户（含扩展资料与 RBAC 角色绑定） */
export async function createUserByAdmin(rawInput: unknown): Promise<{ id: string; username: string }> {
  const parsed = adminCreateUserSchema.parse(rawInput);
  const existing = await findUserByUsername(parsed.username);
  if (existing) {
    throw new BusinessRuleError(`账号「${parsed.username}」已存在`);
  }

  const db = getDb();
  const userId = randomUUID();
  const pwdHash = await hashPassword(parsed.password);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      username: parsed.username,
      displayName: parsed.displayName || null,
      phone: parsed.phone || null,
      note: parsed.note || null,
      passwordHash: pwdHash,
      role: "user",
      status: parsed.status,
      createdAt: now,
      updatedAt: now,
    });
    const { primaryRole } = await setUserRoles(tx as unknown as Db, userId, parsed.roleIds);
    await tx.update(users).set({ role: primaryRole }).where(eq(users.id, userId));
  });

  return { id: userId, username: parsed.username };
}

/** 管理员后台编辑用户（含防自锁、角色变更、禁用踢下线） */
export async function updateUserByAdmin(
  targetUserId: string,
  rawInput: unknown,
  operatorUserId: string,
): Promise<void> {
  const parsed = adminUpdateUserSchema.parse(rawInput);
  const db = getDb();
  const [target] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!target) throw new NotFoundError("用户不存在");

  if (parsed.username !== target.username) {
    const dup = await findUserByUsername(parsed.username);
    if (dup && dup.id !== targetUserId) {
      throw new BusinessRuleError(`账号「${parsed.username}」已被占用`);
    }
  }

  const currentRbac = await getUserRbac(targetUserId, target.role);
  const targetWasAdmin = currentRbac.roles.includes("admin");

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as Db;
    // 预检验所选角色
    const { primaryRole, roleCodes } = await setUserRoles(txDb, targetUserId, parsed.roleIds);
    const willBeAdmin = roleCodes.includes("admin");

    if (targetUserId === operatorUserId) {
      if (parsed.status !== "active") {
        throw new BusinessRuleError("不能禁用当前正在使用的管理员账号");
      }
      if (targetWasAdmin && !willBeAdmin) {
        throw new BusinessRuleError("不能移除自己的超级管理员角色");
      }
    }

    if (targetWasAdmin && (!willBeAdmin || parsed.status !== "active")) {
      const activeAdmins = await listActiveAdminUserIds(txDb);
      const remainingAdmins = activeAdmins.filter((id) => id !== targetUserId);
      if (remainingAdmins.length === 0) {
        throw new BusinessRuleError("系统中至少需要保留一个启用状态的超级管理员账号");
      }
    }

    const prevRoleIds = [...currentRbac.roleIds].sort((a, b) => a - b).join(",");
    const nextRoleIds = [...new Set(parsed.roleIds)].sort((a, b) => a - b).join(",");
    const rolesChanged = prevRoleIds !== nextRoleIds;
    const disabledNow = parsed.status === "disabled" && target.status !== "disabled";
    const needBumpToken = disabledNow || rolesChanged || parsed.username !== target.username;

    await tx
      .update(users)
      .set({
        username: parsed.username,
        displayName: parsed.displayName || null,
        phone: parsed.phone || null,
        note: parsed.note || null,
        role: primaryRole,
        status: parsed.status,
        tokenVersion: needBumpToken ? sql`${users.tokenVersion} + 1` : target.tokenVersion,
        updatedAt: new Date(),
      })
      .where(eq(users.id, targetUserId));
  });

  if (parsed.username !== target.username) {
    await clearLoginFailures(target.username);
  }
  if (parsed.status === "active" && target.status === "disabled") {
    await clearLoginFailures(parsed.username);
  }
}

/** 从会话 cookie 解析当前用户；校验签名、状态、token_version 与 RBAC 权限 */
export async function resolveSession(): Promise<UserSession | null> {
  const jar = await cookies();
  const payload = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!payload) return null;

  const profile = await findUserById(payload.uid);
  if (!profile || profile.status !== "active") return null;
  if (profile.tokenVersion !== payload.tv) return null;

  const rbac = await getUserRbac(profile.id, profile.role);
  return {
    userId: profile.id,
    username: profile.username,
    displayName: profile.displayName ?? null,
    role: profile.role,
    roles: rbac.roles,
    roleNames: rbac.roleNames,
    permissions: rbac.permissions,
    dataScope: rbac.dataScope,
  };
}

/**
 * 管理员重置指定用户密码：改哈希 + token_version+1（踢掉旧会话）+ 清登录锁定。
 * 调用方需先校验权限。
 */
export async function resetUserPassword(targetUserId: string, newPassword: string): Promise<void> {
  if (newPassword.length < 6 || newPassword.length > 64) {
    throw new ValidationError("密码长度需为 6-64 位");
  }
  const db = getDb();
  const [target] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!target) throw new NotFoundError("用户不存在");
  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(newPassword),
      tokenVersion: sql`${users.tokenVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, targetUserId));
  await clearLoginFailures(target.username);
}

/**
 * 初始化默认管理员并确保 RBAC 角色与存量用户绑定就绪。
 * @param overrideDb 可选：外部传入的 db 实例（init-db 脚本会传，避免重复连接）
 */
export async function seedDefaultAdmin(overrideDb?: Db): Promise<void> {
  const db = overrideDb ?? getDb();
  const [existing] = await db.select({ id: users.id }).from(users).limit(1);
  if (!existing) {
    const adminUsername = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || "456123";

    await db.insert(users).values({
      id: randomUUID(),
      username: adminUsername,
      displayName: "系统管理员",
      passwordHash: await hashPassword(adminPassword),
      role: "admin",
      status: "active",
    });

    console.log(`[seedDefaultAdmin] 已创建默认管理员: ${adminUsername}`);
  }

  await seedDefaultRbac(db);
}

function formatDuration(seconds: number): string {
  const m = Math.ceil(seconds / 60);
  if (m >= 60) return `${Math.floor(m / 60)} 小时 ${m % 60} 分钟`;
  return `${m} 分钟`;
}
