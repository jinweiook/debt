/**
 * 旧版 APP_PASSWORD 密码门工具，已废弃。
 * 现由 Redis session 方案替代，保留此文件仅兼容历史引用。
 */

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function expectedAuthToken(password: string): Promise<string> {
  return sha256Hex(password);
}

export async function isValidAuthToken(token: string | undefined, password: string): Promise<boolean> {
  if (!token) return false;
  const expected = await expectedAuthToken(password);
  return token.length === expected.length && token === expected;
}
