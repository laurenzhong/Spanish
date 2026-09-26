import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getMediaPlayback } from "@/src/modules/media/application";
import { MediaUnavailableError } from "@/src/modules/media/domain";
import { createDrizzleMediaRepository } from "@/src/modules/media/repositories";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

type Context = Readonly<{ params: Promise<{ stableKey: string }> }>;

const AUDIO_STREAM_HOSTS = new Set([
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
const LANGUAGE_REACTOR_API = "https://api-cdn.dioco.io/base_media_getMediaDocs_5";
const AUDIO_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_AUDIO_REDIRECTS = 6;

function errorResponse(requestId: string, code: ApiErrorCode, status: number, message: string) {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, retryable: status >= 500, requestId } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function requestUser(request: NextRequest) {
  const verified = await verifyRequestUser(request);
  if (verified || request.headers.has("authorization")) return verified;
  return request.cookies.getAll().length > 0 ? await getCurrentUser() : null;
}

function validRange(value: string | null): string {
  return value && /^bytes=\d+-\d*$/u.test(value) ? value : "bytes=0-";
}

function hasExpiredProviderToken(value: string): boolean {
  try {
    const url = new URL(value);
    const raw = url.searchParams.get("Expires") ?? url.searchParams.get("expires")
      ?? url.searchParams.get("download-token")?.split("_", 1)[0];
    const seconds = Number(raw);
    return Number.isSafeInteger(seconds) && seconds > 0 && seconds * 1_000 <= Date.now();
  } catch {
    return false;
  }
}

function isAllowedAudioHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  const configuredHosts = [process.env.BUNNY_STORAGE_PULL_ZONE_HOSTNAME, process.env.BUNNY_STREAM_PULL_ZONE_HOSTNAME]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  const configuredSupabaseHosts = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_URL]
    .flatMap((value) => {
      if (!value?.trim()) return [];
      try { return [new URL(value).hostname.toLowerCase()]; } catch { return []; }
    });
  return AUDIO_STREAM_HOSTS.has(host)
    || (AUDIO_STREAM_HOSTS.has("simplecastaudio.com") && host.endsWith(".simplecastaudio.com"))
    || (AUDIO_STREAM_HOSTS.has("pscrb.fm") && host.endsWith(".pscrb.fm"))
    || (AUDIO_STREAM_HOSTS.has("anchor.fm") && host.endsWith(".anchor.fm"))
    || configuredSupabaseHosts.includes(host)
    || configuredHosts.includes(host);
}

async function fetchAudioStream(url: URL, range: string): Promise<Readonly<{ response: Response; finalUrl: URL }> | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_AUDIO_REDIRECTS; hop += 1) {
    if (current.protocol !== "https:" || !isAllowedAudioHost(current.hostname)) return null;
    const response = await fetch(current, {
      headers: { range },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    if (!AUDIO_REDIRECT_STATUSES.has(response.status)) return { response, finalUrl: current };
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || hop === MAX_AUDIO_REDIRECTS) return null;
    try {
      const next = new URL(location, current);
      if (next.protocol !== "https:" || !isAllowedAudioHost(next.hostname)) return null;
      current = next;
    } catch {
      return null;
    }
  }
  return null;
}

