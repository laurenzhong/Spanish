"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

const navigationItems = [
  { href: "/learn", label: "学习", icon: "learn" },
  { href: "/explore", label: "探索", icon: "explore" },
  { href: "/chat", label: "对话", icon: "chat" },
  { href: "/me", label: "我的", icon: "profile" },
] as const;

type NavigationIconProps = Readonly<{
  name: (typeof navigationItems)[number]["icon"];
}>;

type Theme = "light" | "dark";

function getPreferredTheme(): Theme {
  if (typeof window === "undefined") return "light";

  const storedTheme = window.localStorage.getItem("spanish-theme");
  if (storedTheme === "dark" || storedTheme === "light") {
    return storedTheme;
  }

  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function subscribeToTheme(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("spanish-theme-change", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("spanish-theme-change", onStoreChange);
  };
}

function getServerTheme(): Theme {
  return "light";
}

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
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getPreferredTheme,
    getServerTheme,
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    window.localStorage.setItem("spanish-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.dispatchEvent(new Event("spanish-theme-change"));
  }

  return (
    <nav className="primary-navigation" aria-label="主要导航">
      <div className="brand-lockup" aria-hidden="true">
        <span>S</span>
        <div>
          <strong>Sueño</strong>
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
      <button
        className="navigation-utility"
        onClick={toggleTheme}
        type="button"
        aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
        title={theme === "dark" ? "浅色模式" : "深色模式"}
      >
        <span className="navigation-utility__icon" aria-hidden="true">
          {theme === "dark" ? (
            <svg viewBox="0 0 24 24">
              <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3.5" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          )}
        </span>
      </button>
    </nav>
  );
}
