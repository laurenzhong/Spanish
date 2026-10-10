"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";

/**
 * The single reading-area navigation. Content libraries come first, the
 * personal shelf last, so the leftmost entries are the public entry points.
 * New destinations must be added to this one list; do not stack a second
 * navigation row with its own styling.
 */
const destinations = [
  { key: "articles", label: "文章", href: "/read" },
  { key: "vocabulary", label: "词汇", href: "/read/vocabulary" },
  { key: "phrases", label: "短语", href: "/read/phrases" },
  { key: "corpus", label: "语料", href: "/read/corpus" },
  { key: "saved-items", label: "已保存", href: "/read/saved-items" },
] as const;

export type ReadSectionKey = (typeof destinations)[number]["key"];

/**
 * A single accent underline serves both the current page and the hovered or
 * focused item: it slides to whatever the pointer or keyboard is on, and
 * settles on `active` otherwise. Links keep their own `aria-current` contract
 * and their static underline stays in the stylesheet as the no-JavaScript
 * fallback; the mounted indicator replaces it once it has been measured.
 */
export function ReadSectionNavigation({ active }: Readonly<{ active: ReadSectionKey }>) {
  const navigationRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const selectedIndexRef = useRef<number | null>(null);

  const activeIndex = destinations.findIndex((destination) => destination.key === active);

  const moveIndicator = useCallback(() => {
    const navigation = navigationRef.current;
    const indicator = indicatorRef.current;
    if (!navigation || !indicator) return;
    const links = Array.from(navigation.querySelectorAll<HTMLElement>("a"));
    const index = selectedIndexRef.current ?? (activeIndex >= 0 ? activeIndex : 0);
    const link = links[index];
    if (!link) return;
    // Keep the indicator box at the container's own origin and move it with a
    // transform: an absolutely placed wide box would widen the scroll area of
    // the overflow-x container on narrow screens. Measuring both rects in the
    // same frame keeps the underline aligned to sub-pixel label widths.
    const navigationRect = navigation.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    indicator.style.transform = `translateX(${linkRect.left - navigationRect.left + navigation.scrollLeft}px)`;
    indicator.style.width = `${linkRect.width}px`;
    indicator.style.opacity = "1";
    navigation.dataset.indicator = "ready";
  }, [activeIndex]);

  useEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return;
    selectedIndexRef.current = null;
    moveIndicator();

    const selectLink = (link: HTMLElement | null) => {
      if (!link) return;
      const links = Array.from(navigation.querySelectorAll<HTMLElement>("a"));
      const index = links.indexOf(link);
      if (index < 0) return;
      selectedIndexRef.current = index;
      moveIndicator();
    };
    const settleOnActive = () => {
      selectedIndexRef.current = null;
      moveIndicator();
    };
    const onPointerOver = (event: PointerEvent) => {
      const link = (event.target as Element | null)?.closest("a");
      if (link instanceof HTMLElement && navigation.contains(link)) selectLink(link);
    };
    const onFocusIn = (event: FocusEvent) => {
      const link = (event.target as Element | null)?.closest("a");
      if (link instanceof HTMLElement && navigation.contains(link)) selectLink(link);
    };
    const reposition = () => moveIndicator();

    navigation.addEventListener("pointerover", onPointerOver);
    navigation.addEventListener("pointerleave", settleOnActive);
    navigation.addEventListener("focusin", onFocusIn);
    navigation.addEventListener("focusout", settleOnActive);
    window.addEventListener("resize", reposition);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition);
    observer?.observe(navigation);
    // Web fonts resize the labels after first paint; re-measure once they land.
    void document.fonts?.ready.then(reposition).catch(() => undefined);

    return () => {
      navigation.removeEventListener("pointerover", onPointerOver);
      navigation.removeEventListener("pointerleave", settleOnActive);
      navigation.removeEventListener("focusin", onFocusIn);
      navigation.removeEventListener("focusout", settleOnActive);
      window.removeEventListener("resize", reposition);
      observer?.disconnect();
    };
  }, [moveIndicator]);

  return (
    <nav className="read-section-navigation" aria-label="阅读内容类型" ref={navigationRef}>
      {destinations.map(({ key, label, href }) => (
        <Link key={key} href={href} aria-current={active === key ? "page" : undefined}>{label}</Link>
      ))}
      <span className="read-section-navigation__indicator" aria-hidden="true" ref={indicatorRef} />
    </nav>
  );
}
