"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { MediaCard } from "../domain";
import { mediaTopicFilters } from "../domain";
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
  const [gridColumns, setGridColumns] = useState(1);
  const gridRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const pendingPagesRef = useRef(new Map<string, Promise<MediaPage>>());
  const pageCacheRef = useRef(new Map<string, MediaPage>());
  const kindCacheRef = useRef(new Map<string, MediaPage>([[JSON.stringify(query), result]]));
  const kindRequestRef = useRef(0);
  const hasFilters = Boolean(activeQuery.search || activeQuery.kind || activeQuery.topic || activeQuery.region || activeQuery.cefr || activeQuery.duration);
  const tabs = [[undefined, "全部"], ["video", "视频"], ["podcast", "播客"]] as const;

  const loadKind = useCallback(async (kind: "video" | "podcast" | undefined, href: string, pushHistory = true) => {
    const nextQuery = { ...activeQuery, kind, cursor: undefined };
    const key = JSON.stringify(nextQuery);
    const requestId = ++kindRequestRef.current;
    setActiveQuery(nextQuery);
    setIsSwitchingKind(true);
    setKindLoadError(false);
    // Keep the current grid visible while the next channel is loading. Clearing
    // it first made navigation feel blocked and caused the layout to jump.
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
      const params = new URLSearchParams(window.location.search);
      const kind = params.get("kind");
      if (kind === (activeQuery.kind ?? "")) return;
      const href = `${window.location.pathname}${window.location.search}`;
      void loadKind(kind === "video" || kind === "podcast" ? kind : undefined, href, false);
    };
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, [activeQuery.kind, loadKind]);

  useEffect(() => {
    const updateScrollState = () => {
      const scrollTop = Math.max(
        window.scrollY,
        document.documentElement.scrollTop,
        document.body.scrollTop,
      );
      setIsScrolled(scrollTop > 280);
    };
    window.addEventListener("scroll", updateScrollState, { passive: true, capture: true });
    document.addEventListener("scroll", updateScrollState, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", updateScrollState, true);
      document.removeEventListener("scroll", updateScrollState, true);
    };
  }, []);

  const requestPage = useCallback((cursor: string): Promise<MediaPage> => {
    const pageKey = `${JSON.stringify(activeQuery)}:${cursor}`;
    const cached = pageCacheRef.current.get(pageKey);
    if (cached) return Promise.resolve(cached);
    const pending = pendingPagesRef.current.get(pageKey);
    if (pending) return pending;

    const request = (async () => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries({ ...activeQuery, cursor, pageSize: 24 })) {
        if (value !== undefined && value !== "") params.set(key, String(value));
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 20_000);
        try {
          const response = await fetch(`/api/v1/media?${params.toString()}`, { headers: { accept: "application/json" }, signal: controller.signal });
          if (!response.ok) {
            if (response.status >= 400 && response.status < 500) throw new Error("MEDIA_LOAD_MORE_FAILED");
            throw new Error("MEDIA_LOAD_MORE_RETRYABLE");
          }
          const payload = await response.json() as MediaListApiResponse;
          const page: MediaPage = {
            items: payload.data?.items ?? [],
            nextCursor: payload.page?.nextCursor ?? null,
            hasMore: payload.page?.hasMore ?? false,
          };
          pageCacheRef.current.set(pageKey, page);
          return page;
        } catch (error) {
          if (attempt === 1 || (error instanceof Error && error.message === "MEDIA_LOAD_MORE_FAILED")) throw error;
          await new Promise((resolve) => window.setTimeout(resolve, 250));
        } finally {
          window.clearTimeout(timeout);
        }
      }
      throw new Error("MEDIA_LOAD_MORE_FAILED");
    })();
    pendingPagesRef.current.set(pageKey, request);
    void request.then(
      () => pendingPagesRef.current.delete(pageKey),
      () => pendingPagesRef.current.delete(pageKey),
    );
    return request;
  }, [activeQuery]);

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || loadingRef.current) return;
    loadingRef.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(false);
    try {
      const page = await requestPage(nextCursor);
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      setLoadMoreError(true);
    } finally {
      loadingRef.current = false;
      setIsLoadingMore(false);
    }
  }, [hasMore, nextCursor, requestPage]);

  useEffect(() => {
    if (!hasMore || !nextCursor) return;
    // Prefetching is opportunistic. A slow or temporarily unavailable
    // prefetch must not show an error before the user reaches the sentinel;
    // the explicit loadMore path owns the visible retry state.
    void requestPage(nextCursor).catch(() => undefined);
  }, [hasMore, nextCursor, requestPage]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const updateGridColumns = () => {
      const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
      setGridColumns((current) => current === columns || columns < 1 ? current : columns);
    };
    updateGridColumns();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateGridColumns);
    observer?.observe(grid);
    window.addEventListener("resize", updateGridColumns);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateGridColumns);
    };
  }, []);

  useEffect(() => {
    if (gridColumns < 2 || isLoadingMore || loadMoreError || !hasMore || !nextCursor) return;
    if (items.length % gridColumns === 0) return;
    const frame = window.setTimeout(() => void loadMore(), 0);
    return () => window.clearTimeout(frame);
  }, [gridColumns, hasMore, isLoadingMore, items.length, loadMore, loadMoreError, nextCursor]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || loadMoreError || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "720px 0px" });
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
        <h1 className="media-library__heading">看点、听点真实西语</h1>
        <nav className="media-library__topics" aria-label="内容主题">
          <Link aria-current={!activeQuery.topic ? "page" : undefined} href={queryHref(activeQuery, { cursor: undefined, topic: undefined })}>全部主题</Link>
          {mediaTopicFilters.map((topic) => {
            const href = queryHref(activeQuery, { cursor: undefined, topic: topic.value });
            return <Link aria-current={activeQuery.topic === topic.value ? "page" : undefined} href={href} key={topic.value}>{topic.label}</Link>;
          })}
        </nav>
        <MediaLibraryToolbar query={activeQuery} />
        {unavailable || kindLoadError ? <p className="media-library__notice" role="alert">媒体资料库暂时无法读取，请稍后重试。</p> : null}
        {isSwitchingKind ? <p className="media-library__load-more-state" role="status">正在切换内容…</p> : null}
        {items.length > 0 ? (
          <div className="media-grid" aria-label="视频和播客" ref={gridRef}>
            {items.map((item, index) => <MediaCardView item={item} key={item.id} priority={index < 6} />)}
          </div>
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
            {!isLoadingMore && !loadMoreError ? <Link className="media-library__load-more" href={queryHref(query, { cursor: nextCursor })}>加载更多</Link> : null}
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
