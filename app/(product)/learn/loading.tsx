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

export default function LearnLoading() {
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
        <nav className="media-library__topnav" aria-label="学习频道">
          <span>全部</span><span>视频</span><span>播客</span>
        </nav>
        <div className="media-library__search media-library__search--loading" aria-hidden="true">
          <div className="media-library__search-loading-field">
            <span />
            <span className="media-library__search-loading-icon" />
          </div>
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
