import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/src/shared/auth/server";
import { AppShell } from "@/src/shared/ui/app-shell";

type ProductLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function ProductLayout({ children }: ProductLayoutProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return <AppShell>{children}</AppShell>;
}
