"use client";

import { useEffect } from "react";

export function ThemeInitializer() {
  useEffect(() => {
    const storedTheme = window.localStorage.getItem("spanish-theme");
    const theme =
      storedTheme === "dark" || storedTheme === "light"
        ? storedTheme
        : typeof window.matchMedia === "function" &&
            window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";

    document.documentElement.dataset.theme = theme;
  }, []);

  return null;
}