async function refreshLanguageReactorAudio(stableKey: string): Promise<string | null> {
  const prefix = "podcast.language-reactor.";
  if (!stableKey.startsWith(prefix)) return null;
  const docId = stableKey.slice(prefix.length);
  if (!docId || !/^[a-z0-9._-]{1,200}$/u.test(docId)) return null;
  try {
    const response = await fetch(LANGUAGE_REACTOR_API, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        userEmail: null,
        diocoToken: null,
        translationLang_G: "zh-CN",
        freq95: { min: 0, max: 100_000 },
        lang_G: "es",
        filters: { mediaTab: "TAB_PODCASTS" },
        pinnedDiocoPlaylistIds: [],
        selectedDiocoPlaylistId: "t_pd_mix_es",
        diocoPlaylistId: "t_pd_mix_es",
        forceIncludeDiocoDocId: docId,
        offset: 0,
        limit: 100,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const parsed = await response.json() as { data?: { docs_metadata?: Array<{ diocoDocId?: string; audioFileURL?: string }> } };
    const document = parsed.data?.docs_metadata?.find((item) => item.diocoDocId?.toLowerCase() === docId);
    if (!document?.audioFileURL) return null;
    const url = new URL(document.audioFileURL);
    return url.protocol === "https:" && isAllowedAudioHost(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

function fallbackRtveAudioUrl(staleUrl: URL, stableKey: string): URL | null {
  if (!stableKey.startsWith("podcast.language-reactor.") || staleUrl.hostname.toLowerCase() !== "rtve-mediavod-lote3.rtve.es") return null;
  const assetId = staleUrl.searchParams.get("idasset");
  if (!assetId || !/^\d{1,20}$/u.test(assetId)) return null;
  return new URL(`https://ztnr.rtve.es/ztnr/${assetId}.mp3?cachebust=${Date.now()}`);
}

function refreshRtveCache(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== "ztnr.rtve.es") return url;
    parsed.searchParams.set("cachebust", String(Date.now()));
    return parsed.toString();
  } catch {
    return url;
  }
}

export async function GET(request: NextRequest, { params }: Context) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await requestUser(request);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 503, "媒体播放信息暂时不可用。");

  try {
    const playback = await getMediaPlayback(
      createDrizzleMediaRepository(getDatabase()),
      decodeURIComponent((await params).stableKey),
      user.id,
    );
    if (playback.media.kind !== "podcast" || playback.asset.kind !== "audio") {
      return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 404, "这个媒体不支持音频流播放。");
    }
    const upstreamUrl = new URL(playback.asset.url);
    if (upstreamUrl.protocol !== "https:" || upstreamUrl.username || upstreamUrl.password || !isAllowedAudioHost(upstreamUrl.hostname)) {
      return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 404, "这个媒体不支持音频流播放。");
    }
    const range = validRange(request.headers.get("range"));
    const isLanguageReactor = playback.media.stableKey?.startsWith("podcast.language-reactor.") ?? false;
    let requestUrl = upstreamUrl;
    if (isLanguageReactor && hasExpiredProviderToken(upstreamUrl.toString())) {
      const refreshedUrl = await refreshLanguageReactorAudio(playback.media.stableKey)
        ?? fallbackRtveAudioUrl(upstreamUrl, playback.media.stableKey);
      if (refreshedUrl) requestUrl = new URL(refreshRtveCache(String(refreshedUrl)));
    }
    let fetched = await fetchAudioStream(requestUrl, range);
    if ((!fetched || !fetched.response.ok) && isLanguageReactor) {
      const refreshedUrl = await refreshLanguageReactorAudio(playback.media.stableKey)
        ?? fallbackRtveAudioUrl(upstreamUrl, playback.media.stableKey);
      if (refreshedUrl && refreshedUrl.toString() !== requestUrl.toString()) {
        fetched = await fetchAudioStream(new URL(refreshRtveCache(String(refreshedUrl))), range);
      }
    }
    if (!fetched) return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 502, "播客音频暂时无法播放，请稍后重试。");
    const { response: upstream, finalUrl } = fetched;
    if (finalUrl.protocol !== "https:" || finalUrl.username || finalUrl.password || !isAllowedAudioHost(finalUrl.hostname)) {
      return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 502, "播客音频跳转到了不受支持的来源。");
    }
    if (!upstream.ok || !upstream.body) {
      return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 502, "播客音频暂时无法播放，请稍后重试。");
    }
    const headers = new Headers({
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
      "content-type": upstream.headers.get("content-type")?.split(";", 1)[0] ?? "audio/mpeg",
      "x-content-type-options": "nosniff",
    });
    for (const name of ["content-length", "content-range"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    if (error instanceof MediaUnavailableError) {
      return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 404, "这个媒体内容不存在、已撤下或播放地址已失效。");
    }
    return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 502, "播客音频暂时无法播放，请稍后重试。");
  }
}
