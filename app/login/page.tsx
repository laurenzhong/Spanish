import Link from "next/link";

import { EmailOtpForm } from "@/src/shared/auth/email-otp-form";

export default function LoginPage() {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <Link className="auth-back" href="/">← 返回介绍</Link>
        <p className="eyebrow">登录 Spanish</p>
        <h1>用邮箱接收验证码</h1>
        <p>无需设置密码。输入邮件中的六位验证码即可继续。</p>
        <EmailOtpForm />
      </section>
    </main>
  );
}
