import Link from "next/link";
import { memo } from "react";

import type { MediaCard } from "../domain";
import { MediaArtworkView } from "./media-artwork";
import { MediaCardLink } from "./media-card-link";
import "./media-card-series.css";

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? [hours, minutes, seconds].map((value, index) => index === 0 ? String(value) : String(value).padStart(2, "0")).join(":")
    : [minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export const MediaCardView = memo(function MediaCardView({ item, priority = false }: Readonly<{ item: MediaCard; priority?: boolean }>) {
  const href = `/learn/media/${encodeURIComponent(item.stableKey)}`;
  const resume = item.progress && item.progress.lastPositionMs > 0
    ? `继续 · ${formatTime(item.progress.lastPositionMs)}`
    : null;
  return (
    <article className="media-card">
      <MediaCardLink className="media-card__link" href={href}>
        <MediaArtworkView artwork={item.artwork} kind={item.kind} sourceName={item.sourceName} title={item.title} priority={priority} />
        <div className="media-card__body">
          <p className="media-card__meta"><span>{item.kind === "video" ? "视频" : "播客"}</span><span>{formatTime(item.durationMs)} · {item.cefr ?? "未分级"}</span></p>
          <h2>{item.title}</h2>
          <div className="media-card__source"><span>{item.sourceName}</span><span>{item.region ?? "地区未知"}</span></div>
          {resume ? <strong className="media-card__resume">{resume}</strong> : null}
        </div>
      </MediaCardLink>
      {item.series ? <div className="media-card__series">
        <Link href={`/learn/series/${encodeURIComponent(item.series.seriesKey)}`}>
          <span lang="es">{item.series.title}</span><span>查看系列 →</span>
        </Link>
        {item.series.episodeLabel ? <small>{item.series.episodeLabel}</small>
          : item.series.seasonNumber !== null || item.series.episodeNumber !== null ? <small>{[
            item.series.seasonNumber !== null ? `第 ${item.series.seasonNumber} 季` : null,
            item.series.episodeNumber !== null ? `第 ${item.series.episodeNumber} 集` : null,
          ].filter(Boolean).join(" · ")}</small> : null}
      </div> : null}
    </article>
  );
});
