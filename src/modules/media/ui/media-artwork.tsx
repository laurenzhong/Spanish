"use client";

import { useState } from "react";

import type { MediaArtwork, MediaKind } from "../domain";

function ArtworkIcon({ kind }: Readonly<{ kind: MediaKind }>) {
  return kind === "video" ? (
    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 7 8 5-8 5V7Z" /><path d="M5 5.5v13" /></svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 13.5v-3a5 5 0 0 1 10 0v3" /><path d="M7 12H5.5A1.5 1.5 0 0 0 4 13.5v3A1.5 1.5 0 0 0 5.5 18H8v-6H7ZM17 12h1.5a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 17 18H16v-6h1Z" /></svg>
  );
}

function MissingArtwork({ kind, sourceName, title }: Readonly<{ kind: MediaKind; sourceName?: string; title: string }>) {
  return (
    <div className={`media-card__art media-card__art--missing media-card__art--${kind}`} role="img" aria-label={`${title}，${kind === "video" ? "视频" : "播客"}`}>
      <span className="media-card__missing-icon"><ArtworkIcon kind={kind} /></span>
      <strong>{title}</strong>
      <small>{sourceName || (kind === "video" ? "视频" : "播客")}</small>
    </div>
  );
}

export function MediaArtworkView({ artwork, kind, sourceName, title, priority = false }: Readonly<{ artwork?: MediaArtwork | null; kind: MediaKind; sourceName?: string; title: string; priority?: boolean }>) {
  const [failed, setFailed] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  if (!artwork || failed) return <MissingArtwork kind={kind} sourceName={sourceName} title={title} />;
  const imageUrl = fallbackUrl ?? artwork.url;
  return (
    <div className={`media-card__art media-card__art--${kind}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt={artwork.alt} width={artwork.width ?? 16} height={artwork.height ?? 9} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async" onError={() => {
        if (!fallbackUrl) {
          const match = /^https:\/\/(?:img|i)\.youtube\.com\/vi\/([A-Za-z0-9_-]{6,64})\/(?:mqdefault|maxresdefault)\.jpg$/u.exec(artwork.url);
          if (match) {
            setFallbackUrl(`https://i.ytimg.com/vi/${match[1]}/hqdefault.jpg`);
            return;
          }
        }
        setFailed(true);
      }} />
      <span className="media-card__play" aria-hidden="true"><ArtworkIcon kind={kind} /></span>
    </div>
  );
}
