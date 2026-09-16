"use client";

import Script from "next/script";
import { useEffect, useId, useRef, useState } from "react";

export type VideoPlayerState = "ready" | "playing" | "paused" | "ended";
export type VideoPlayerLifecycle = Readonly<{ onReady: () => void; onStateChange: (state: VideoPlayerState) => void; onError: (message: string) => void }>;
export interface VideoPlayerPort { play(): void; pause(): void; seek(positionMs: number): void; currentTime(): number; destroy(): void }
export type VideoPlayerFactory = (target: HTMLElement, input: Readonly<{ videoId: string; lifecycle: VideoPlayerLifecycle }>) => VideoPlayerPort;
type PlyrInstance = {
  currentTime: number;
  play(): Promise<void> | void;
  pause(): void;
  on(event: string, callback: () => void): void;
  off(event: string, callback: () => void): void;
  destroy(): void;
};
type PlyrConstructor = new (target: HTMLVideoElement, options: Readonly<Record<string, unknown>>) => PlyrInstance;

type YouTubePlayer = Readonly<{ playVideo(): void; pauseVideo(): void; seekTo(seconds: number, allowSeekAhead: boolean): void; getCurrentTime(): number; destroy(): void }>;
type YouTubeWindow = Window & typeof globalThis & { YT?: Readonly<{ Player: new (target: HTMLElement, options: Readonly<Record<string, unknown>>) => YouTubePlayer }> };

