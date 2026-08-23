import { compare, hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { getRedis } from "@/server/redis/client";

export interface UserSession {
  userId: number;
  username: string;
  role: string;
}

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 3;
const LOCK_DURATION_SECONDS = 5 * 60; // 5 分钟
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 天

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

/** 生成 bcrypt 密码哈希 */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, SALT_ROUNDS);
}

/** 校验明文密码 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return compare(plain, hash);
}

function accountKey(username: string, suffix: string): string {
  return `debt:login_${suffix}:${username.toLowerCase()}`;
}

interface LockStatus {
  locked: boolean;
  remainingSeconds: number;
}

/** 检查账号是否被锁定 */
export async function getLockStatus(username: string): Promise<LockStatus> {
  const redis = getRedis();
  const ttl = await redis.ttl(accountKey(username, "lock"));
  if (ttl > 0) {
    return { locked: true, remainingSeconds: ttl };
  }
  return { locked: false, remainingSeconds: 0 };
}

/** 记录一次登录失败，达到阈值则锁定 */
export async function recordLoginFailure(username: string): Promise<{ locked: boolean; remainingSeconds: number }> {
  const redis = getRedis();
  const key = accountKey(username, "fail");
  const pipeline = redis.pipeline();
  pipeline.incr(key);
  pipeline.expire(key, LOCK_DURATION_SECONDS);
  const [count] = (await pipeline.exec())?.map((r) => r?.[1] as number) ?? [0];

  if (count >= MAX_LOGIN_ATTEMPTS) {
    await redis.setex(accountKey(username, "lock"), LOCK_DURATION_SECONDS, "1");
    // 锁定后失败计数已无用，顺手清理
    await redis.del(key);
    return { locked: true, remainingSeconds: LOCK_DURATION_SECONDS };
  }

  return { locked: false, remainingSeconds: 0 };
}

/** 登录成功后清零失败计数 */
export async function clearLoginFailures(username: string): Promise<void> {
  const redis = getRedis();
  await redis.del(accountKey(username, "fail"), accountKey(username, "lock"));
}

/** 创建 session 并返回 sessionId */
export async function createSession(user: { id: number; username: string; role: string }): Promise<string> {
  const redis = getRedis();
  const sessionId = uuidv4();
  const session: UserSession = {
    userId: user.id,
    username: user.username,
    role: user.role,
  };
  await redis.setex(accountKey(sessionId, "session"), SESSION_TTL_SECONDS, JSON.stringify(session));
  return sessionId;
}

/** 根据 sessionId 获取会话信息 */
export async function getSession(sessionId: string | undefined): Promise<UserSession | null> {
  if (!sessionId) return null;
  const redis = getRedis();
  const raw = await redis.get(accountKey(sessionId, "session"));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserSession;
  } catch {
    return null;
  }
}

/** 删除 session */
export async function deleteSession(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  const redis = getRedis();
  await redis.del(accountKey(sessionId, "session"));
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
  const sessionId = await createSession({ id: user.id, username: user.username, role: user.role });
  return { ok: true, sessionId };
}

/** 初始化测试账号：users 表为空时插入 admin */
export async function seedDefaultAdmin(): Promise<void> {
  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).limit(1);
  if (existing) return;

  const adminUsername = (process.env.ADMIN_USERNAME || "admin").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "admin";
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
