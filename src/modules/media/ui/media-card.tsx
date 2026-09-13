import Link from "next/link";

import type { MediaCard } from "../domain";

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? [hours, minutes, seconds].map((value, index) => index === 0 ? String(value) : String(value).padStart(2, "0")).join(":")
    : [minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function MediaCardView({ item }: Readonly<{ item: MediaCard }>) {
  const resume = item.progress && item.progress.lastPositionMs > 0
    ? `继续 · ${formatTime(item.progress.lastPositionMs)}`
    : null;
  return (
    <article className="media-card">
      <Link className="media-card__link" href={`/learn/media/${encodeURIComponent(item.stableKey)}`}>
        <div className={`media-card__art media-card__art--${item.kind}`} aria-hidden="true">
          <span>{item.kind === "video" ? (
            <svg viewBox="0 0 24 24"><path d="M8 5.8v12.4L18 12 8 5.8Z" /></svg>
          ) : (
            <svg viewBox="0 0 24 24"><path d="M7 13.5v-3a5 5 0 0 1 10 0v3" /><path d="M7 12H5.5A1.5 1.5 0 0 0 4 13.5v3A1.5 1.5 0 0 0 5.5 18H8v-6H7ZM17 12h1.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5H16v-6h1Z" /></svg>
          )}</span>
          <small>{formatTime(item.durationMs)}</small>
        </div>
        <div className="media-card__body">
          <p className="media-card__meta"><span>{item.kind === "video" ? "视频" : "播客"}</span><span>{item.cefr ?? "未分级"}</span></p>
          <h2>{item.title}</h2>
          <p>{item.summary}</p>
          <div className="media-card__source"><span>{item.sourceName}</span><span>{item.region ?? "地区未知"}</span></div>
          {resume ? <strong className="media-card__resume">{resume}</strong> : null}
        </div>
      </Link>
    </article>
  );
}
