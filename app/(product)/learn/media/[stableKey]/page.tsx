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

function clientPlayback(stableKey: string, playback: MediaPlayback): MediaPlayback {
  if (playback.media.kind !== "podcast" || playback.asset.kind !== "audio") return playback;
  try {
    const host = new URL(playback.asset.url).hostname.toLowerCase();
    const proxyHosts = new Set([
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
    if (!shouldProxy) return playback;
  } catch {
    return playback;
  }
  return { ...playback, asset: { ...playback.asset, url: `/api/v1/media/${encodeURIComponent(stableKey)}/stream` } };
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

  const browserPlayback = clientPlayback(stableKey, playback);
  if ((browserPlayback.media.kind === "podcast" && browserPlayback.asset.kind !== "audio")
    || (browserPlayback.media.kind === "video" && browserPlayback.asset.kind !== "video" && browserPlayback.asset.kind !== "official_embed")) return <UnavailableDetail />;
  return (
    <article className="media-detail">
      <Link className="media-detail__back" href="/learn">← 返回学习资料库</Link>
      <header>
        <p className="eyebrow eyebrow--accent">{playback.media.kind === "video" ? "视频" : "播客"} · {playback.media.cefr ?? "未分级"}</p>
        <h1>{playback.media.title}</h1>
        <p>{playback.media.summary}</p>
        <span>{playback.media.sourceName} · {playback.media.region ?? "地区未知"}</span>
      </header>
      <MediaLearningWorkbench initialPositionMs={requestedPositionMs ?? undefined} initialSegmentIndex={requestedSegmentIndex ?? undefined} playback={browserPlayback} />
    </article>
  );
}

