"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { AccountMenu } from "./account-menu";
import { NavigationIcon, navigationGroups } from "./bottom-navigation";

export function DesktopNavigation() {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  return (
    <nav
      aria-label="桌面主要导航"
      className="desktop-navigation"
    >
      <Link className="desktop-navigation__brand-link" href="/" aria-label="Sueño 首页">
        <span aria-hidden="true">S</span>
      </Link>
      <div className="desktop-navigation__groups">
        {navigationGroups.map((group) => (
          <div className="desktop-navigation__group" key={group.label}>
            <div className="desktop-navigation__items">
              {group.items.map((item) => {
                const isCurrent = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    aria-current={isCurrent ? "page" : undefined}
                    className="desktop-navigation__link"
                    href={item.href}
                    key={item.href}
                    title={item.label}
                    onClick={() => setPendingHref(item.href)}
                    data-pending={pendingHref === item.href && pathname !== item.href ? "true" : undefined}
                    prefetch
                  >
                    <span className="desktop-navigation__icon"><NavigationIcon name={item.icon} /></span>
                    <span className="desktop-navigation__label">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="desktop-navigation__account"><AccountMenu /></div>
    </nav>
  );
}
