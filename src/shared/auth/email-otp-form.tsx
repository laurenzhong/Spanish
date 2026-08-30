"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  createWebAuthRepository,
  normalizeEmailAddress,
  type WebAuthRepository,
} from "./web-auth-repository";
import { resolvePostLoginTarget } from "./route-access";

type EmailOtpFormProps = Readonly<{
  repository?: WebAuthRepository | null;
  redirectTo?: string;
}>;

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

export function EmailOtpForm({ repository, redirectTo = "/learn" }: EmailOtpFormProps) {
  const router = useRouter();
  const auth = useMemo(
    () => repository === undefined ? createWebAuthRepository() : repository,
    [repository],
  );
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestOtp(event: FormEvent) {
    event.preventDefault();
    if (!auth || busy) return;
    setBusy(true);
    setError(null);
    try {
      await auth.requestEmailOtp(normalizeEmailAddress(email));
      setOtpSent(true);
    } catch (error) {
      setError(getOtpRequestErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    if (!auth || busy) return;
    setBusy(true);
    setError(null);
    try {
      await auth.verifyEmailOtp(normalizeEmailAddress(email), token.trim());
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

  if (!auth) {
    return (
      <p className="auth-message" role="status">
        当前环境尚未配置 Supabase Auth。请先填写本地环境变量。
      </p>
    );
  }

  return (
    <form className="auth-form" onSubmit={otpSent ? verifyOtp : requestOtp}>
      <label htmlFor="email">邮箱</label>
      <input
        autoComplete="email"
        disabled={busy || otpSent}
        id="email"
        inputMode="email"
        onChange={(event) => setEmail(event.target.value)}
        required
        type="email"
        value={email}
      />

      {otpSent ? (
        <>
          <label htmlFor="otp">六位验证码</label>
          <input
            autoComplete="one-time-code"
            autoFocus
            disabled={busy}
            id="otp"
            inputMode="numeric"
            maxLength={6}
            minLength={6}
            onChange={(event) => setToken(event.target.value.replace(/\D/gu, ""))}
            pattern="[0-9]{6}"
            required
            value={token}
          />
          <button disabled={busy || token.length !== 6} type="submit">
            {busy ? "正在验证…" : "进入学习"}
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setOtpSent(false);
              setToken("");
              setError(null);
            }}
            type="button"
          >
            更换邮箱
          </button>
        </>
      ) : (
        <button disabled={busy || email.trim().length === 0} type="submit">
          {busy ? "正在发送…" : "获取验证码"}
        </button>
      )}

      {error ? <p className="auth-error" role="alert">{error}</p> : null}
    </form>
  );
}
