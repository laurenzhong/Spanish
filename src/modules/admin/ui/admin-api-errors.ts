/**
 * Owner-console client error mapping (ACCT-ADMIN-001 slice U1).
 *
 * The API always answers failures with the versioned
 * `{ apiVersion, error: { code, message, retryable } }` envelope. The console
 * never renders the server message verbatim: it maps the stable error code to a
 * short, safe Chinese instruction. That keeps a future server message change
 * from leaking internals into the owner UI and gives one place to review the
 * wording.
 */

const SAFE_MESSAGES: Readonly<Record<string, string>> = {
  AUTH_REQUIRED: "登录状态已失效，请刷新页面并重新登录。",
  ADMIN_FORBIDDEN: "当前账号没有监管权限。",
  ADMIN_UNAVAILABLE: "监管服务暂时不可用，请稍后再试；本次没有修改任何数据。",
  VALIDATION_FAILED: "提交内容不完整或格式不正确，请检查后重试。",
  CONFLICT: "状态已被其他操作改变，请刷新后重试。",
  RESOURCE_NOT_FOUND: "目标不存在或已被删除，请返回列表刷新。",
  RATE_LIMITED: "操作过于频繁，请稍后再试。",
  INVITATION_CONFLICT: "该邮箱已经有一条待处理的邀请。",
  INVITATION_INVALID: "邀请码无效、已过期或已被使用。",
  REGISTRATION_CLOSED: "邀请注册尚未开启，暂时无法创建邀请。",
  ACCOUNT_STATE_CONFLICT: "无法对自己或最后一名所有者执行该操作。",
  ACCOUNT_PROVISIONING_FAILED:
    "账号服务暂时不可用，操作没有完成；账号的访问状态仍以数据库记录为准，请稍后重试。",
  EXPORT_UNAVAILABLE: "导出服务暂时不可用，请稍后重试。",
  PROTOCOL_VERSION_UNSUPPORTED: "页面版本与监管服务不一致，请刷新页面后重试。",
  INTERNAL_ERROR: "监管服务遇到内部错误，请稍后重试；本次没有确认任何修改。",
};

export type AdminErrorPayload = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
}>;

/** Extract the stable `{ code, message, retryable }` triple from a response body. */
export function parseAdminErrorPayload(payload: unknown): AdminErrorPayload | null {
  if (typeof payload !== "object" || payload === null) return null;
  const error = (payload as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const record = error as { code?: unknown; message?: unknown; retryable?: unknown };
  if (typeof record.code !== "string" || record.code.length === 0) return null;
  return {
    code: record.code,
    message: typeof record.message === "string" ? record.message : "",
    retryable: record.retryable === true,
  };
}

/**
 * Map a failed admin write to a safe user-facing sentence. The fallback is used
 * when the response is not the expected envelope (network failure, proxy error,
 * malformed body) so a write is never reported as successful.
 */
export function adminActionErrorMessage(
  payload: unknown,
  fallback = "操作未完成，请稍后重试；没有确认任何修改。",
): string {
  const parsed = parseAdminErrorPayload(payload);
  if (!parsed) return fallback;
  return SAFE_MESSAGES[parsed.code] ?? `${fallback}（错误码：${parsed.code}）`;
}

/** True when the failure means the session/role no longer allows the action. */
export function isAdminSessionError(payload: unknown): boolean {
  const parsed = parseAdminErrorPayload(payload);
  return parsed?.code === "AUTH_REQUIRED" || parsed?.code === "ADMIN_FORBIDDEN";
}
