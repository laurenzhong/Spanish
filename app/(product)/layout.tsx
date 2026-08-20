import type { ReactNode } from "react";

import { AppShell } from "@/src/shared/ui/app-shell";

type ProductLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function ProductLayout({ children }: ProductLayoutProps) {
  return <AppShell>{children}</AppShell>;
}
