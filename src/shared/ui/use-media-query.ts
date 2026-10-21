"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query currently matches.
 *
 * A client component sometimes has to change its *structure*, not only its styles:
 * a panel that is a grid column on a desktop has to leave that grid on a phone,
 * because `position: fixed` is resolved against the nearest ancestor that carries
 * a transform — and this page's wrapper (`.page-stack`) carries an identity
 * `matrix(1,0,0,1,0,0)`, which still counts. A fixed bottom sheet that stays in
 * the grid therefore renders off-screen (`top: -437px` at a 390×844 viewport),
 * which is why the phone layout needs a portal and a portal needs this answer in
 * JavaScript.
 *
 * `useSyncExternalStore` is the same mechanism the shelf already uses for
 * browser-local marks: one subscription per query, and a server snapshot so
 * rendering during hydration does not depend on the viewport.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/**
 * Below this width the word panel is a bottom sheet over the shelf rather than a
 * column beside it. It matches the stylesheet's own breakpoint, in one place so
 * the structure and the styles cannot drift apart.
 */
export const wordPanelSheetQuery = "(max-width: 900px)";
