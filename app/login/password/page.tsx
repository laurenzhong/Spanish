import Link from "next/link";

import { PasswordForm } from "@/src/shared/auth/password-form";

export default function ReviewerLoginPage() {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <Link className="auth-back" href="/login">← 返回验证码登录</Link>
        <p className="eyebrow">预建测试账号</p>
        <h1>邮箱和密码</h1>
        <p>这个入口只用于已经由管理员创建的个人 Alpha 测试账号。</p>
        <PasswordForm />
      </section>
    </main>
  );
}
