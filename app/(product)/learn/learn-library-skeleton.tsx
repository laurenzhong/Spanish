"use client";

import { useEffect, useRef, useState } from "react";

function getSkeletonCount(grid: HTMLDivElement): number {
  const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
  const firstCard = grid.querySelector<HTMLElement>(".media-card--skeleton");
  const rowHeight = firstCard?.getBoundingClientRect().height || Math.max(220, grid.clientWidth / columns * 0.72);
  const gridTop = grid.getBoundingClientRect().top;
  const visibleRows = Math.ceil(Math.max(window.innerHeight - gridTop, rowHeight) / rowHeight);
  return Math.max(columns * 2, Math.min(columns * (visibleRows + 1), 24));
}

/**
 * The real library skeleton: the adaptive card grid `/learn` fills with real
 * media. It lives inside the page instead of the route-level `loading.tsx`, so
 * it is only shown for the library itself (direct visit, filter/search
 * navigation). Navigating from a card into a media subroute no longer displays
 * this grid: the route-level fallback is the neutral shell in `loading.tsx`.
 */
export function LearnLibrarySkeleton() {
  const gridRef = useRef<HTMLDivElement>(null);
  const [skeletonCount, setSkeletonCount] = useState(8);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let frame = 0;
    const updateCount = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setSkeletonCount((current) => {
          const next = getSkeletonCount(grid);
          return current === next ? current : next;
        });
      });
    };
    updateCount();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateCount);
    resizeObserver?.observe(grid);
    window.addEventListener("resize", updateCount, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateCount);
    };
  }, []);

  return (
    <div className="page-stack media-library media-library--loading" data-testid="learn-loading" aria-busy="true">
      <header className="media-library__topbar">
        <span className="media-library__wordmark" aria-hidden="true">Sue<span>ñ</span>o</span>
        <nav className="media-library__topnav" aria-label="学习频道">
          <span>全部</span><span>视频</span><span>播客</span>
        </nav>
        {/* The controls reserve the same slot they occupy once the library has
            loaded, so the channel tabs and the search field do not move when
            the real header replaces this one. */}
        <div className="media-library__toolbar media-library__toolbar--loading" aria-hidden="true">
          <span /><span />
        </div>
        {/* The field is placeholders only: no drawn magnifier, which read as a
            stray icon next to a nearly empty box. */}
        <div className="media-library__search media-library__search--loading" aria-hidden="true">
          <div className="media-library__search-loading-field"><span /></div>
        </div>
      </header>
      <div className="media-grid media-grid--loading" aria-hidden="true" ref={gridRef}>
        {Array.from({ length: skeletonCount }, (_, index) => (
          <article className="media-card media-card--skeleton" key={index}>
            <div className="media-card__art" />
            <div className="media-card__body">
              <div className="media-card__skeleton-meta"><span /><span /></div>
              <div className="media-card__skeleton-title"><span /><span /></div>
              <div className="media-card__skeleton-source"><span /><span /></div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
