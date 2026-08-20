"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigationItems = [
  { href: "/learn", label: "学习", icon: "learn" },
  { href: "/explore", label: "探索", icon: "explore" },
  { href: "/chat", label: "对话", icon: "chat" },
  { href: "/me", label: "我的", icon: "profile" },
] as const;

type NavigationIconProps = Readonly<{
  name: (typeof navigationItems)[number]["icon"];
}>;

function NavigationIcon({ name }: NavigationIconProps) {
  if (name === "learn") {
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
        <path d="M5 17.5 3.5 21l4.2-1.4c1.3.6 2.7.9 4.3.9 5 0 9-3.7 9-8.3S17 4 12 4s-9 3.7-9 8.2c0 2 .7 3.8 2 5.3Z" />
        <path d="M8 12h.01M12 12h.01M16 12h.01" />
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

  return (
    <nav className="primary-navigation" aria-label="主要导航">
      <div className="brand-lockup" aria-hidden="true">
        <span>S</span>
        <div>
          <strong>Spanish</strong>
          <small>说出来，才真正属于你</small>
        </div>
      </div>
      <div className="navigation-items">
        {navigationItems.map((item) => {
          const isCurrent =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              aria-current={isCurrent ? "page" : undefined}
              className="navigation-link"
              href={item.href}
              key={item.href}
            >
              <span className="navigation-icon">
                <NavigationIcon name={item.icon} />
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
