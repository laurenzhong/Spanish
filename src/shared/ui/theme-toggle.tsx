"use client";

import { useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

function getPreferredTheme(): Theme {
  if (typeof window === "undefined") return "light";

  const storedTheme = window.localStorage.getItem("spanish-theme");
  if (storedTheme === "dark" || storedTheme === "light") return storedTheme;

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

function ThemeIcon({ theme }: Readonly<{ theme: Theme }>) {
  if (theme === "dark") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function ThemeToggle({ compact = false }: Readonly<{ compact?: boolean }>) {
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
    <button
      className={compact ? "theme-toggle theme-toggle--compact" : "theme-toggle"}
      onClick={toggleTheme}
      type="button"
      aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
      title={theme === "dark" ? "浅色模式" : "深色模式"}
    >
      <ThemeIcon theme={theme} />
      {!compact ? <span>{theme === "dark" ? "浅色模式" : "深色模式"}</span> : null}
    </button>
  );
}
