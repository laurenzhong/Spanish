import Link from "next/link";

import type { MediaCard } from "../domain";
import { MediaArtworkView } from "./media-artwork";

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
        <MediaArtworkView artwork={item.artwork} kind={item.kind} title={item.title} />
        <div className="media-card__body">
          <p className="media-card__meta"><span>{item.kind === "video" ? "视频" : "播客"}</span><span>{formatTime(item.durationMs)} · {item.cefr ?? "未分级"}</span></p>
          <h2>{item.title}</h2>
          <div className="media-card__source"><span>{item.sourceName}</span><span>{item.region ?? "地区未知"}</span></div>
          {resume ? <strong className="media-card__resume">{resume}</strong> : null}
        </div>
      </Link>
    </article>
  );
}
