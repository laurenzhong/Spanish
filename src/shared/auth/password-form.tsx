"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  createWebAuthRepository,
  type WebAuthRepository,
} from "./web-auth-repository";

export function PasswordForm({
  repository,
}: Readonly<{ repository?: WebAuthRepository | null }>) {
  const router = useRouter();
  const auth = useMemo(
    () => repository === undefined ? createWebAuthRepository() : repository,
    [repository],
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!auth || busy) return;
    setBusy(true);
    setError(null);
    try {
      await auth.signInWithPassword(email.trim(), password);
      router.replace("/learn");
      router.refresh();
    } catch {
      setError("邮箱或密码不正确。");
    } finally {
      setBusy(false);
    }
  }

  if (!auth) {
    return <p className="auth-message">当前环境尚未配置 Supabase Auth。</p>;
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label htmlFor="reviewer-email">邮箱</label>
      <input
        autoComplete="email"
        id="reviewer-email"
        onChange={(event) => setEmail(event.target.value)}
        required
        type="email"
        value={email}
      />
      <label htmlFor="reviewer-password">密码</label>
      <input
        autoComplete="current-password"
        id="reviewer-password"
        minLength={6}
        onChange={(event) => setPassword(event.target.value)}
        required
        type="password"
        value={password}
      />
      <button disabled={busy} type="submit">
        {busy ? "正在登录…" : "登录测试账号"}
      </button>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
    </form>
  );
}
