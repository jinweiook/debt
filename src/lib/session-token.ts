/**
 * 会话 token：base64url(JSON payload) + "." + base64url(HMAC-SHA256)。
 * 只用 globalThis.crypto.subtle（Web Crypto），Edge middleware 与 Node runtime 通用；
 * 禁止在本文件 import node:* 模块。
 */

export interface SessionPayload {
  /** users.id */
  uid: string;
  /** users.token_version，改密/禁用后旧 token 失效 */
  tv: number;
  /** 过期时间（Unix 秒） */
  exp: number;
}

export const SESSION_TTL_SECONDS = 7 * 24 * 3600; // 7 天

const encoder = new TextEncoder();

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("缺少环境变量 AUTH_SECRET（生产环境必须配置随机字符串）");
  }
  return "debt-local-dev-secret";
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function createSessionToken(uid: string, tokenVersion: number): Promise<string> {
  const payload: SessionPayload = {
    uid,
    tv: tokenVersion,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const body = bytesToB64url(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(authSecret()), encoder.encode(body));
  return `${body}.${bytesToB64url(new Uint8Array(sig))}`;
}

/** 验签 + 过期检查；任何不合法都返回 null（不抛错，方便 middleware 粗判） */
export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(authSecret()),
      b64urlToBytes(sig) as BufferSource,
      encoder.encode(body),
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))) as SessionPayload;
    if (!payload.uid || typeof payload.tv !== "number" || typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
