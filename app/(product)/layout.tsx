import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/src/shared/auth/server";
import { AppShell } from "@/src/shared/ui/app-shell";

type ProductLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function ProductLayout({ children }: ProductLayoutProps) {
  const user = await getCurrentUser();
  if (!user) {
    const requestHeaders = await headers();
    const nextPath = requestHeaders.get("x-auth-next-path");

    // The proxy sets this header when Supabase could not be reached. Keep the
    // user on a recoverable state instead of redirecting to login and creating
    // a loop that hides the real outage (or a freshly written OTP session).
    if (nextPath) {
      const hasSessionCookie = (await cookies()).getAll().some(({ name }) =>
        name.startsWith("sb-") && name.includes("-auth-token"),
      );
      if (hasSessionCookie) {
        return (
          <main className="auth-page">
            <section className="auth-card" role="alert">
              <p className="eyebrow">登录状态暂时不可用</p>
              <h1>暂时无法验证登录</h1>
              <p>认证服务暂时没有响应，你的登录信息没有被清除。请稍后重新载入。</p>
              <a className="primary-link" href={nextPath}>重新载入</a>
            </section>
          </main>
        );
      }
    }

    redirect("/login");
  }

  return <AppShell>{children}</AppShell>;
}
