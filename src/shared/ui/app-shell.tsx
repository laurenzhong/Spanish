import type { ReactNode } from "react";
import Link from "next/link";

import { BottomNavigation } from "@/src/shared/ui/bottom-navigation";
import { ConnectivityBanner } from "@/src/shared/ui/connectivity-banner";
import { DesktopNavigation } from "@/src/shared/ui/desktop-navigation";

type AppShellProps = Readonly<{
  children: ReactNode;
}>;

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="product-shell" data-testid="product-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <DesktopNavigation />
      <BottomNavigation />
      <div className="product-stage">
        <div className="mobile-product-header">
          <Link className="mobile-product-header__wordmark" href="/" aria-label="Sueño 首页">
            Sue<span>ñ</span>o
          </Link>
        </div>
        <ConnectivityBanner />
        <main className="product-content" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
