/**
 * Same-origin write client for the owner console (ACCT-ADMIN-001 slice U1).
 *
 * Every management action goes through `/api/v1/admin/*`; the browser never
 * talks to the database or Supabase. Requests carry:
 *   - `content-type: application/json`
 *   - a per-attempt `x-request-id` so a failed action can be traced server-side
 *   - `credentials: "same-origin"` and `cache: "no-store"` so an owner session
 *     cookie is used and no cached response can masquerade as a new result
 *   - an `Idempotency-Key` for destructive/retryable actions (deletion)
 *
 * A non-2xx response, an unreadable body or a network failure all return a safe
 * mapped message; nothing here ever reports success optimistically.
 */

import { adminActionErrorMessage } from "./admin-api-errors";

export type AdminWriteResult =
  | Readonly<{ ok: true; data: unknown }>
  | Readonly<{ ok: false; message: string }>;

export type AdminWriteRequest = Readonly<{
  path: string;
  method: "POST" | "PATCH";
  body: Readonly<Record<string, unknown>>;
  /** Send an `Idempotency-Key` (account deletion requires it). */
  idempotency?: boolean;
  fallbackMessage?: string;
}>;

export async function sendAdminWrite(
  request: AdminWriteRequest,
): Promise<AdminWriteResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-request-id": crypto.randomUUID(),
  };
  if (request.idempotency) {
    headers["idempotency-key"] = crypto.randomUUID();
  }

  let response: Response;
  try {
    response = await fetch(request.path, {
      method: request.method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: JSON.stringify(request.body),
    });
  } catch {
    return {
      ok: false,
      message: "网络连接中断，操作未完成；没有任何修改被确认。",
    };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      message: adminActionErrorMessage(payload, request.fallbackMessage),
    };
  }

  const data =
    typeof payload === "object" && payload !== null
      ? (payload as { data?: unknown }).data
      : undefined;
  return { ok: true, data: data ?? null };
}
