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

type MediaPage = Readonly<{
  items: readonly MediaCard[];
  nextCursor: string | null;
  hasMore: boolean;
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
  const [activeQuery, setActiveQuery] = useState(query);
  const [items, setItems] = useState<readonly MediaCard[]>(result.items);
  const [nextCursor, setNextCursor] = useState(result.nextCursor);
  const [hasMore, setHasMore] = useState(result.hasMore);
  const [isSwitchingKind, setIsSwitchingKind] = useState(false);
  const [kindLoadError, setKindLoadError] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const kindCacheRef = useRef(new Map<string, MediaPage>([[JSON.stringify(query), result]]));
  const kindRequestRef = useRef(0);
  const hasFilters = Boolean(activeQuery.search || activeQuery.kind || activeQuery.region || activeQuery.cefr || activeQuery.duration);
  const tabs = [[undefined, "全部"], ["video", "视频"], ["podcast", "播客"]] as const;

  const loadKind = useCallback(async (kind: "video" | "podcast" | undefined, href: string, pushHistory = true) => {
    const nextQuery = { ...activeQuery, kind, cursor: undefined };
    const key = JSON.stringify(nextQuery);
    const requestId = ++kindRequestRef.current;
    setActiveQuery(nextQuery);
    setIsSwitchingKind(true);
    setKindLoadError(false);
    setItems([]);
    setNextCursor(null);
    setHasMore(false);
    if (pushHistory) window.history.pushState(null, "", href);

    const cached = kindCacheRef.current.get(key);
    if (cached) {
      setItems(cached.items);
      setNextCursor(cached.nextCursor);
      setHasMore(cached.hasMore);
      setIsSwitchingKind(false);
      return;
    }

    try {
      const params = new URLSearchParams();
      for (const [param, value] of Object.entries({ ...nextQuery, cursor: undefined, pageSize: 20 })) {
        if (value !== undefined && value !== "") params.set(param, String(value));
      }
      const response = await fetch(`/api/v1/media?${params.toString()}`, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("MEDIA_KIND_LOAD_FAILED");
      const payload = await response.json() as MediaListApiResponse;
      const page: MediaPage = {
        items: payload.data?.items ?? [],
        nextCursor: payload.page?.nextCursor ?? null,
        hasMore: payload.page?.hasMore ?? false,
      };
      kindCacheRef.current.set(key, page);
      if (requestId !== kindRequestRef.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      if (requestId !== kindRequestRef.current) return;
      setKindLoadError(true);
    } finally {
      if (requestId === kindRequestRef.current) setIsSwitchingKind(false);
    }
  }, [activeQuery]);

  useEffect(() => {
    const syncFromHistory = () => {
      const kind = new URLSearchParams(window.location.search).get("kind");
      if (kind === (activeQuery.kind ?? "")) return;
      void loadKind(kind === "video" || kind === "podcast" ? kind : undefined, `${window.location.pathname}${window.location.search}`, false);
    };
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, [activeQuery.kind, loadKind]);

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
      for (const [key, value] of Object.entries({ ...activeQuery, cursor: nextCursor, pageSize: 18 })) {
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
  }, [activeQuery, hasMore, nextCursor]);

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
      <div className="page-stack media-library" data-testid="media-library" aria-busy={isSwitchingKind}>
        <header className="media-library__topbar">
          <Link className="media-library__wordmark" href="/learn" aria-label="Sueño 学习首页">Sue<span>ñ</span>o</Link>
          <nav className="media-library__topnav" aria-label="学习频道">
            {tabs.map(([kind, label]) => {
              const href = queryHref(activeQuery, { cursor: undefined, kind });
              const active = activeQuery.kind === kind || (!activeQuery.kind && !kind);
              return <Link aria-current={active ? "page" : undefined} href={href} onClick={(event) => { event.preventDefault(); if (!active) void loadKind(kind, href); }} key={label}>{label}</Link>;
            })}
          </nav>
          <form action="/learn" className="media-library__search" role="search">
            {activeQuery.kind ? <input name="kind" type="hidden" value={activeQuery.kind} /> : null}
            <label htmlFor="media-search">搜索视频和播客</label>
            <div><input defaultValue={activeQuery.search ?? ""} id="media-search" maxLength={120} name="search" placeholder="搜索西语内容" type="search" /><button aria-label="提交搜索" type="submit"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.6" /><path d="m16 16 5 5" /></svg></button></div>
          </form>
        </header>
        <h1 className="sr-only">学习媒体库</h1>
        <MediaLibraryToolbar query={activeQuery} />
        {unavailable || kindLoadError ? <p className="media-library__notice" role="alert">媒体资料库暂时无法读取，请稍后重试。</p> : null}
        {isSwitchingKind ? <p className="media-library__load-more-state" role="status">正在切换内容…</p> : null}
        {items.length > 0 ? (
          <div className="media-grid" aria-label="视频和播客">{items.map((item) => <MediaCardView item={item} key={item.id} />)}</div>
        ) : isSwitchingKind ? null : kindLoadError ? (
          <section className="media-library__empty" role="alert">
            <p className="eyebrow">暂时无法读取</p>
            <h2>媒体资料库暂时无法读取</h2>
            <p>网络恢复后可以重新选择频道。</p>
            <button type="button" onClick={() => void loadKind(activeQuery.kind, queryHref(activeQuery, { cursor: undefined }), false)}>重试</button>
          </section>
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
