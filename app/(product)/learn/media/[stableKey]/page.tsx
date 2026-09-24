import type { Metadata } from "next";
import Link from "next/link";

import { getMediaPlayback } from "@/src/modules/media/application";
import type { MediaPlayback } from "@/src/modules/media/domain";
import { createDrizzleMediaRepository } from "@/src/modules/media/repositories";
import { mediaStableKeySchema } from "@/src/modules/media/schemas";
import { MediaLearningWorkbench } from "@/src/modules/media/ui/media-learning-workbench";
import { getVideoLearningE2eFixture } from "@/src/modules/media/testing/video-learning-e2e-fixture";
import { getPodcastLearningE2eFixture } from "@/src/modules/media/testing/podcast-learning-e2e-fixture";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export const metadata: Metadata = { title: "媒体学习" };

type Context = Readonly<{ params: Promise<{ stableKey: string }> }>;

function formatTime(milliseconds: number): string {
  const total = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function PlaybackSurface({ playback }: Readonly<{ playback: MediaPlayback }>) {
  if (playback.asset.kind === "audio") {
    return <audio controls preload="metadata" src={playback.asset.url}>当前浏览器无法播放音频。</audio>;
  }
  return <video controls playsInline preload="metadata" src={playback.asset.url}>当前浏览器无法播放视频。</video>;
}

function UnavailableDetail() {
  return (
    <section className="media-detail media-detail--empty" role="status">
      <p className="eyebrow">内容不可用</p>
      <h1>暂时无法打开这个媒体</h1>
      <p>内容可能尚未发布、已经撤下，或播放地址已经失效。</p>
      <Link href="/learn">返回学习资料库</Link>
    </section>
  );
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} 秒`;
  return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
}

function clientPlayback(stableKey: string, playback: MediaPlayback): MediaPlayback {
  if (playback.media.kind !== "podcast" || playback.asset.kind !== "audio") return playback;
  try {
    const host = new URL(playback.asset.url).hostname.toLowerCase();
    if (!new Set([
      "content.libsyn.com",
      "traffic.libsyn.com",
      "traffic.megaphone.fm",
      "dcs-spotify.megaphone.fm",
      "ztnr.rtve.es",
      "rtve-mediavod-lote3.rtve.es",
    ]).has(host)) return playback;
  } catch {
    return playback;
  }
  return { ...playback, asset: { ...playback.asset, url: `/api/v1/media/${encodeURIComponent(stableKey)}/stream` } };
}

export default async function MediaDetailPage({ params }: Context) {
  let stableKey: string;
  try {
    stableKey = mediaStableKeySchema.parse(decodeURIComponent((await params).stableKey));
  } catch {
    return <UnavailableDetail />;
  }
  const user = await getCurrentUser();
  if (!user) return <UnavailableDetail />;

  let playback: MediaPlayback;
  const e2eFixture = getVideoLearningE2eFixture(stableKey) ?? getPodcastLearningE2eFixture(stableKey);
  if (e2eFixture) {
    playback = e2eFixture;
  } else {
    if (!process.env.DATABASE_URL) return <UnavailableDetail />;
    try {
      playback = await getMediaPlayback(createDrizzleMediaRepository(getDatabase()), stableKey, user.id);
    } catch {
      return <UnavailableDetail />;
    }
  }

  const browserPlayback = clientPlayback(stableKey, playback);
  if (browserPlayback.media.kind === "video" && browserPlayback.asset.kind !== "video") return <UnavailableDetail />;
  return (
    <article className="media-detail">
      <div className="media-detail__topbar"><Link className="media-detail__back" href="/learn">← 返回学习资料库</Link><span>{playback.media.kind === "video" ? "视频" : "播客"} · {playback.media.cefr ?? "未分级"}</span></div>
      <header className="media-detail__header">
        <h1>{playback.media.title}</h1>
        <div aria-label="媒体信息" className="media-detail__meta">
          <span>{playback.media.sourceName}</span>
          <span>{playback.media.region ?? "地区未知"}</span>
          <span>{formatDuration(playback.media.durationMs)}</span>
          <span>{playback.segments.length > 0 ? "有逐句文本" : "无逐句文本"}</span>
          <details className="media-detail__summary"><summary>内容简介</summary><p>{playback.media.summary}</p></details>
        </div>
      </header>
      {(playback.media.kind === "video" && playback.asset.kind === "video")
        || (playback.media.kind === "podcast" && playback.asset.kind === "audio") ? <MediaLearningWorkbench playback={browserPlayback} /> : <>
        <div className="media-detail__player"><PlaybackSurface playback={browserPlayback} /></div>
        <section className="media-transcript" aria-labelledby="media-transcript-title">
        <div className="media-transcript__heading"><h2 id="media-transcript-title">字幕与文本</h2><span>{playback.segments.length} 段</span></div>
        {playback.segments.length > 0 ? (
          <ol>{playback.segments.map((segment) => (
            <li key={segment.id}>
              <time>{formatTime(segment.startMs)}</time>
              <div>{segment.speaker ? <strong>{segment.speaker}</strong> : null}<p lang="es">{segment.sourceText}</p>{segment.translation ? <p>{segment.translation}</p> : null}</div>
            </li>
          ))}</ol>
        ) : <p className="media-transcript__empty">这项内容暂时没有已审核的字幕。</p>}
        </section>
      </>}
    </article>
  );
}
