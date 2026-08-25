import Link from "next/link";

import { EmailOtpForm } from "@/src/shared/auth/email-otp-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = Array.isArray(params.next) ? params.next[0] : params.next;

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Link className="auth-back" href="/">← 返回介绍</Link>
        <p className="eyebrow">登录 Sueño</p>
        <h1>用邮箱接收验证码</h1>
        <p>无需设置密码。输入邮件中的六位验证码即可继续。</p>
        <EmailOtpForm redirectTo={next} />
      </section>
    </main>
  );
}
