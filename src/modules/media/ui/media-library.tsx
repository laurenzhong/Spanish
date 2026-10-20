"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { MediaCard } from "../domain";
import type { MediaListQuery } from "../schemas";
import { SlideableNavigation } from "@/src/shared/ui/slideable-navigation";
import { preferredScrollBehavior } from "@/src/shared/ui/motion";
import { MediaCardView } from "./media-card";
import { MediaLibraryToolbar } from "./media-library-toolbar";
import { mediaQueryHref, useMediaLibrary } from "./use-media-library";

export type MediaLibraryResult = Readonly<{
  items: readonly MediaCard[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

function queryHref(query: MediaListQuery, patch: Partial<MediaListQuery>): string {
  return mediaQueryHref({ ...query, ...patch });
}

function MediaLibraryContent({ result, query, unavailable = false }: Readonly<{ result: MediaLibraryResult; query: MediaListQuery; unavailable?: boolean }>) {
  const library = useMediaLibrary(result, query, unavailable);
  const { items, query: activeQuery, nextCursor, hasMore, loading, error, isLoadingMore, loadMoreError, loadKind, loadMore } = library;
  const isSwitchingKind = loading === "channel";
  const failed = library.unavailable || library.batchFailed || Boolean(error);
  const [isScrolled, setIsScrolled] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const hasFilters = Boolean(activeQuery.search || activeQuery.kind || activeQuery.topic || activeQuery.region || activeQuery.cefr || activeQuery.duration);
  const tabs = [[undefined, "全部"], ["video", "视频"], ["podcast", "播客"]] as const;

  useEffect(() => {
    let frame: number | null = null;
    let scrolled = false;
    const updateScrollState = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const next = window.scrollY > 280;
        if (next !== scrolled) { scrolled = next; setIsScrolled(next); }
      });
    };
    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });
    return () => {
      window.removeEventListener("scroll", updateScrollState);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !hasMore || !nextCursor || loading || isLoadingMore || loadMoreError || typeof IntersectionObserver === "undefined") return;
    let active = true;
    const observer = new IntersectionObserver((entries) => {
      if (active && entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "1200px 0px" });
    observer.observe(sentinel);
    // Recheck after each append: a sentinel that stays in the margin does not
    // produce another threshold crossing on its own.
    return () => { active = false; observer.disconnect(); };
  }, [hasMore, nextCursor, isLoadingMore, loadMore, loadMoreError, loading]);

  return (
    <>
      <div className="page-stack media-library" data-testid="media-library" aria-busy={Boolean(loading)}>
        <header className="media-library__topbar">
          <Link className="media-library__wordmark" href="/learn" aria-label="Sueño 学习首页">Sue<span>ñ</span>o</Link>
          <SlideableNavigation
            className="media-library__topnav"
            label="学习频道"
            activeKey={activeQuery.kind ?? "all"}
            items={tabs.map(([kind, label]) => ({
              key: kind ?? "all", label,
              href: queryHref(activeQuery, { cursor: undefined, kind }),
              current: activeQuery.kind === kind || (!activeQuery.kind && !kind),
              pending: isSwitchingKind && activeQuery.kind !== kind,
            }))}
            indicatorClassName="media-library__topnav-indicator"
            onSelect={(item) => {
              const kind = item.key === "all" ? undefined : item.key as "video" | "podcast";
              if (kind === activeQuery.kind) return library.browse ? true : false;
              void loadKind(kind, item.href);
            }}
          />
          <MediaLibraryToolbar query={activeQuery} browsing={Boolean(library.browse)} onBrowse={() => void library.changeBatch()} />
          <form action="/learn" className="media-library__search" role="search">
            {Object.entries(activeQuery).filter(([key, value]) => key !== "search" && key !== "cursor" && key !== "pageSize" && value !== undefined).map(([key, value]) => <input key={key} name={key} type="hidden" value={String(value)} />)}
            {library.browse ? <input name="view" type="hidden" value="browse" /> : null}
            <label htmlFor="media-search">搜索视频和播客</label>
            <div><input defaultValue={activeQuery.search ?? ""} id="media-search" maxLength={120} name="search" placeholder="搜索西语内容" type="search" /><button aria-label="提交搜索" type="submit"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.6" /><path d="m16 16 5 5" /></svg></button></div>
          </form>
        </header>
        {loading && loading !== "batch" ? <p className="media-library__load-more-state" role="status">{loading === "channel" ? "正在切换内容…" : loading === "restore" ? "正在恢复内容…" : "正在重新读取资料库…"}</p> : null}
        {error && items.length > 0 ? <p className="media-library__notice" role="alert">{error}</p> : null}
        {library.exhausted ? <p className="media-library__load-more-state" role="status">当前条件下已浏览全部内容。<button disabled={Boolean(loading)} type="button" onClick={() => void library.changeBatch(true)}>重新浏览</button></p> : null}
        {items.length > 0 ? (
          <div className="media-grid" aria-label="视频和播客">
            {items.map((item, index) => <MediaCardView item={item} key={item.id} priority={index < 4} />)}
          </div>
        ) : loading ? null : failed ? (
          <section className="media-library__empty" role="alert">
            <p className="eyebrow">暂时无法读取</p><h2>媒体资料库暂时无法读取</h2>
            <p>{error ?? "媒体资料库暂时无法读取，请稍后重试。"}</p>
            <button type="button" onClick={() => void library.retry()}>重试</button>
          </section>
        ) : (
          <section className="media-library__empty">
            <p className="eyebrow">{hasFilters ? "没有匹配内容" : "内容准备中"}</p>
            <h2>{hasFilters ? "换个筛选条件看看" : "媒体资料库正在准备中"}</h2>
            <p>{hasFilters ? "当前条件下没有可播放的已发布内容。" : "通过审核的视频和播客会直接出现在这里，不会用示例卡片冒充真实内容。"}</p>
          </section>
        )}
        {hasMore && nextCursor ? (
          <>
            <div aria-live="polite" className="media-library__load-more-state" ref={loadMoreRef}>
              {isLoadingMore ? "正在加载更多内容…" : loadMoreError ? <><span>{loadMoreError}</span><button type="button" onClick={() => loadMoreError.includes("重新换一批") ? void library.changeBatch() : void loadMore()}>{loadMoreError.includes("重新换一批") ? "重新换一批" : "重试"}</button></> : null}
            </div>
            {!isLoadingMore && !loadMoreError ? <button className="media-library__load-more" disabled={Boolean(loading)} type="button" onClick={() => void loadMore()}>加载更多</button> : null}
          </>
        ) : null}
      </div>
      <div className="media-library__floating-actions" aria-label="页面操作">
        <button aria-label="换一批" title="换一批" className="media-library__floating-button" disabled={Boolean(loading)} type="button" onClick={() => void library.changeBatch()}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0 1 4" /><path d="M20 5v6h-6" /></svg>
        </button>
        {isScrolled ? (
          <button aria-label="回到顶部" className="media-library__floating-button" type="button" onClick={() => window.scrollTo({ top: 0, behavior: preferredScrollBehavior() })}>
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></svg>
          </button>
        ) : null}
      </div>
    </>
  );
}

export function MediaLibrary(props: Readonly<{ result: MediaLibraryResult; query: MediaListQuery; unavailable?: boolean }>) {
  return <MediaLibraryContent key={JSON.stringify(props.query)} {...props} />;
}