function youtubeErrorMessage(code: number): string {
  if (code === 153) return "YouTube 无法识别嵌入播放器的来源身份（错误 153）。请重试或在 YouTube 打开。";
  if (code === 101 || code === 150) return "该 YouTube 视频不允许嵌入本站播放，请在 YouTube 打开。";
  if (code === 100) return "该 YouTube 视频不可用或已被移除。";
  return "YouTube 播放器暂时无法使用，请稍后重试。";
}

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
  // Set the policy before navigation, not after the SDK has sent the request.
  // Keep React's container intact when the SDK destroys its iframe.
  const frame = document.createElement("iframe");
  frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  frame.title = target.getAttribute("aria-label") ?? "YouTube 播放器";
  frame.allow = "autoplay; encrypted-media; picture-in-picture";
  frame.allowFullscreen = true;
  const url = new URL(`https://www.youtube-nocookie.com/embed/${input.videoId}`);
  url.search = new URLSearchParams({ enablejsapi: "1", playsinline: "1", rel: "0", origin: window.location.origin }).toString();
  frame.src = url.toString();
  target.replaceChildren(frame);
  const player = new youtube.Player(frame, {
    videoId: input.videoId,
    host: "https://www.youtube-nocookie.com",
    playerVars: { enablejsapi: 1, playsinline: 1, rel: 0, origin: window.location.origin, widget_referrer: window.location.href },
    events: {
      onReady: input.lifecycle.onReady,
      onStateChange: (event: { data: number }) => {
        const state = event.data === 1 ? "playing" : event.data === 2 ? "paused" : event.data === 0 ? "ended" : null;
        if (state) input.lifecycle.onStateChange(state);
      },
      onError: (event: { data?: number }) => input.lifecycle.onError(youtubeErrorMessage(event.data ?? 0)),
    },
  });
  return {
    play: () => player.playVideo(), pause: () => player.pauseVideo(),
    seek: (positionMs) => player.seekTo(positionMs / 1_000, true),
    currentTime: () => Math.max(0, Math.round(player.getCurrentTime() * 1_000)),
    destroy: () => { player.destroy(); frame.remove(); },
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
  const videoId = videoIdFromEmbed(embedUrl);
  const runtimeOrigin = typeof window === "undefined" ? null : window.location.origin;
  const runtimeReferrer = typeof window === "undefined" ? null : window.location.href;

  useEffect(() => {
    if (factory || sdkReady) return;
    const ready = () => Boolean((window as YouTubeWindow).YT?.Player);
    const timer = window.setInterval(() => {
      if (!ready()) return;
      window.clearInterval(timer);
      window.clearTimeout(timeout);
      setSdkReady(true);
    }, 50);
    const timeout = window.setTimeout(() => {
      setScriptFailed(true);
    }, 5_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(timeout);
    };
  }, [factory, sdkReady]);

  useEffect(() => {
    if (!targetRef.current || !videoId || (!factory && !sdkReady)) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const current = () => generationRef.current === generation;
    let port: VideoPlayerPort;
    onError(null);
    try {
      port = (factory ?? youtubeIframePlayerFactory)(targetRef.current, { videoId, lifecycle: {
        onReady: () => { if (current()) onStateChange("ready"); },
        onStateChange: (state) => { if (current()) { if (state === "playing") onError(null); onStateChange(state); } },
        onError: (message) => {
          if (current()) {
            onError(message);
          }
        },
      } });
      onPortChange(port);
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

  const fallbackUrl = videoId ? (() => {
    const url = new URL(`https://${fallbackHost}/embed/${videoId}`);
    url.searchParams.set("enablejsapi", "1");
    url.searchParams.set("playsinline", "1");
    if (runtimeOrigin) url.searchParams.set("origin", runtimeOrigin);
    if (runtimeReferrer) url.searchParams.set("widget_referrer", runtimeReferrer);
    return url.toString();
  })() : embedUrl;
  const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
  const fallback = scriptFailed && !sdkReady && !factory;
  return <div className="video-player-adapter">
    {fallback ? <iframe allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen aria-label={title} referrerPolicy="strict-origin-when-cross-origin" src={fallbackUrl} title={title} />
      : <div aria-label={title} id={targetId} ref={targetRef} />}
    {!factory ? <Script id="youtube-iframe-api" onError={() => { setScriptFailed(true); }}
      onReady={() => {
        if ((window as YouTubeWindow).YT?.Player) setSdkReady(true);
      }} src="https://www.youtube.com/iframe_api" strategy="afterInteractive" /> : null}
    {!videoId ? <p role="alert">播放地址无效。</p> : null}
    <div className="video-player-adapter__help">
      {fallback ? <><span role="status">逐句控制暂未连接，可尝试使用视频内的播放按钮；本站尚不能确认播放状态。</span><button onClick={() => setFallbackHost((host) => host === "www.youtube-nocookie.com" ? "www.youtube.com" : "www.youtube-nocookie.com")} type="button">重试播放器</button></> : null}
      {watchUrl ? <a href={watchUrl} rel="noopener noreferrer" target="_blank">在 YouTube 打开</a> : null}
    </div>
  </div>;
}

export function HostedVideoPlayerAdapter({ videoUrl, title, onPortChange, onStateChange, onTimeUpdate, onError }: Readonly<{
  videoUrl: string;
  title: string;
  onPortChange: (port: VideoPlayerPort | null) => void;
  onStateChange: (state: VideoPlayerState) => void;
  onTimeUpdate: (positionMs: number) => void;
  onError: (message: string | null) => void;
}>) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let player: PlyrInstance | null = null;
    let port: VideoPlayerPort | null = null;
    const loaded = () => { onError(null); onStateChange("ready"); };
    const playing = () => onStateChange("playing");
    const paused = () => onStateChange("paused");
    const ended = () => onStateChange("ended");
    const timeUpdate = () => { if (player) onTimeUpdate(Math.max(0, Math.round(player.currentTime * 1_000))); };
    const error = () => onError("本站视频资源暂时无法播放，请重试或检查媒体托管状态。");
    video.addEventListener("loadedmetadata", loaded);
    void import("plyr").then((module) => {
      if (cancelled) return;
      const Plyr = (module as unknown as { default: PlyrConstructor }).default;
      player = new Plyr(video, {
        controls: ["play-large", "play", "progress", "current-time", "mute", "volume", "settings", "pip", "fullscreen"],
        keyboard: { focused: true, global: false },
        tooltips: { controls: true, seek: true },
        ratio: "16:9",
        settings: ["speed"],
      });
      player.on("ready", loaded);
      player.on("playing", playing);
      player.on("play", playing);
      player.on("pause", paused);
      player.on("ended", ended);
      player.on("timeupdate", timeUpdate);
      player.on("error", error);
      port = {
        play: () => { if (player) void player.play(); },
        pause: () => player?.pause(),
        seek: (positionMs) => { if (player) player.currentTime = Math.max(0, positionMs) / 1_000; },
        currentTime: () => player ? Math.max(0, Math.round(player.currentTime * 1_000)) : 0,
        destroy: () => player?.destroy(),
      };
      onPortChange(port);
      if (video.readyState >= 1) loaded();
    }).catch(() => { if (!cancelled) onError("本站视频播放器加载失败，请重试或检查媒体资源。"); });
    return () => {
      cancelled = true;
      if (player) {
        player.off("ready", loaded);
        player.off("playing", playing);
        player.off("play", playing);
        player.off("pause", paused);
        player.off("ended", ended);
        player.off("timeupdate", timeUpdate);
        player.off("error", error);
      }
      video.removeEventListener("loadedmetadata", loaded);
      onPortChange(null);
      port?.destroy();
    };
  }, [onError, onPortChange, onStateChange, onTimeUpdate]);

  return <video aria-label={title} controls playsInline preload="metadata" ref={videoRef} src={videoUrl} />;
}
