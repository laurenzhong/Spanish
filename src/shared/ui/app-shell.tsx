import type { ReactNode } from "react";

import { BottomNavigation } from "@/src/shared/ui/bottom-navigation";
import { ConnectivityBanner } from "@/src/shared/ui/connectivity-banner";

type AppShellProps = Readonly<{
  children: ReactNode;
}>;

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="product-shell" data-testid="product-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <BottomNavigation />
      <div className="product-stage">
        <ConnectivityBanner />
        <main className="product-content" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
