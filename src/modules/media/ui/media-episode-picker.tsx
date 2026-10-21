"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";

import type { MediaCard } from "../domain/media";
import { MediaSeriesReadNotice } from "./media-series-page";
import { useMediaSeriesEpisodes } from "./use-media-series-episodes";
import "./media-series.css";

const mobileQuery = "(max-width: 767px)";
function subscribeMobile(callback: () => void) {
  const query = window.matchMedia?.(mobileQuery);
  query?.addEventListener("change", callback);
  return () => query?.removeEventListener("change", callback);
}
const readMobile = () => window.matchMedia?.(mobileQuery).matches ?? false;
const mediaHref = (key: string) => `/learn/media/${encodeURIComponent(key)}`;

export function MediaEpisodePicker({ media }: Readonly<{ media: MediaCard }>) {
  if (!media.series) return null;
  return <EpisodePicker key={`${media.stableKey}@${media.version}:${media.series.seriesKey}:${media.series.revision}`} media={media} />;
}

function EpisodePicker({ media }: Readonly<{ media: MediaCard }>) {
  const [open, setOpen] = useState(false);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const mobile = useSyncExternalStore(subscribeMobile, readMobile, () => false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = () => setOpen(false);
  return <section className="media-episode-picker" data-media-episode-picker>
    <div className="media-episode-picker__toolbar">
      <button ref={trigger} type="button" aria-expanded={open} aria-controls={id} aria-haspopup={mobile ? "dialog" : undefined} onClick={(event) => {
        setPortalHost(event.currentTarget.closest<HTMLElement>(".product-shell") ?? document.body);
        setOpen((value) => !value);
      }}>选集</button>
      <Link href={`/learn/series/${encodeURIComponent(media.series!.seriesKey)}`}>{media.series!.title}</Link>
    </div>
    {open ? mobile ? <EpisodeDrawer id={id} trigger={trigger} onClose={close} host={portalHost ?? document.body}>
      <EpisodeList media={media} />
    </EpisodeDrawer> : <section id={id} className="media-episode-picker__panel" aria-label="系列选集">
      <EpisodeList media={media} />
    </section> : null}
  </section>;
}

function EpisodeDrawer({ id, trigger, onClose, children, host }: Readonly<{
  id: string; trigger: RefObject<HTMLButtonElement | null>; onClose: () => void; children: React.ReactNode; host: HTMLElement;
}>) {
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const opener = trigger.current;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCloseRef.current(); }
      if (event.key !== "Tab") return;
      const elements = [...(panel.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]') ?? [])];
      const first = elements[0];
      const last = elements.at(-1);
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.current?.contains(active))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (active === last || !panel.current?.contains(active))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.body.style.overflow = originalOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [trigger]);
  return createPortal(<div className="media-episode-drawer" data-media-episode-picker>
    <button type="button" className="media-episode-drawer__backdrop" tabIndex={-1} aria-label="收起选集" onClick={onClose} />
    <div ref={panel} id={id} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="media-episode-drawer__panel">
      <div className="media-episode-drawer__heading"><h2 id={`${id}-title`}>选集</h2><button ref={closeButton} type="button" onClick={onClose} aria-label="关闭选集">关闭</button></div>
      {children}
    </div>
  </div>, host);
}

function time(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function episodeLabel(item: MediaCard): string | null {
  if (item.series?.episodeLabel) return item.series.episodeLabel;
  const parts = [];
  if (item.series?.seasonNumber !== null && item.series?.seasonNumber !== undefined) parts.push(`第 ${item.series.seasonNumber} 季`);
  if (item.series?.episodeNumber !== null && item.series?.episodeNumber !== undefined) parts.push(`第 ${item.series.episodeNumber} 集`);
  return parts.length ? parts.join(" · ") : null;
}
function EpisodeList({ media }: Readonly<{ media: MediaCard }>) {
  const state = useMediaSeriesEpisodes(media.series!.seriesKey, media.stableKey);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (state.status !== "ready" || !state.anchored) return;
    const current = list.current?.querySelector<HTMLElement>('[aria-current="true"]');
    const container = list.current?.closest<HTMLElement>(".media-episode-drawer__panel") ?? list.current;
    if (!current || !container || container.clientHeight <= 0) return;
    const target = current.getBoundingClientRect();
    const frame = container.getBoundingClientRect();
    if (target.top < frame.top || target.bottom > frame.bottom) {
      // Scroll only the picker/drawer, never the player document or its focus.
      container.scrollTop = Math.max(0, container.scrollTop + target.top - frame.top - (container.clientHeight - target.height) / 2);
    }
  }, [state.status, state.data, state.anchored]);
  const anchor = state.data?.anchor;
  return <div className="media-episode-picker__content">
    {state.status === "loading" ? <p role="status">正在读取选集…</p> : null}
    {state.error ? <MediaSeriesReadNotice error={state.error} retry={state.retry} /> : null}
    {state.data && state.status !== "error" ? <>
      <p className="media-series__count">本站已收录 {state.data.series.episodeCount} 集</p>
      <nav className="media-episode-picker__neighbors" aria-label="前后集">
        {anchor?.previous ? <Link href={mediaHref(anchor.previous.stableKey)}>上一集</Link> : <button type="button" disabled>上一集</button>}
        <button type="button" disabled={state.status === "loading"} onClick={state.reset}>定位当前集</button>
        {anchor?.next ? <Link href={mediaHref(anchor.next.stableKey)}>下一集</Link> : <button type="button" disabled>下一集</button>}
      </nav>
      {state.data.items.length ? <ol ref={list} className="media-episode-picker__list" aria-busy={state.status === "loading"}>
        {state.data.items.map((item) => <li key={item.id}>
          <Link href={mediaHref(item.stableKey)} aria-current={item.stableKey === media.stableKey ? "true" : undefined}>
            <span className="media-episode-picker__episode-title">{episodeLabel(item) ? <small>{episodeLabel(item)}</small> : null}<strong>{item.title}</strong>{item.stableKey === media.stableKey ? <small>当前集</small> : null}</span>
            <span className="media-episode-picker__episode-meta">{time(item.durationMs)} · {item.cefr ?? "未分级"}{item.progress?.lastPositionMs ? ` · 播放至 ${time(item.progress.lastPositionMs)}` : ""}</span>
          </Link>
        </li>)}
      </ol> : <p>暂无可播放的单集。</p>}
      <nav className="media-series__pagination" aria-label="选集分页">
        <button type="button" disabled={state.pageNumber === 1 || state.status === "loading"} onClick={state.previousPage}>上一页</button>
        <span>{state.anchored ? state.pageNumber === 1 ? "当前集所在页" : `后续第 ${state.pageNumber - 1} 页` : `第 ${state.pageNumber} 页`}</span>
        <button type="button" disabled={!state.data.hasMore || state.status === "loading"} onClick={state.nextPage}>下一页</button>
      </nav>
      {state.anchored ? <button type="button" disabled={state.status === "loading"} onClick={state.fromBeginning}>从头浏览</button> : null}
      <Link className="media-series__all" href={`/learn/series/${encodeURIComponent(media.series!.seriesKey)}`}>查看全部</Link>
    </> : null}
  </div>;
}
