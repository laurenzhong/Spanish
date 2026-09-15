"use client";

import Script from "next/script";
import { useEffect, useId, useRef, useState } from "react";

export type VideoPlayerState = "ready" | "playing" | "paused" | "ended";
export type VideoPlayerLifecycle = Readonly<{ onReady: () => void; onStateChange: (state: VideoPlayerState) => void; onError: (message: string) => void }>;
export interface VideoPlayerPort { play(): void; pause(): void; seek(positionMs: number): void; currentTime(): number; destroy(): void }
export type VideoPlayerFactory = (target: HTMLElement, input: Readonly<{ videoId: string; lifecycle: VideoPlayerLifecycle }>) => VideoPlayerPort;

type YouTubePlayer = Readonly<{ playVideo(): void; pauseVideo(): void; seekTo(seconds: number, allowSeekAhead: boolean): void; getCurrentTime(): number; destroy(): void }>;
type YouTubeWindow = Window & typeof globalThis & { YT?: Readonly<{ Player: new (target: HTMLElement, options: Readonly<Record<string, unknown>>) => YouTubePlayer }> };

function videoIdFromEmbed(embedUrl: string): string | null {
  try {
    const url = new URL(embedUrl);
    if (url.origin !== "https://www.youtube-nocookie.com" || url.username || url.password) return null;
    return /^\/embed\/([A-Za-z0-9_-]{6,64})$/u.exec(url.pathname)?.[1] ?? null;
  } catch { return null; }
}

export const youtubeIframePlayerFactory: VideoPlayerFactory = (target, input) => {
  const youtube = (window as YouTubeWindow).YT;
  if (!youtube?.Player) throw new Error("YouTube 播放器脚本尚未就绪。");
  const player = new youtube.Player(target, {
    videoId: input.videoId,
    host: "https://www.youtube-nocookie.com",
    playerVars: { enablejsapi: 1, playsinline: 1, rel: 0 },
    events: {
      onReady: input.lifecycle.onReady,
      onStateChange: (event: { data: number }) => {
        const state = event.data === 1 ? "playing" : event.data === 2 ? "paused" : event.data === 0 ? "ended" : null;
        if (state) input.lifecycle.onStateChange(state);
      },
      onError: () => input.lifecycle.onError("YouTube 播放器暂时无法使用，请稍后重试。"),
    },
  });
  return {
    play: () => player.playVideo(), pause: () => player.pauseVideo(),
    seek: (positionMs) => player.seekTo(positionMs / 1_000, true),
    currentTime: () => Math.max(0, Math.round(player.getCurrentTime() * 1_000)),
    destroy: () => player.destroy(),
  };
};

export function VideoPlayerAdapter({ embedUrl, title, factory, onPortChange, onStateChange, onError }: Readonly<{
  embedUrl: string; title: string; factory?: VideoPlayerFactory;
  onPortChange: (port: VideoPlayerPort | null) => void;
  onStateChange: (state: VideoPlayerState) => void;
  onError: (message: string | null) => void;
}>) {
  const rawId = useId();
  const targetId = `youtube-player-${rawId.replace(/[^A-Za-z0-9_-]/gu, "")}`;
  const targetRef = useRef<HTMLDivElement>(null);
  const generationRef = useRef(0);
  const [sdkReady, setSdkReady] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  const [fallbackHost, setFallbackHost] = useState<"www.youtube-nocookie.com" | "www.youtube.com">("www.youtube-nocookie.com");
  const [fallbackTimedOut, setFallbackTimedOut] = useState(false);
  const videoId = videoIdFromEmbed(embedUrl);

  useEffect(() => {
    if (factory || sdkReady || scriptFailed) return;
    const ready = () => Boolean((window as YouTubeWindow).YT?.Player);
    const timer = window.setInterval(() => {
      if (!ready()) return;
      window.clearInterval(timer);
      window.clearTimeout(timeout);
      setSdkReady(true);
    }, 50);
    const timeout = window.setTimeout(() => {
      window.clearInterval(timer);
      setScriptFailed(true);
    }, 5_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(timeout);
    };
  }, [factory, onError, onStateChange, sdkReady, scriptFailed]);

  useEffect(() => {
    if (factory || !scriptFailed || !videoId) return;
    const timer = window.setTimeout(() => {
      setFallbackTimedOut(true);
      onError("YouTube 播放器加载超时，可能受当前网络限制。");
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [factory, fallbackHost, onError, scriptFailed, videoId]);

  useEffect(() => {
    if (!targetRef.current || !videoId || (!factory && !sdkReady)) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const current = () => generationRef.current === generation;
    let port: VideoPlayerPort;
    try {
      port = (factory ?? youtubeIframePlayerFactory)(targetRef.current, { videoId, lifecycle: {
        onReady: () => { if (current()) onStateChange("ready"); },
        onStateChange: (state) => { if (current()) onStateChange(state); },
        onError: (message) => { if (current()) onError(message); },
      } });
      onPortChange(port);
      onError(null);
    } catch (error) {
      if (current()) onError(error instanceof Error ? error.message : "播放器初始化失败。");
      return;
    }
    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
      onPortChange(null);
      port.destroy();
    };
  }, [embedUrl, factory, onError, onPortChange, onStateChange, sdkReady, videoId]);

  const fallbackUrl = videoId ? `https://${fallbackHost}/embed/${videoId}?enablejsapi=1&playsinline=1` : embedUrl;
  const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
  return <div className="video-player-adapter">
    {scriptFailed && !factory ? <>
      <iframe allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen aria-label={title} src={fallbackUrl} title={title} />
      {fallbackTimedOut ? <div className="video-player-adapter__fallback" role="status">
        <p>YouTube 播放器暂时无法连接，可能是当前网络限制。</p>
        <div>
          <button onClick={() => { setFallbackTimedOut(false); onError(null); setFallbackHost((host) => host === "www.youtube-nocookie.com" ? "www.youtube.com" : "www.youtube-nocookie.com"); }} type="button">重试播放器</button>
          {watchUrl ? <a href={watchUrl} rel="noreferrer" target="_blank">在 YouTube 打开</a> : null}
        </div>
      </div> : null}
    </> : <div aria-label={title} id={targetId} ref={targetRef} />}
    {!factory && !scriptFailed ? <Script id="youtube-iframe-api" onError={() => { setScriptFailed(true); }}
      onReady={() => {
        if ((window as YouTubeWindow).YT?.Player) setSdkReady(true);
      }} src="https://www.youtube.com/iframe_api" strategy="afterInteractive" /> : null}
    {!videoId ? <p role="alert">播放地址无效。</p> : null}
  </div>;
}
