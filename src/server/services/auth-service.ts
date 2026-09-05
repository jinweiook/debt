import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { compare, hash } from "bcryptjs";
import { and, eq, gt, lt } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/server/db/client";
import { loginAttempts, sessions, users } from "@/server/db/schema";

const scrypt = promisifiedScrypt;

interface ScryptOptions {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}

/** 显式 Promise 包装 crypto.scrypt（promisify 会推断成无 options 的重载） */
function promisifiedScrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });
}

export interface UserSession {
  userId: number;
  username: string;
  role: string;
}

const MAX_LOGIN_ATTEMPTS = 3;
const LOCK_DURATION_SECONDS = 5 * 60; // 5 分钟
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 天

/**
 * 密码哈希：Node 内置 scrypt（NIST 推荐、抗 GPU/ASIC 暴力破解）。
 * 存储格式：scrypt$N$r$p$salt$hash（N/r/p 为可调参数，随盐一并保存，便于以后升级）。
 * 兼容旧版 bcrypt 哈希（$2a$/$2b$ 前缀），存量账号无需重置密码。
 */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_PREFIX = "scrypt$";

/** 查询用户（用户名不区分大小写） */
export async function findUserByUsername(username: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.username, username.toLowerCase()))
    .limit(1);
  return row;
}

/** 生成 scrypt 密码哈希 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(plain, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * 1024 * 1024,
  })) as Buffer;
  return [
    SCRYPT_PREFIX.slice(0, -1), // "scrypt"（不带 $，避免 split 时产生空段）
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/** 校验明文密码（自动兼容 scrypt 与历史 bcrypt） */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored.startsWith(SCRYPT_PREFIX)) {
    // 历史 bcrypt 哈希
    return compare(plain, stored);
  }
  const [, nStr, rStr, pStr, saltB64, hashB64] = stored.split("$");
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!n || !r || !p || !saltB64 || !hashB64) return false;
  try {
    const derived = (await scrypt(plain, Buffer.from(saltB64, "base64"), SCRYPT_KEYLEN, {
      N: n,
      r,
      p,
      maxmem: 128 * 1024 * 1024,
    })) as Buffer;
    const expected = Buffer.from(hashB64, "base64");
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

interface LockStatus {
  locked: boolean;
  remainingSeconds: number;
}

/** 检查账号是否被锁定（MySQL 持久化，多实例共享） */
export async function getLockStatus(username: string): Promise<LockStatus> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(loginAttempts)
    .where(eq(loginAttempts.username, username.toLowerCase()))
    .limit(1);
  if (row?.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
    return { locked: true, remainingSeconds: Math.ceil((row.lockedUntil.getTime() - Date.now()) / 1000) };
  }
  return { locked: false, remainingSeconds: 0 };
}

/** 记录一次登录失败，达到阈值则锁定 */
export async function recordLoginFailure(username: string): Promise<{ locked: boolean; remainingSeconds: number }> {
  const db = getDb();
  const name = username.toLowerCase();
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
      .onDuplicateKeyUpdate({ set: { failCount: 0, lockedUntil, updatedAt: now } });
    return { locked: true, remainingSeconds: LOCK_DURATION_SECONDS };
  }

  await db
    .insert(loginAttempts)
    .values({ username: name, failCount: count, lockedUntil: null, updatedAt: now })
    .onDuplicateKeyUpdate({ set: { failCount: count, lockedUntil: null, updatedAt: now } });
  return { locked: false, remainingSeconds: 0 };
}

/** 登录成功后清零失败计数 */
export async function clearLoginFailures(username: string): Promise<void> {
  const db = getDb();
  await db.delete(loginAttempts).where(eq(loginAttempts.username, username.toLowerCase()));
}

