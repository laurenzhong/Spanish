"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";
import type { MediaBrowseQuery, MediaListQuery } from "../schemas";
import { mediaArtworkSchema, mediaBrowseQuerySchema, mediaStableKeySchema } from "../schemas";
import { mediaSeriesSummarySchema } from "../schemas/media-series";
import type { MediaCard } from "../domain";
import type { MediaLibraryResult } from "./media-library";

const pageSchema = z.object({
  data: z.object({ items: z.array(z.object({
    id: z.string(), stableKey: mediaStableKeySchema, version: z.number().int().positive(),
    kind: z.enum(["video", "podcast"]), title: z.string(), summary: z.string(), sourceName: z.string(),
    language: z.string(), region: z.string().nullable(), cefr: z.enum(["A1", "A2", "B1", "B2"]).nullable(),
    topics: z.array(z.string()), durationMs: z.number().int().positive(), publishedAt: z.string().nullable(),
    curatedAt: z.string(), contentHash: z.string(), artwork: mediaArtworkSchema.nullable().optional(),
    series: mediaSeriesSummarySchema.nullable().optional(),
    progress: z.object({ lastPositionMs: z.number().int().nonnegative(), lastSegmentIndex: z.number().int().nonnegative().nullable(), status: z.enum(["in_progress", "completed"]), revision: z.number().int().positive() }).nullable(),
  })).max(50) }),
  page: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() }),
});
const snapshotSchema = z.object({
  request: mediaBrowseQuerySchema,
  pages: z.number().int().min(1).max(100),
  scrollY: z.number().nonnegative(),
  seen: z.array(z.string()).max(1000),
});
type Snapshot = z.infer<typeof snapshotSchema>;
type LibraryState = MediaLibraryResult & {
  query: MediaListQuery;
  browse: MediaBrowseQuery | null;
  pages: number;
};
type Loading = "batch" | "channel" | "restore" | "retry" | null;

function filtersOf(query: MediaListQuery): MediaBrowseQuery["filters"] {
  const { search, kind, topic, region, cefr, duration } = query;
  return Object.fromEntries(Object.entries({ search, kind, topic, region, cefr, duration }).filter(([, value]) => value !== undefined));
}

export function mediaQueryHref(query: MediaListQuery, browse = false): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "" && key !== "pageSize" && !(key === "sort" && value === "recently_added")) params.set(key, String(value));
  }
  if (browse) params.set("view", "browse");
  return `/learn${params.size ? `?${params}` : ""}`;
}

