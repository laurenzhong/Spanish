"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export const navigationGroups = [
  {
    label: "开始",
    items: [
      { href: "/learn", label: "学习", icon: "learn" },
      { href: "/read", label: "阅读", icon: "read" },
    ],
  },
  {
    label: "发现",
    items: [
      { href: "/explore", label: "探索", icon: "explore" },
      { href: "/chat", label: "对话", icon: "chat" },
    ],
  },
  {
    label: "账户",
    items: [{ href: "/me", label: "我的", icon: "profile" }],
  },
] as const;

export type NavigationIconName = "learn" | "read" | "explore" | "chat" | "profile";

export function NavigationIcon({ name }: Readonly<{ name: NavigationIconName }>) {
  if (name === "learn") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M5 17.5 3.8 20.4l3.4-1.1c1.4.7 3 1.1 4.8 1.1 4.8 0 8.2-3.2 8.2-7.2S16.8 6 12 6 3.8 9.2 3.8 13.2c0 1.6.4 3 1.2 4.3Z" />
        <path d="M8.2 13.2h.01M12 13.2h.01M15.8 13.2h.01" />
      </svg>
    );
  }

  if (name === "read") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" />
        <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z" />
      </svg>
    );
  }

  if (name === "explore") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8.5" />
        <path d="m15.5 8.5-2.1 4.9-4.9 2.1 2.1-4.9 4.9-2.1Z" />
      </svg>
    );
  }

  if (name === "chat") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4.5 15.6 3.6 19l3.3-1.1c1.2.5 2.5.8 3.9.8 4.4 0 7.7-2.9 7.7-6.5S15.2 5.7 10.8 5.7 3 8.6 3 12.2c0 1.3.5 2.5 1.5 3.4Z" />
        <path d="M13.4 18.2c.9 1 2.3 1.6 4 1.6 1.1 0 2.1-.2 3-.7l1.8.6-.7-2.1c.6-.7 1-1.5 1-2.4 0-1.8-1.3-3.4-3.2-4.1" />
        <path d="M8.2 12.3h.01M10.8 12.3h.01M13.4 12.3h.01" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6" />
    </svg>
  );
}

export function BottomNavigation() {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  return (
    <nav className="primary-navigation" aria-label="主要导航">
      <Link className="brand-lockup" href="/" aria-label="Sueño 首页">
        <span className="brand-lockup__wordmark">Sue<span>ñ</span>o</span>
        <small>把话说出来</small>
      </Link>
      <div className="navigation-groups">
        {navigationGroups.map((group) => (
          <div className="navigation-group" key={group.label}>
            <div className="navigation-items">
              {group.items.map((item) => {
                const isCurrent =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <Link
                    aria-current={isCurrent ? "page" : undefined}
                    className="navigation-link"
                    href={item.href}
                    key={item.href}
                    onClick={() => setPendingHref(item.href)}
                    data-pending={pendingHref === item.href && pathname !== item.href ? "true" : undefined}
                  >
                    <span className="navigation-icon">
                      <NavigationIcon name={item.icon} />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}
