"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  createWebAuthRepository,
  normalizeEmailAddress,
  type WebAuthRepository,
} from "./web-auth-repository";
import { resolvePostLoginTarget } from "./route-access";
import { Alert, Button, Field, FieldLabel, Input, OtpInput } from "@/src/shared/ui/primitives";

type EmailOtpFormProps = Readonly<{
  repository?: WebAuthRepository | null;
  redirectTo?: string;
  /** Pre-fill from `/login?email=…` (e.g. after redeeming an invitation). */
  initialEmail?: string;
  /** `"otp"` opens directly on the code step after an invitation is activated. */
  initialStep?: "email" | "otp";
}>;

/** Client-side resend cooldown (design §3.1); the server also rate limits. */
const OTP_RESEND_COOLDOWN_SECONDS = 60;

/**
 * Free registration is enabled (ADR-0022): an unknown email gets an account on
 * the first OTP request. This fallback only appears when the Supabase project
 * itself disables signups (`disable_signup`), so the message must not imply that
 * an invitation is required.
 */
const REGISTRATION_DISABLED_MESSAGE =
  "当前未开放新账号创建，请稍后再试或联系所有者。";

const INVITATION_NOTICE = "邀请已激活，请输入邮箱验证码。";
const CODE_SENT_NOTICE = "验证码已发送，请查收邮件。";

function isRegistrationDisabledError(code: string, message: string): boolean {
  if (code === "otp_disabled" || code === "signup_disabled") {
    return true;
  }
  return /not allowed for otp|signups? not allowed|signups? (?:are )?disabled|signup is disabled/iu.test(
    message,
  );
}

function getOtpRequestErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") {
    return "验证码发送失败，请稍后重试。";
  }

  const candidate = error as {
    code?: unknown;
    message?: unknown;
    status?: unknown;
  };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const name = typeof (error as { name?: unknown }).name === "string"
    ? (error as { name: string }).name
    : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";

  if (
    name === "AuthRetryableFetchError" ||
    /failed to fetch|network error|connection reset|fetch failed/iu.test(message)
  ) {
    return "暂时无法连接认证服务，请检查网络后重试。";
  }

  if (isRegistrationDisabledError(code, message)) {
    return REGISTRATION_DISABLED_MESSAGE;
  }

  if (
    candidate.status === 429 ||
    code.includes("rate") ||
    /rate limit|after \d+ seconds|security purposes/iu.test(message)
  ) {
    const waitSeconds = message.match(/(\d+)\s*seconds?/iu)?.[1];
    return waitSeconds
      ? `验证码发送太频繁，请等待 ${waitSeconds} 秒后再试。`
      : "验证码发送太频繁，请稍后再试；如果之前已收到验证码，请直接填写。";
  }

  if (code === "email_address_invalid") {
    return "邮箱地址无效，请检查后重试。";
  }

  return "验证码发送失败，请稍后重试。";
}

function getOtpVerifyErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") {
    return "验证码无效或已经过期，请重新输入。";
  }

  const candidate = error as {
    message?: unknown;
    name?: unknown;
  };
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const name = typeof candidate.name === "string" ? candidate.name : "";

  if (
    name === "AuthRetryableFetchError" ||
    /failed to fetch|network error|connection reset|fetch failed/iu.test(message)
  ) {
    return "暂时无法连接认证服务，请检查网络后重试。";
  }

  return "验证码无效或已经过期，请重新输入。";
}

