import Link from "next/link";

import { getMediaPlaybackOverview } from "@/src/modules/media/application";
import type { MediaCard, MediaPlayback, MediaPlaybackOverview } from "@/src/modules/media/domain";
import { createDrizzleMediaRepository } from "@/src/modules/media/repositories";
import { MediaDetailExperience } from "@/src/modules/media/ui/media-detail-experience";
import { MediaLearningWorkbench } from "@/src/modules/media/ui/media-learning-workbench";
import { getVideoLearningE2eFixture } from "@/src/modules/media/testing/video-learning-e2e-fixture";
import { getPodcastLearningE2eFixture, waitForPodcastLearningE2eFixture } from "@/src/modules/media/testing/podcast-learning-e2e-fixture";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

/**
 * Data half of the media detail route.
 *
 * The page module keeps the Suspense boundary (which must be a Server Component
 * export), while this sibling module owns the reads. Next.js typed routes do not
 * allow page modules to export anything except the framework entrypoints, so
 * keeping the async content here is also what lets tests exercise it directly.
 */

export function sourcePosition(value: string | string[] | undefined): number | undefined {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return undefined;
  const position = Number(value);
  return Number.isSafeInteger(position) ? position : undefined;
}

export function UnavailableDetail() {
  return (
    <section className="media-detail media-detail--empty" role="status">
      <p className="eyebrow">内容不可用</p>
      <h1>暂时无法打开这个媒体</h1>
      <p>内容可能尚未发布、已经撤下，或播放地址已经失效。</p>
      <Link href="/learn">返回学习资料库</Link>
    </section>
  );
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} 秒`;
  return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
}

function streamUrl(stableKey: string): string {
  return `/api/v1/media/${encodeURIComponent(stableKey)}/stream`;
}

type PlaybackAsset = MediaPlayback["asset"];

/**
 * Some rights-cleared sources are private to their pull zone in a browser, so
 * their bytes have to travel through the authenticated range proxy. This is a
 * URL rewrite only: availability, rights and expiry were already checked by
 * the repository projection.
 */
export function proxiedAssetUrl(stableKey: string, mediaKind: MediaCard["kind"], asset: PlaybackAsset): PlaybackAsset {
  if (mediaKind === "video") {
    if (asset.kind !== "video") return asset;
    try {
      if (new URL(asset.url).hostname.toLowerCase() === "sueno-media.b-cdn.net") {
        return { ...asset, url: streamUrl(stableKey) };
      }
    } catch {
      return asset;
    }
    return asset;
  }
  if (asset.kind !== "audio") return asset;
  try {
    const host = new URL(asset.url).hostname.toLowerCase();
    const proxyHosts = new Set([
      // Bunny-hosted podcast assets are private to the pull zone in the
      // browser. Keep the source URL server-side and stream it through the
      // authenticated range proxy, just like the original feed hosts.
      "sueno-media.b-cdn.net",
      "content.libsyn.com",
      "traffic.libsyn.com",
      "traffic.megaphone.fm",
      "dcs-cached.megaphone.fm",
      "dcs-spotify.megaphone.fm",
      "content.blubrry.com",
      "media.blubrry.com",
      "episodes.castos.com",
      "simplecastaudio.com",
      "injector.simplecastaudio.com",
      "sonoro.simplecastaudio.com",
      "pscrb.fm",
      "anchor.fm",
      "prisa-es.mc.tritondigital.com",
      "mc.tritondigital.com",
      "www.podtrac.com",
      "dts.podtrac.com",
      "pdst.fm",
      "chrt.fm",
      "ztnr.rtve.es",
      "rtve-mediavod-lote3.rtve.es",
      "charlashispanas.com",
      "www.hoyhablamos.com",
    ]);
    const shouldProxy = proxyHosts.has(host)
      || host.endsWith(".simplecastaudio.com")
      || host.endsWith(".pscrb.fm")
      || host.endsWith(".anchor.fm");
    if (!shouldProxy) return asset;
  } catch {
    return asset;
  }
  return { ...asset, url: streamUrl(stableKey) };
}

export function assetKindIsPlayable(mediaKind: MediaCard["kind"], assetKind: PlaybackAsset["kind"]): boolean {
  if (mediaKind === "podcast") return assetKind === "audio";
  return assetKind === "video" || assetKind === "official_embed";
}

export function MediaDetailHeader({ media, transcriptLabel }: Readonly<{ media: MediaCard; transcriptLabel: string }>) {
  return (
    <>
      <div className="media-detail__topbar"><Link className="media-detail__back" href="/learn">← 返回学习资料库</Link><span>{media.kind === "video" ? "视频" : "播客"} · {media.cefr ?? "未分级"}</span></div>
      <header className="media-detail__header">
        <h1>{media.title}</h1>
        <div aria-label="媒体信息" className="media-detail__meta">
          <span>{media.sourceName}</span>
          <span>{media.region ?? "地区未知"}</span>
          <span>{formatDuration(media.durationMs)}</span>
          <span>{transcriptLabel}</span>
          <details className="media-detail__summary"><summary>内容简介</summary><p>{media.summary}</p></details>
        </div>
      </header>
    </>
  );
}

/**
 * Authentication and the availability gates run before anything renders, but
 * the transcript load is deliberately not awaited here.
 *
 * The E2E fixture path keeps receiving the complete playback and mounts the
 * existing workbench exactly as before, so the browser journeys and local
 * fixtures are unaffected. The real path renders the title and player from the
 * lightweight overview and lets the client fetch the transcript from the same
 * `/playback` endpoint (text first, word timings second).
 */
export async function MediaDetailContent({ stableKey, searchParams }: Readonly<{
  stableKey: string;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const user = await getCurrentUser();
  if (!user) return <UnavailableDetail />;

  const requested = await searchParams;
  const initialPositionMs = sourcePosition(requested?.t);
  const initialSegmentIndex = sourcePosition(requested?.segment);

  const e2eFixture = getVideoLearningE2eFixture(stableKey) ?? getPodcastLearningE2eFixture(stableKey);
  if (e2eFixture) {
    await waitForPodcastLearningE2eFixture(stableKey);
    const browserPlayback: MediaPlayback = {
      ...e2eFixture,
      asset: proxiedAssetUrl(stableKey, e2eFixture.media.kind, e2eFixture.asset),
    };
    if (!assetKindIsPlayable(browserPlayback.media.kind, browserPlayback.asset.kind)) return <UnavailableDetail />;
    return (
      <article className="media-detail">
        <MediaDetailHeader media={browserPlayback.media} transcriptLabel={browserPlayback.segments.length > 0 ? "有逐句文本" : "无逐句文本"} />
        <MediaLearningWorkbench initialPositionMs={initialPositionMs} initialSegmentIndex={initialSegmentIndex} playback={browserPlayback} />
      </article>
    );
  }

  if (!process.env.DATABASE_URL) return <UnavailableDetail />;
  let overview: MediaPlaybackOverview;
  try {
    overview = await getMediaPlaybackOverview(createDrizzleMediaRepository(getDatabase()), stableKey, user.id);
  } catch {
    return <UnavailableDetail />;
  }
  const browserOverview: MediaPlaybackOverview = {
    ...overview,
    asset: proxiedAssetUrl(stableKey, overview.media.kind, overview.asset),
  };
  if (!assetKindIsPlayable(browserOverview.media.kind, browserOverview.asset.kind)) return <UnavailableDetail />;
  return (
    <article className="media-detail">
      <MediaDetailHeader media={browserOverview.media} transcriptLabel={browserOverview.segmentCount > 0 ? "有逐句文本" : "无逐句文本"} />
      <MediaDetailExperience
        initialPositionMs={initialPositionMs}
        initialSegmentIndex={initialSegmentIndex}
        key={browserOverview.media.id}
        overview={browserOverview}
      />
    </article>
  );
}
