"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { MediaCard } from "../domain";
import type { MediaListQuery } from "../schemas";
import { MediaCardView } from "./media-card";
import { MediaLibraryToolbar } from "./media-library-toolbar";

export type MediaLibraryResult = Readonly<{
  items: readonly MediaCard[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

type MediaListApiResponse = Readonly<{
  data?: Readonly<{ items?: readonly MediaCard[] }>;
  page?: Readonly<{ nextCursor?: string | null; hasMore?: boolean }>;
}>;

function queryHref(query: MediaListQuery, patch: Partial<Record<keyof MediaListQuery, string | undefined>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, ...patch })) {
    if (value !== undefined && value !== "" && key !== "pageSize" && !(key === "sort" && value === "recently_added")) params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `/learn?${search}` : "/learn";
}

function MediaLibraryContent({ result, query, unavailable = false }: Readonly<{ result: MediaLibraryResult; query: MediaListQuery; unavailable?: boolean }>) {
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [items, setItems] = useState<readonly MediaCard[]>(result.items);
  const [nextCursor, setNextCursor] = useState(result.nextCursor);
  const [hasMore, setHasMore] = useState(result.hasMore);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const hasFilters = Boolean(query.search || query.kind || query.region || query.cefr || query.duration);
  const tabs = [[undefined, "全部"], ["video", "视频"], ["podcast", "播客"]] as const;

  useEffect(() => {
    const updateScrollState = () => {
      scrollFrameRef.current = null;
      const next = window.scrollY > 280;
      setIsScrolled((current) => current === next ? current : next);
    };
    const onScroll = () => {
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(updateScrollState)
        : window.setTimeout(updateScrollState, 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        window.clearTimeout(scrollFrameRef.current);
      }
    };
  }, []);

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || loadingRef.current) return;
    loadingRef.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(false);
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries({ ...query, cursor: nextCursor, pageSize: 18 })) {
        if (value !== undefined && value !== "") params.set(key, String(value));
      }
      const response = await fetch(`/api/v1/media?${params.toString()}`, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("MEDIA_LOAD_MORE_FAILED");
      const payload = await response.json() as MediaListApiResponse;
      const pageItems = payload.data?.items ?? [];
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...pageItems.filter((item) => !seen.has(item.id))];
      });
      setNextCursor(payload.page?.nextCursor ?? null);
      setHasMore(payload.page?.hasMore ?? false);
    } catch {
      setLoadMoreError(true);
    } finally {
      loadingRef.current = false;
      setIsLoadingMore(false);
    }
  }, [hasMore, nextCursor, query]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || loadMoreError || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "480px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, loadMoreError]);

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <>
      <div className="page-stack media-library" data-testid="media-library">
        <header className="media-library__topbar">
          <Link className="media-library__wordmark" href="/learn" aria-label="Sueño 学习首页">Sue<span>ñ</span>o</Link>
          <nav className="media-library__topnav" aria-label="学习频道">
            {tabs.map(([kind, label]) => {
              const href = queryHref(query, { cursor: undefined, kind });
              const active = query.kind === kind || (!query.kind && !kind);
              return <Link aria-current={active ? "page" : undefined} className={pendingHref === href && !active ? "is-pending" : undefined} href={href} prefetch onClick={() => setPendingHref(href)} key={label}>{label}</Link>;
            })}
          </nav>
          <form action="/learn" className="media-library__search" role="search">
            {query.kind ? <input name="kind" type="hidden" value={query.kind} /> : null}
            <label htmlFor="media-search">搜索视频和播客</label>
            <div><input defaultValue={query.search ?? ""} id="media-search" maxLength={120} name="search" placeholder="搜索西语内容" type="search" /><button aria-label="提交搜索" type="submit"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.6" /><path d="m16 16 5 5" /></svg></button></div>
          </form>
        </header>
        <h1 className="sr-only">学习媒体库</h1>
        <MediaLibraryToolbar query={query} />
        {unavailable ? <p className="media-library__notice" role="alert">媒体资料库暂时无法读取，请稍后重试。</p> : null}
        {items.length > 0 ? (
          <div className="media-grid" aria-label="视频和播客">{items.map((item) => <MediaCardView item={item} key={item.id} />)}</div>
        ) : (
          <section className="media-library__empty">
            <p className="eyebrow">{hasFilters ? "没有匹配内容" : "内容准备中"}</p>
            <h2>{hasFilters ? "换个筛选条件看看" : "媒体资料库正在准备中"}</h2>
            <p>{hasFilters ? "当前条件下没有可播放的已发布内容。" : "通过审核的视频和播客会直接出现在这里，不会用示例卡片冒充真实内容。"}</p>
            {hasFilters ? <Link href="/learn">清除筛选</Link> : null}
          </section>
        )}
        {hasMore && nextCursor ? (
          <>
            <div aria-live="polite" className="media-library__load-more-state" ref={loadMoreRef}>
              {isLoadingMore ? "正在加载更多内容…" : loadMoreError ? <><span>加载失败，请重试</span><button type="button" onClick={() => void loadMore()}>重试</button></> : null}
            </div>
            <Link className="media-library__load-more" href={queryHref(query, { cursor: nextCursor })}>加载更多</Link>
          </>
        ) : null}
      </div>
      <div className="media-library__floating-actions" aria-label="页面操作">
        <button aria-label="刷新页面" className="media-library__floating-button" type="button" onClick={() => window.location.reload()}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0 1 4" /><path d="M20 5v6h-6" /></svg>
        </button>
        {isScrolled ? (
          <button aria-label="回到顶部" className="media-library__floating-button" type="button" onClick={scrollToTop}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></svg>
          </button>
        ) : null}
      </div>
    </>
  );
}

export function MediaLibrary(props: Readonly<{ result: MediaLibraryResult; query: MediaListQuery; unavailable?: boolean }>) {
  const queryKey = JSON.stringify(props.query);
  return <MediaLibraryContent key={queryKey} {...props} />;
}
