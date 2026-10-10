"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, type ReactNode } from "react";

export type SlideableNavigationItem = Readonly<{
  /** Stable identity for the indicator, usually the destination key. */
  key: string;
  label: ReactNode;
  href: string;
  /** Marks the item as the one the indicator settles on. */
  current?: boolean;
  className?: string;
}>;

type SlideableNavigationProps = Readonly<{
  /** Container class name; the stylesheet owns the item spacing and the indicator look. */
  className: string;
  label: string;
  items: readonly SlideableNavigationItem[];
  /** Key of the resting item. Without one the indicator rests on the first visible item. */
  activeKey?: string;
  indicatorClassName?: string;
}>;

/**
 * One underline for a horizontal navigation: it slides to whatever the pointer
 * or keyboard is on and settles on the current item (or the first visible one)
 * otherwise. Callers own the markup contract, the active semantics
 * (`aria-current`) and every visual rule; this component only measures and
 * moves the indicator.
 *
 * The indicator is a transform-driven element, so it never widens the scroll
 * area of a horizontally scrollable container. Callers keep their own item
 * underline as the no-JavaScript fallback and may hide it once this component
 * reports `data-indicator="ready"`.
 */
export function SlideableNavigation({
  className,
  label,
  items,
  activeKey,
  indicatorClassName = "slideable-navigation__indicator",
}: SlideableNavigationProps) {
  const navigationRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const selectedIndexRef = useRef<number | null>(null);

  const visibleLinks = useCallback((navigation: HTMLElement) => {
    const links = Array.from(navigation.querySelectorAll<HTMLElement>("a"));
    // Hidden items (phone widths drop some destinations) have no measurable box.
    return { links, visible: links.filter((link) => link.getBoundingClientRect().width > 0) };
  }, []);

  const moveIndicator = useCallback(() => {
    const navigation = navigationRef.current;
    const indicator = indicatorRef.current;
    if (!navigation || !indicator) return;
    const { links, visible } = visibleLinks(navigation);
    if (!visible.length) return;
    const activeIndex = items.findIndex((item) => item.key === activeKey);
    const activeLink = activeIndex >= 0 ? links[activeIndex] : undefined;
    // Resting position: the current item when it is visible, otherwise the first
    // visible item (phone widths hide leading destinations).
    const restingIndex = activeLink && visible.includes(activeLink) ? visible.indexOf(activeLink) : 0;
    // A stored index may point at a hidden destination (for example after a
    // phone-width breakpoint change), so fall back to the resting item.
    const link = visible[selectedIndexRef.current ?? restingIndex] ?? visible[restingIndex];
    if (!link) return;
    // Keep the indicator box at the container's own origin and move it with a
    // transform, measuring both rects in the same frame so the underline stays
    // aligned to sub-pixel label widths.
    const navigationRect = navigation.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    // Callers may nudge the underline vertically with
    // `--slideable-navigation-offset-y` when the item text is not flush with
    // the container's bottom edge (for example the public home header).
    const offsetY = Number.parseFloat(getComputedStyle(navigation).getPropertyValue("--slideable-navigation-offset-y")) || 0;
    indicator.style.transform = `translateX(${linkRect.left - navigationRect.left + navigation.scrollLeft}px) translateY(${offsetY}px)`;
    indicator.style.width = `${linkRect.width}px`;
    indicator.style.opacity = "1";
    navigation.dataset.indicator = "ready";
  }, [activeKey, items, visibleLinks]);

  useEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return;
    selectedIndexRef.current = null;
    moveIndicator();

    const selectLink = (link: Element | null) => {
      if (!(link instanceof HTMLElement) || !navigation.contains(link)) return;
      const { visible } = visibleLinks(navigation);
      const index = visible.indexOf(link);
      if (index < 0) return;
      selectedIndexRef.current = index;
      moveIndicator();
    };
    const settle = () => {
      selectedIndexRef.current = null;
      moveIndicator();
    };
    const reposition = () => moveIndicator();
    const fromEvent = (event: Event) => (event.target as Element | null)?.closest("a") ?? null;
    const onPointerOver = (event: PointerEvent) => selectLink(fromEvent(event));
    const onFocusIn = (event: FocusEvent) => selectLink(fromEvent(event));

    navigation.addEventListener("pointerover", onPointerOver);
    navigation.addEventListener("pointerleave", settle);
    navigation.addEventListener("focusin", onFocusIn);
    navigation.addEventListener("focusout", settle);
    window.addEventListener("resize", reposition);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition);
    observer?.observe(navigation);
    // Web fonts resize the labels after first paint; re-measure once they land.
    void document.fonts?.ready.then(reposition).catch(() => undefined);

    return () => {
      navigation.removeEventListener("pointerover", onPointerOver);
      navigation.removeEventListener("pointerleave", settle);
      navigation.removeEventListener("focusin", onFocusIn);
      navigation.removeEventListener("focusout", settle);
      window.removeEventListener("resize", reposition);
      observer?.disconnect();
    };
  }, [moveIndicator, visibleLinks]);

  return (
    <nav className={className} aria-label={label} ref={navigationRef}>
      {items.map((item) => (
        <Link key={item.key} className={item.className} href={item.href} aria-current={item.current ? "page" : undefined}>{item.label}</Link>
      ))}
      <span className={indicatorClassName} aria-hidden="true" ref={indicatorRef} />
    </nav>
  );
}
