import type { Metadata } from "next";
import Link from "next/link";

import {
  createDrizzleMediaRepository,
  getMediaPlayback,
  MediaLearningWorkbench,
  mediaStableKeySchema,
  type MediaPlayback,
} from "@/src/modules/media";
import { getVideoLearningE2eFixture } from "@/src/modules/media/testing/video-learning-e2e-fixture";
import { getPodcastLearningE2eFixture } from "@/src/modules/media/testing/podcast-learning-e2e-fixture";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export const metadata: Metadata = { title: "媒体学习" };

type Context = Readonly<{
  params: Promise<{ stableKey: string }>;
  searchParams: Promise<{ t?: string | string[]; segment?: string | string[] }>;
}>;

function formatTime(milliseconds: number): string {
  const total = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function PlaybackSurface({ playback }: Readonly<{ playback: MediaPlayback }>) {
  if (playback.asset.kind === "official_embed") {
    return <iframe allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen src={playback.asset.url} title={`${playback.media.title} 播放器`} />;
  }
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

function boundedInteger(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export default async function MediaDetailPage({ params, searchParams }: Context) {
  let stableKey: string;
  try {
    stableKey = mediaStableKeySchema.parse(decodeURIComponent((await params).stableKey));
  } catch {
    return <UnavailableDetail />;
  }
  const location = await searchParams;
  const requestedPositionMs = boundedInteger(location.t);
  const requestedSegmentIndex = boundedInteger(location.segment);
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

  return (
    <article className="media-detail">
      <Link className="media-detail__back" href="/learn">← 返回学习资料库</Link>
      <header>
        <p className="eyebrow eyebrow--accent">{playback.media.kind === "video" ? "视频" : "播客"} · {playback.media.cefr ?? "未分级"}</p>
        <h1>{playback.media.title}</h1>
        <p>{playback.media.summary}</p>
        <span>{playback.media.sourceName} · {playback.media.region ?? "地区未知"}</span>
      </header>
      {(playback.media.kind === "video" && playback.asset.kind === "official_embed")
        || (playback.media.kind === "podcast" && playback.asset.kind === "audio") ? <MediaLearningWorkbench initialPositionMs={requestedPositionMs ?? undefined} initialSegmentIndex={requestedSegmentIndex ?? undefined} playback={playback} /> : <>
        <div className="media-detail__player"><PlaybackSurface playback={playback} /></div>
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
