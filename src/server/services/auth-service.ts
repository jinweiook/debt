import { eq } from "drizzle-orm";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/server/db/client";
import { loginAttempts, users } from "@/server/db/schema";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 认证服务。
 *
 * 分工：
 * - 身份（密码校验、会话、token 续期）交给 Supabase Auth
 * - 本服务只负责：username ↔ email 映射、角色/状态查询、登录失败锁定
 * - 业务数据访问仍走 Drizzle + Postgres，多租户靠 owner_user_id 过滤
 */

export interface UserSession {
  /** users.id，同时也是 Supabase auth.users.id（UUID） */
  userId: string;
  username: string;
  role: string;
}

export const MAX_LOGIN_ATTEMPTS = 3;
export const LOCK_DURATION_SECONDS = 5 * 60; // 5 分钟

/** 注册用户的邮箱域名：Supabase Auth 用 email 登录，这里做 username → email 映射 */
export function emailDomain(): string {
  return process.env.AUTH_EMAIL_DOMAIN || "debt.local";
}

export function emailForUsername(username: string): string {
  return `${username.trim().toLowerCase()}@${emailDomain()}`;
}

/** 按 username 查业务侧用户档案 */
export async function findUserByUsername(username: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.username, username.trim().toLowerCase()))
    .limit(1);
  return row;
}

/** 按 UUID 查业务侧用户档案 */
export async function findUserById(id: string) {
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

interface LockStatus {
  locked: boolean;
  remainingSeconds: number;
}

/** 检查账号是否被锁定（Postgres 持久化，多实例共享） */
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
    await db
      .insert(loginAttempts)
      .values({ username: name, failCount: 0, lockedUntil, updatedAt: now })
      .onConflictDoUpdate({
        target: loginAttempts.username,
        set: { failCount: 0, lockedUntil, updatedAt: now },
      });
    return { locked: true, remainingSeconds: LOCK_DURATION_SECONDS };
  }

  await db
    .insert(loginAttempts)
    .values({ username: name, failCount: count, lockedUntil: null, updatedAt: now })
    .onConflictDoUpdate({
      target: loginAttempts.username,
      set: { failCount: count, lockedUntil: null, updatedAt: now },
    });
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

/**
 * 登录入口。
 * @param supabase 必须传 Route Handler 里创建的 server client，
 *                 否则 Supabase 的会话 cookie 写不进响应。
 */
export async function login(
  supabase: SupabaseClient,
  username: string,
  password: string,
): Promise<{ ok: true } | LoginFailure> {
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
    // 用户不存在也走失败计数，避免枚举用户名
    const failure = await recordLoginFailure(name);
    if (failure.locked) {
      return {
        ok: false,
        locked: true,
        remainingSeconds: failure.remainingSeconds,
        message: `连续输错密码，账号已锁定，请 ${formatDuration(failure.remainingSeconds)} 后重试`,
      };
    }
    return { ok: false, locked: false, remainingSeconds: 0, message: "账号或密码不正确" };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password,
  });

  if (error) {
    const failure = await recordLoginFailure(name);
    if (failure.locked) {
      return {
        ok: false,
        locked: true,
        remainingSeconds: failure.remainingSeconds,
        message: `连续输错密码，账号已锁定，请 ${formatDuration(failure.remainingSeconds)} 后重试`,
      };
    }
    return { ok: false, locked: false, remainingSeconds: 0, message: "账号或密码不正确" };
  }

  await clearLoginFailures(name);
  return { ok: true };
}

/**
 * 注册新客户账号（role=user），成功后直接建立会话（自动登录）。
 *
 * 用 admin.createUser + email_confirm:true 创建，再 signInWithPassword 拿会话，
 * 这样不依赖 Supabase 后台是否关闭了邮箱验证。
 */
export async function register(
  supabase: SupabaseClient,
  username: string,
  password: string,
): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
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

  const email = emailForUsername(name);
  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  let userId = created?.user?.id;
  if (createError || !userId) {
    // 邮箱可能已被 Supabase Auth 占用（例如残留账号），复用它
    const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existed = listed?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (existed) {
      await admin.auth.admin.updateUserById(existed.id, { password });
      userId = existed.id;
    } else {
      return { ok: false, message: createError?.message || "注册失败，请稍后重试" };
    }
  }

  const db = getDb();
  await db
    .insert(users)
    .values({ id: userId, username: name, email, role: "user", status: "active" })
    .onConflictDoUpdate({
      target: users.id,
      set: { username: name, email, updatedAt: new Date() },
    });

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    return { ok: false, message: "注册成功，但自动登录失败，请手动登录" };
  }
  return { ok: true, userId };
}

/**
 * 从 Supabase 会话解析业务用户档案。
 * 只用 getUser()（会向 Auth 服务器校验 token），不用 getSession()。
 */
export async function resolveSession(supabase: SupabaseClient): Promise<UserSession | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await findUserById(user.id);
  if (!profile || profile.status !== "active") return null;

  return { userId: profile.id, username: profile.username, role: profile.role };
}

/** 登出：销毁 Supabase 会话 cookie */
export async function logout(supabase: SupabaseClient): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * 初始化默认管理员：users 表为空时创建。
 * 同时在 Supabase Auth 建号，并写入业务侧 users 档案（role=admin）。
 * @param overrideDb 可选：外部传入的 db 实例（init-db 脚本会传，避免重复连接）
 */
export async function seedDefaultAdmin(
  overrideDb?: ReturnType<typeof import("@/server/db/client").getDb>,
): Promise<void> {
  const db = overrideDb ?? getDb();
  const [existing] = await db.select({ id: users.id }).from(users).limit(1);
  if (existing) return;

  const adminUsername = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "456123";
  const email = emailForUsername(adminUsername);

  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: adminPassword,
    email_confirm: true,
  });

  let userId = created?.user?.id;
  if (error || !userId) {
    const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existed = listed?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (existed) {
      await admin.auth.admin.updateUserById(existed.id, { password: adminPassword });
      userId = existed.id;
    } else {
      throw new Error(`创建默认管理员失败：${error?.message ?? "未知错误"}`);
    }
  }

  await db
    .insert(users)
    .values({ id: userId, username: adminUsername, email, role: "admin", status: "active" })
    .onConflictDoUpdate({
      target: users.id,
      set: { username: adminUsername, email, role: "admin", updatedAt: new Date() },
    });

  console.log(`[seedDefaultAdmin] 已创建默认管理员: ${adminUsername} (${email})`);
}

function formatDuration(seconds: number): string {
  const m = Math.ceil(seconds / 60);
  if (m >= 60) return `${Math.floor(m / 60)} 小时 ${m % 60} 分钟`;
  return `${m} 分钟`;
}