export function useMediaLibrary(result: MediaLibraryResult, query: MediaListQuery, initiallyUnavailable = false) {
  const [state, setState] = useState<LibraryState>({ ...result, query, browse: null, pages: 1 });
  const [unavailable, setUnavailable] = useState(initiallyUnavailable);
  const [loading, setLoading] = useState<Loading>(null);
  const [error, setError] = useState<string | null>(null);
  const [batchFailed, setBatchFailed] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const generation = useRef(0);
  const busy = useRef(false);
  const moreBusy = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  const pending = useRef(new Map<string, Promise<MediaLibraryResult>>());
  const cache = useRef(new Map<string, MediaLibraryResult>());
  const seen = useRef(new Set(result.items.map((item) => item.stableKey)));
  const restoreFrame = useRef<number | null>(null);
  const restorePosition = useRef<{ id: number; top: number } | null>(null);
  const restoringPosition = useRef(false);
  const navigatingAway = useRef(false);
  const scrollSaveTimer = useRef<number | null>(null);

  const cancelScrollSave = useCallback(() => {
    if (scrollSaveTimer.current !== null) window.clearTimeout(scrollSaveTimer.current);
    scrollSaveTimer.current = null;
  }, []);

  const stopRequests = useCallback(() => {
    cancelScrollSave();
    ++generation.current;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
    if (restoreFrame.current !== null) window.cancelAnimationFrame(restoreFrame.current);
    restorePosition.current = null;
    restoringPosition.current = false;
  }, [cancelScrollSave]);

  const remember = useCallback((items: readonly MediaCard[]) => {
    for (const item of items) seen.current.add(item.stableKey);
    // A bounded recent-display window; do not grow history without limit.
    seen.current = new Set([...seen.current].slice(-1000));
  }, []);
  const publish = useCallback((next: LibraryState) => {
    stateRef.current = next;
    setState(next);
    setUnavailable(false);
    remember(next.items);
  }, [remember]);
  const saveHistory = useCallback((next: LibraryState, scrollY = window.scrollY, updateUrl = false) => {
    if (window.location.pathname !== "/learn") return;
    const snapshot: Snapshot | null = next.browse ? {
      request: next.browse, pages: next.pages, scrollY, seen: [...seen.current],
    } : null;
    window.history.replaceState({ ...window.history.state, mediaBrowse: snapshot }, "", updateUrl ? mediaQueryHref({ ...next.query, cursor: undefined }, Boolean(next.browse)) : undefined);
  }, []);
  const invalidate = useCallback(() => {
    cancelScrollSave();
    const id = ++generation.current;
    setBatchFailed(false);
    if (restoreFrame.current !== null) window.cancelAnimationFrame(restoreFrame.current);
    restorePosition.current = null;
    restoringPosition.current = false;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
    pending.current.clear();
    cache.current.clear();
    moreBusy.current = false;
    setIsLoadingMore(false);
    setLoadMoreError(null);
    return id;
  }, [cancelScrollSave]);

  const fetchPage = useCallback(async (current: LibraryState, cursor?: string): Promise<MediaLibraryResult> => {
    const request = current.browse ? { ...current.browse, cursor } : { ...current.query, cursor, pageSize: 24 };
    const key = JSON.stringify(request);
    const cached = cache.current.get(key);
    if (cached) return cached;
    const inFlight = pending.current.get(key);
    if (inFlight) return inFlight;
    const id = generation.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    // Full-catalogue reads plus a cold dev route can exceed twenty seconds.
    // Keep a bounded wait while allowing a successful browse response to finish.
    const timeout = window.setTimeout(() => controller.abort(), current.browse ? 45_000 : 20_000);
    const promise = (async () => {
      try {
        const params = new URLSearchParams();
        if (!current.browse) for (const [param, value] of Object.entries(request)) {
          if (value !== undefined && value !== "") params.set(param, String(value));
        }
        const response = await fetch(current.browse ? "/api/v1/media/browse" : `/api/v1/media?${params}`, {
          method: current.browse ? "POST" : "GET",
          headers: { accept: "application/json", ...(current.browse ? { "content-type": "application/json" } : {}) },
          ...(current.browse ? { body: JSON.stringify(request) } : {}),
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error(response.status === 400 ? "MEDIA_CURSOR_INVALID" : "MEDIA_LOAD_FAILED");
        const payload = pageSchema.parse(await response.json());
        if (controller.signal.aborted || id !== generation.current) throw new Error("MEDIA_CANCELLED");
        const page: MediaLibraryResult = {
          items: payload.data.items, nextCursor: payload.page.nextCursor, hasMore: payload.page.hasMore,
        };
        if (page.hasMore && !page.nextCursor) throw new Error("MEDIA_RESPONSE_INVALID");
        cache.current.set(key, page);
        return page;
      } finally {
        window.clearTimeout(timeout);
        controllers.current.delete(controller);
        if (id === generation.current) pending.current.delete(key);
      }
    })();
    pending.current.set(key, promise);
    return promise;
  }, []);

  const changeBatch = useCallback(async (restart = false) => {
    if (busy.current) return;
    busy.current = true;
    const id = invalidate();
    setLoading("batch");
    setError(null);
    const current = stateRef.current;
    const request: MediaBrowseQuery = {
      filters: filtersOf(current.query), seed: crypto.randomUUID(),
      exclude: restart ? [] : [...seen.current], pageSize: 24,
    };
    const next = { ...current, browse: request, pages: 1 };
    try {
      const page = await fetchPage(next);
      if (id !== generation.current) return;
      if (page.items.length === 0 && !restart && seen.current.size > 0) {
        setExhausted(true);
        return;
      }
      if (restart) seen.current.clear();
      const updated = { ...next, ...page };
      publish(updated);
      setExhausted(false);
      saveHistory(updated, 0, true);
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch {
      if (id === generation.current) setBatchFailed(true);
    } finally {
      if (id === generation.current) { busy.current = false; setLoading(null); }
    }
  }, [fetchPage, invalidate, publish, saveHistory]);

  const loadKind = useCallback(async (kind: "video" | "podcast" | undefined, href: string, pushHistory = true, retrying = false) => {
    const current = stateRef.current;
    const id = invalidate();
    busy.current = true;
    setLoading(retrying ? "retry" : "channel");
    setError(null);
    setExhausted(false);
    const nextQuery = { ...current.query, kind, cursor: undefined };
    const next: LibraryState = {
      ...current, query: nextQuery, pages: 1,
      browse: current.browse ? { filters: filtersOf(nextQuery), seed: crypto.randomUUID(), exclude: [], pageSize: 24 } : null,
    };
    try {
      const page = await fetchPage(next);
      if (id !== generation.current) return;
      seen.current.clear();
      const updated = { ...next, ...page };
      if (pushHistory) window.history.pushState(null, "", href);
      publish(updated);
      saveHistory(updated, 0, true);
    } catch {
      if (id === generation.current) setError(retrying ? "读取失败，请重试。" : "切换内容失败，请重试。");
    } finally {
      if (id === generation.current) { busy.current = false; setLoading(null); }
    }
  }, [fetchPage, invalidate, publish, saveHistory]);

  const retry = useCallback(() => {
    if (busy.current) return;
    const current = stateRef.current;
    return loadKind(current.query.kind, mediaQueryHref(current.query, Boolean(current.browse)), false, true);
  }, [loadKind]);

  const loadMore = useCallback(async () => {
    const current = stateRef.current;
    if (busy.current || moreBusy.current || !current.hasMore || !current.nextCursor) return;
    const id = generation.current;
    moreBusy.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await fetchPage(current, current.nextCursor);
      if (id !== generation.current) return;
      const identities = new Set(current.items.map((item) => item.stableKey));
      const updated = { ...current, ...page, pages: current.pages + 1, items: [...current.items, ...page.items.filter((item) => !identities.has(item.stableKey))] };
      publish(updated);
      if (current.browse) saveHistory(updated);
    } catch (cause) {
      if (id === generation.current) setLoadMoreError(cause instanceof Error && cause.message === "MEDIA_CURSOR_INVALID"
        ? "这批内容已变化，请重新换一批。" : "加载失败，请重试。");
    } finally {
      if (id === generation.current) { moreBusy.current = false; setIsLoadingMore(false); }
    }
  }, [fetchPage, publish, saveHistory]);

  useEffect(() => {
    const restore = async () => {
      const parsed = snapshotSchema.safeParse(window.history.state?.mediaBrowse);
      const wantsBrowse = new URLSearchParams(window.location.search).get("view") === "browse";
      if (!wantsBrowse) return;
      const id = invalidate();
      busy.current = true;
      setLoading("restore");
      restoringPosition.current = true;
      setError(null);
      const saved = parsed.success ? parsed.data : null;
      const current = stateRef.current;
      const params = new URLSearchParams(window.location.search);
      // History navigation may occur without remounting this client component.
      const nextQuery: MediaListQuery = Object.fromEntries([...params].filter(([key]) => ["search", "kind", "topic", "region", "cefr", "duration", "sort"].includes(key)));
      const filters = filtersOf(nextQuery);
      const sameFilters = saved && JSON.stringify(filtersOf(saved.request.filters)) === JSON.stringify(filters);
      const request: MediaBrowseQuery = sameFilters ? saved.request : { filters, seed: crypto.randomUUID(), exclude: [], pageSize: 24 };
      let next: LibraryState = { ...current, query: nextQuery, browse: request, pages: 0, items: [], hasMore: true, nextCursor: null };
      try {
        for (let index = 0; index < (sameFilters ? saved.pages : 1); index += 1) {
          const page = await fetchPage(next, next.nextCursor ?? undefined);
          if (id !== generation.current) return;
          next = { ...next, ...page, pages: index + 1, items: [...next.items, ...page.items] };
          if (!page.hasMore) break;
        }
        seen.current = new Set(sameFilters ? saved.seen : []);
        restorePosition.current = { id, top: sameFilters ? saved.scrollY : 0 };
        publish(next);
        saveHistory(next, sameFilters ? saved.scrollY : 0);
      } catch (cause) {
        if (id === generation.current) restoringPosition.current = false;
        if (id === generation.current) setError(cause instanceof Error && cause.message === "MEDIA_CURSOR_INVALID"
          ? "这批内容已变化，请重新换一批。" : "恢复内容失败，请重新换一批。");
      } finally {
        if (id === generation.current) { busy.current = false; setLoading(null); }
      }
    };
    const onHistory = () => {
      navigatingAway.current = false;
      if (new URLSearchParams(window.location.search).get("view") === "browse") void restore();
      else {
        const params = new URLSearchParams(window.location.search);
        const kind = params.get("kind");
        // Leave the browse mode explicitly before reading chronological content.
        stateRef.current = { ...stateRef.current, browse: null };
        void loadKind(kind === "video" || kind === "podcast" ? kind : undefined, `${window.location.pathname}${window.location.search}`, false);
      }
    };
    const flushScroll = () => {
      cancelScrollSave();
      const next = stateRef.current;
      if (next.browse && !busy.current && !navigatingAway.current && !restoringPosition.current) saveHistory(next);
    };
    const recordScroll = () => {
      if (!stateRef.current.browse || busy.current || navigatingAway.current || restoringPosition.current || scrollSaveTimer.current !== null) return;
      // Coalesce positions outside the animation frame. Writing the full
      // history snapshot on every scroll event stalls long content shelves.
      scrollSaveTimer.current = window.setTimeout(flushScroll, 200);
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") flushScroll(); };
    const onNavigation = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement) || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || target.target === "_blank") return;
      const destination = new URL(target.href, window.location.href);
      if (destination.origin === window.location.origin && destination.pathname !== "/learn") {
        flushScroll();
        navigatingAway.current = true;
      }
    };
    void restore();
    window.addEventListener("popstate", onHistory);
    window.addEventListener("scroll", recordScroll, { passive: true });
    window.addEventListener("pagehide", flushScroll);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("click", onNavigation, true);
    return () => {
      stopRequests();
      window.removeEventListener("popstate", onHistory);
      window.removeEventListener("scroll", recordScroll);
      window.removeEventListener("pagehide", flushScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("click", onNavigation, true);
    };
  }, [cancelScrollSave, fetchPage, invalidate, loadKind, publish, saveHistory, stopRequests]);

  useLayoutEffect(() => {
    const target = restorePosition.current;
    if (!target) return;
    restorePosition.current = null;
    // The grid must have committed before scrolling. Two frames also let
    // Next/browser restoration finish against the earlier, shorter skeleton.
    restoreFrame.current = window.requestAnimationFrame(() => {
      restoreFrame.current = window.requestAnimationFrame(() => {
        if (target.id !== generation.current) return;
        window.scrollTo({ top: target.top, behavior: "instant" });
        restoringPosition.current = false;
        restoreFrame.current = null;
      });
    });
  }, [state]);

  useEffect(() => {
    if (loading || !state.hasMore || !state.nextCursor || loadMoreError) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g") return;
    const cursor = state.nextCursor;
    const run = () => { void fetchPage(state, cursor).catch(() => undefined); };
    if (typeof window.requestIdleCallback === "function") {
      const idle = window.requestIdleCallback(run, { timeout: 900 });
      return () => window.cancelIdleCallback(idle);
    }
    const timer = window.setTimeout(run, 180);
    return () => window.clearTimeout(timer);
  }, [fetchPage, loadMoreError, loading, state]);

  return { ...state, unavailable, loading, error, batchFailed, exhausted, isLoadingMore, loadMoreError, changeBatch, loadKind, loadMore, retry };
}
