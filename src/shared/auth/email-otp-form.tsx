"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  createWebAuthRepository,
  type WebAuthRepository,
} from "./web-auth-repository";

type EmailOtpFormProps = Readonly<{
  repository?: WebAuthRepository | null;
}>;

export function EmailOtpForm({ repository }: EmailOtpFormProps) {
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
      await auth.requestEmailOtp(email.trim());
      setOtpSent(true);
    } catch {
      setError("验证码发送失败，请稍后重试。");
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
      await auth.verifyEmailOtp(email.trim(), token.trim());
      router.replace("/learn");
      router.refresh();
    } catch {
      setError("验证码无效或已经过期，请重新获取。");
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
