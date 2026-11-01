"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button, Input, Label } from "@/src/shared/ui/primitives";

import { normalizeEmailAddress } from "./web-auth-repository";

const REDEEM_ENDPOINT = "/api/v1/auth/invitations/redeem";

/**
 * Stable, non-enumerating copy for the public invitation redemption form
 * (ACCT-ADMIN-001 design §3.3/§6.2). Every invitation problem — unknown code,
 * expired, revoked, already used or email mismatch — shares one message so the
 * endpoint cannot be used to learn whether an account or invitation exists.
 */
const joinErrorMessages: Readonly<Record<string, string>> = {
  REGISTRATION_CLOSED: "邀请注册尚未开启，请联系所有者。",
  INVITATION_INVALID: "邀请码无效、已过期或邮箱不匹配。",
  RATE_LIMITED: "尝试次数过多，请稍后再试。",
  ACCOUNT_PROVISIONING_FAILED: "账号创建暂时未完成，请联系所有者重试。",
  VALIDATION_FAILED: "请检查邀请码和邮箱格式后重试。",
};

const GENERIC_ERROR_MESSAGE = "邀请兑换暂时不可用，请稍后重试。";
const NETWORK_ERROR_MESSAGE = "暂时无法连接服务器，请检查网络后重试。";

/** The input always shows the canonical uppercase form and drops stray spaces. */
export function normalizeInvitationCodeInput(value: string): string {
  return value.replace(/\s+/gu, "").toUpperCase();
}

function readErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function readReadyEmail(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const candidate = data as { status?: unknown; email?: unknown };
  if (candidate.status !== "ready") return null;
  return typeof candidate.email === "string" && candidate.email.trim()
    ? candidate.email.trim()
    : null;
}

/**
 * Public `/join` form: redeem a one-time invitation code, then hand the invited
 * email to `/login?step=otp`. It never signs anyone in and never logs the code
 * or the plain email.
 */
export function JoinForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const canSubmit = !busy && code.trim().length > 0 && email.trim().length > 0;

  async function redeemInvitation(event: FormEvent) {
    event.preventDefault();
    if (busy || !canSubmit) return;

    const normalizedEmail = normalizeEmailAddress(email);
    setBusy(true);
    setError(null);
    setStatus("正在激活邀请…");

    try {
      const response = await fetch(REDEEM_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ code: code.trim(), email: normalizedEmail }),
      });

      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const errorCode = readErrorCode(payload);
        setStatus(null);
        setError(
          errorCode && joinErrorMessages[errorCode]
            ? joinErrorMessages[errorCode]
            : GENERIC_ERROR_MESSAGE,
        );
        return;
      }

      const activatedEmail = readReadyEmail(payload) ?? normalizedEmail;
      setStatus("邀请已激活，正在打开登录页…");
      router.replace(
        `/login?email=${encodeURIComponent(activatedEmail)}&step=otp`,
      );
    } catch {
      setStatus(null);
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form join-form" aria-busy={busy} onSubmit={redeemInvitation}>
      <Label htmlFor="invitation-code">邀请码</Label>
      <Input
        aria-describedby="invitation-code-hint"
        autoCapitalize="characters"
        autoComplete="off"
        disabled={busy}
        id="invitation-code"
        inputMode="text"
        maxLength={64}
        name="invitation-code"
        onChange={(event) => setCode(normalizeInvitationCodeInput(event.target.value))}
        placeholder="SN-INV-XXXX-XXXX-XXXX"
        required
        spellCheck={false}
        type="text"
        value={code}
      />
      <p className="auth-hint" id="invitation-code-hint">
        邀请码会自动转为大写并去掉空格；连字符可以省略。
      </p>

      <Label htmlFor="invitation-email">邮箱</Label>
      <Input
        autoComplete="email"
        disabled={busy}
        id="invitation-email"
        inputMode="email"
        name="email"
        onChange={(event) => setEmail(event.target.value)}
        placeholder="与邀请时使用的邮箱一致"
        required
        type="email"
        value={email}
      />

      <Button disabled={!canSubmit} type="submit">
        {busy ? "正在激活…" : "激活账号"}
      </Button>

      {status ? <p className="auth-message" role="status">{status}</p> : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
    </form>
  );
}
