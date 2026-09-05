/** 统一错误类型：actions 层 catch 后转为结构化错误返回前端 */

export class UnauthorizedError extends Error {
  readonly code = "UNAUTHORIZED";
  constructor(message = "未登录或登录已过期，请重新登录") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN";
  constructor(message = "没有权限执行该操作") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class DbUnavailableError extends Error {
  readonly code = "DB_UNAVAILABLE";
  constructor(message = "数据库连接失败，请稍后重试") {
    super(message);
    this.name = "DbUnavailableError";
  }
}

export class ValidationError extends Error {
  readonly code = "VALIDATION";
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND";
  constructor(message = "记录不存在") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class BusinessRuleError extends Error {
  readonly code = "BUSINESS_RULE";
  constructor(message: string) {
    super(message);
    this.name = "BusinessRuleError";
  }
}

export type ActionError = { code: string; message: string };
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

export function toActionError(err: unknown): ActionError {
  if (
    err instanceof DbUnavailableError ||
    err instanceof ValidationError ||
    err instanceof NotFoundError ||
    err instanceof BusinessRuleError
  ) {
    return { code: err.code, message: err.message };
  }
  // mysql2 / 网络层错误统一视为数据库不可用
  const anyErr = err as { code?: string; message?: string };
  const msg = anyErr?.message ?? "未知错误";
  if (
    typeof anyErr?.code === "string" &&
    /^(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|PROTOCOL_|ER_|HANDSHAKE)/.test(anyErr.code)
  ) {
    return { code: "DB_UNAVAILABLE", message: "数据库连接失败，请检查网络或数据库配置后重试" };
  }
  console.error("[unhandled]", err);
  return { code: "INTERNAL", message: msg };
}
