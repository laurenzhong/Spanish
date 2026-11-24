import Link from "next/link";

import { EmailOtpForm } from "@/src/shared/auth/email-otp-form";
// Adapted from shadcn/ui login-03 (MIT); source/license in docs/superpowers/references/shadcn-login-03/.
import { Card, CardContent, CardHeader, CardTitle } from "@/src/shared/ui/primitives";
import styles from "./login.module.css";

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string | string[];
    email?: string | string[];
    step?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const next = firstValue(params.next);
  const email = firstValue(params.email)?.trim() ?? "";
  const startsAtOtpStep = firstValue(params.step) === "otp" && email.length > 0;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
      <Link href="/" className={styles.brand} aria-label="Sueño 首页">
        <span className={styles.mark} aria-hidden="true">S</span>Sueño
      </Link>
      <Card className={styles.card} aria-labelledby="login-title">
        <CardHeader className={styles.header}>
          <CardTitle><h1 id="login-title" className={styles.title}>欢迎回来</h1></CardTitle>
        </CardHeader>
        <CardContent className={styles.content}>
          <EmailOtpForm
          initialEmail={email}
          initialStep={startsAtOtpStep ? "otp" : "email"}
          redirectTo={next}
          />
        </CardContent>
      </Card>
      </div>
    </main>
  );
}
