import { SESSION_TTL_SECONDS } from "./session-token";

export const SESSION_COOKIE = "debt_session";

/** 会话 cookie 统一配置（route handler 写入时用） */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    secure: process.env.NODE_ENV === "production",
  };
}
