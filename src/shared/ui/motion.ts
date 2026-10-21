/**
 * JavaScript-driven motion has to honour the same preference as the stylesheet.
 *
 * `globals.css` neutralises CSS animations and transitions under
 * `prefers-reduced-motion`, but it cannot reach imperative calls such as
 * `scrollTo({ behavior: "smooth" })`. Any script that animates the viewport or
 * an element must ask here first.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Smooth only when the reader has not asked for reduced motion. */
export function preferredScrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
