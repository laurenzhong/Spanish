import type { ReactNode } from "react";
import { headers } from "next/headers";
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
    redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  }

  return <AppShell>{children}</AppShell>;
}