/** 创建 session（MySQL 持久化，跨实例共享），返回 sessionId */
export async function createSession(user: { id: number; username: string; role: string }): Promise<string> {
  const db = getDb();
  const sessionId = uuidv4();
  const now = new Date();
  await db.insert(sessions).values({
    id: sessionId,
    userId: user.id,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000),
    lastSeenAt: now,
  });
  return sessionId;
}

/** 根据 sessionId 获取会话信息（join users：会话有效且账号未过期、未禁用） */
export async function getSession(sessionId: string | undefined): Promise<UserSession | null> {
  if (!sessionId) return null;
  const db = getDb();
  const [row] = await db
    .select({ userId: users.id, username: users.username, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date()), eq(users.status, "active")))
    .limit(1);
  if (!row) return null;
  return { userId: row.userId, username: row.username, role: row.role };
}

/** 删除 session（登出） */
export async function deleteSession(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** 清理过期 session（登录成功后顺带执行，控制表体积） */
export async function cleanupExpiredSessions(): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/** 登录入口：含锁定检查、密码校验、失败计数、session 创建 */
export async function login(
  username: string,
  password: string,
): Promise<{ ok: true; sessionId: string } | { ok: false; locked: boolean; remainingSeconds: number; message: string }> {
  const lock = await getLockStatus(username);
  if (lock.locked) {
    return {
      ok: false,
      locked: true,
      remainingSeconds: lock.remainingSeconds,
      message: `账号已锁定，请 ${formatDuration(lock.remainingSeconds)} 后重试`,
    };
  }

  const user = await findUserByUsername(username);
  if (!user || user.status !== "active") {
    // 用户不存在也走失败计数，避免枚举用户名
    const failure = await recordLoginFailure(username);
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

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const failure = await recordLoginFailure(username);
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

  await clearLoginFailures(username);
  // 顺带清理过期 session，避免 sessions 表无限增长
  await cleanupExpiredSessions();
  const sessionId = await createSession({ id: user.id, username: user.username, role: user.role });
  return { ok: true, sessionId };
}

/** 注册新客户账号（role=user），成功后直接创建 session（自动登录） */
export async function register(
  username: string,
  password: string,
): Promise<{ ok: true; sessionId: string; userId: number } | { ok: false; message: string }> {
  const name = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(name)) {
    return { ok: false, message: "账号需为 3-32 位字母、数字或下划线" };
  }
  if (password.length < 6 || password.length > 64) {
    return { ok: false, message: "密码长度需为 6-64 位" };
  }

  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, name)).limit(1);
  if (existing) {
    return { ok: false, message: "该账号已被注册" };
  }

  const passwordHash = await hashPassword(password);
  const [ins] = await db
    .insert(users)
    .values({ username: name, passwordHash, role: "user", status: "active" })
    .catch(() => {
      // 并发注册同名账号时 UNIQUE 约束兜底
      throw new Error("该账号已被注册");
    });
  const userId = Number(ins.insertId);
  const sessionId = await createSession({ id: userId, username: name, role: "user" });
  return { ok: true, sessionId, userId };
}

/** 初始化测试账号：users 表为空时插入 admin */
export async function seedDefaultAdmin(): Promise<void> {
  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).limit(1);
  if (existing) return;

  const adminUsername = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
  // 初始化密码默认 456123，可用环境变量 ADMIN_PASSWORD 覆盖
  const adminPassword = process.env.ADMIN_PASSWORD || "456123";
  const passwordHash = await hashPassword(adminPassword);

  await db.insert(users).values({
    username: adminUsername,
    passwordHash,
    role: "admin",
    status: "active",
  });
  console.log(`[seedDefaultAdmin] 已创建默认账号: ${adminUsername}`);
}

function formatDuration(seconds: number): string {
  const m = Math.ceil(seconds / 60);
  if (m >= 60) return `${Math.floor(m / 60)} 小时 ${m % 60} 分钟`;
  return `${m} 分钟`;
}

export { MAX_LOGIN_ATTEMPTS, LOCK_DURATION_SECONDS, SESSION_TTL_SECONDS };