export function EmailOtpForm({
  repository,
  redirectTo = "/learn",
  initialEmail = "",
  initialStep = "email",
}: EmailOtpFormProps) {
  const router = useRouter();
  const auth = useMemo(
    () => repository === undefined ? createWebAuthRepository() : repository,
    [repository],
  );
  const startsAtOtpStep = initialStep === "otp" && initialEmail.trim().length > 0;
  const [email, setEmail] = useState(initialEmail);
  const [token, setToken] = useState("");
  const [otpSent, setOtpSent] = useState(startsAtOtpStep);
  // Landing on the code step after an invitation still needs one explicit
  // "send code" action: the redemption endpoint never emails a code, and a URL
  // must not be able to trigger unsolicited OTP emails on its own.
  const [codeRequested, setCodeRequested] = useState(!startsAtOtpStep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    startsAtOtpStep ? INVITATION_NOTICE : null,
  );
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // A chained timeout keeps the countdown alive without an interval that could
  // survive unmount; the cleanup runs on every tick change, on navigation and
  // on unmount.
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setTimeout(() => {
      setCooldownSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownSeconds]);

  async function sendOtp() {
    if (!auth || busy) return;
    setBusy(true);
    setError(null);
    try {
      await auth.requestEmailOtp(normalizeEmailAddress(email));
      setOtpSent(true);
      setCodeRequested(true);
      setNotice(CODE_SENT_NOTICE);
      setCooldownSeconds(OTP_RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      setError(getOtpRequestErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function requestOtp(event: FormEvent) {
    event.preventDefault();
    await sendOtp();
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    if (!auth || busy) return;
    setBusy(true);
    setError(null);
    try {
      await auth.verifyEmailOtp(normalizeEmailAddress(email), token.trim());
      setCooldownSeconds(0);
      setNotice(null);
      router.replace(resolvePostLoginTarget(redirectTo));
      // The page we came from may be cached as an anonymous RSC payload.
      // Refresh after the auth cookie is written so the destination's server
      // components and auth gate observe the newly verified session.
      router.refresh();
    } catch (error) {
      setToken("");
      setError(getOtpVerifyErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function changeEmail() {
    setOtpSent(false);
    setCodeRequested(true);
    setToken("");
    setError(null);
    setNotice(null);
    setCooldownSeconds(0);
  }

  if (!auth) {
    return (
      <Alert variant="warning" className="auth-message">
        当前环境尚未配置 Supabase Auth。请先填写本地环境变量。
      </Alert>
    );
  }

  const showSendCodeAction = otpSent && !codeRequested;

  return (
    <form
      className="auth-form email-otp-form"
      aria-busy={busy}
      onSubmit={showSendCodeAction ? (event) => { event.preventDefault(); void sendOtp(); } : otpSent ? verifyOtp : requestOtp}
    >
      <Field>
      <FieldLabel htmlFor="email">邮箱</FieldLabel>
      <Input
        autoComplete="email"
        disabled={busy || otpSent}
        id="email"
        inputMode="email"
        onChange={(event) => setEmail(event.target.value)}
        required
        type="email"
        placeholder="name@example.com"
        value={email}
        aria-describedby={error ? "login-error" : undefined}
      />
      </Field>

      {otpSent ? (
        <>
          <Field>
          <FieldLabel htmlFor="otp">六位验证码</FieldLabel>
          <OtpInput
            autoFocus
            disabled={busy}
            id="otp"
            minLength={6}
            onChange={setToken}
            pattern="[0-9]{6}"
            required
            value={token}
            aria-label="六位验证码"
            aria-describedby={error ? "login-error" : undefined}
          />
          </Field>
          {showSendCodeAction ? (
            <Button loading={busy} disabled={busy || email.trim().length === 0} type="button" onClick={() => void sendOtp()}>
              {busy ? "正在发送…" : "发送验证码"}
            </Button>
          ) : (
            <>
              <Button loading={busy} disabled={busy || token.length !== 6} type="submit">
                {busy ? "正在验证…" : "进入学习"}
              </Button>
              <Button
                size="sm"
                variant="quiet"
                className="text-button"
                disabled={busy || cooldownSeconds > 0}
                onClick={() => void sendOtp()}
                type="button"
              >
                {cooldownSeconds > 0 ? `重新发送（${cooldownSeconds} 秒）` : "重新发送验证码"}
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="quiet"
            className="text-button"
            disabled={busy}
            onClick={changeEmail}
            type="button"
          >
            更换邮箱
          </Button>
        </>
      ) : (
        <Button loading={busy} disabled={busy || email.trim().length === 0} type="submit">
          {busy ? "正在发送…" : "获取验证码"}
        </Button>
      )}

      {notice ? <Alert variant="success" className="auth-message">{notice}</Alert> : null}
      {error ? <Alert variant="danger" id="login-error" className="auth-error">{error}</Alert> : null}
    </form>
  );
}
