"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button, Input, Label } from "@/src/shared/ui/primitives";

import {
  createWebAuthRepository,
  type WebAuthRepository,
} from "./web-auth-repository";
import { resolvePostLoginTarget } from "./route-access";

export function PasswordForm({
  repository,
  redirectTo = "/learn",
}: Readonly<{ repository?: WebAuthRepository | null; redirectTo?: string }>) {
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
      router.replace(resolvePostLoginTarget(redirectTo));
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
      <Label htmlFor="reviewer-email">邮箱</Label>
      <Input
        autoComplete="email"
        id="reviewer-email"
        onChange={(event) => setEmail(event.target.value)}
        required
        type="email"
        value={email}
      />
      <Label htmlFor="reviewer-password">密码</Label>
      <Input
        autoComplete="current-password"
        id="reviewer-password"
        minLength={6}
        onChange={(event) => setPassword(event.target.value)}
        required
        type="password"
        value={password}
      />
      <Button disabled={busy} type="submit">
        {busy ? "正在登录…" : "登录测试账号"}
      </Button>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
    </form>
  );
}
