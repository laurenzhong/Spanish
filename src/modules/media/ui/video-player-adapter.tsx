"use client";

import Script from "next/script";
import { useEffect, useId, useRef, useState } from "react";

export type VideoPlayerState = "ready" | "playing" | "paused" | "ended";
export type VideoPlayerLifecycle = Readonly<{ onReady: () => void; onStateChange: (state: VideoPlayerState) => void; onError: (message: string) => void }>;
export interface VideoPlayerPort { play(): void; pause(): void; seek(positionMs: number): void; currentTime(): number; destroy(): void }
export type VideoPlayerFactory = (target: HTMLElement, input: Readonly<{ videoId: string; lifecycle: VideoPlayerLifecycle }>) => VideoPlayerPort;
export type NativeVideoPlayerFactory = (element: HTMLVideoElement, input: Readonly<{ url: string; lifecycle: VideoPlayerLifecycle }>) => VideoPlayerPort;

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

export const nativeVideoPlayerFactory: NativeVideoPlayerFactory = (element, input) => {
  const onReady = () => input.lifecycle.onReady();
  const onPlay = () => input.lifecycle.onStateChange("playing");
  const onPause = () => {
    if (!element.ended) input.lifecycle.onStateChange("paused");
  };
  const onEnded = () => input.lifecycle.onStateChange("ended");
  const onError = () => input.lifecycle.onError("视频暂时无法播放，请检查网络后重试。");
  element.addEventListener("canplay", onReady);
  element.addEventListener("play", onPlay);
  element.addEventListener("pause", onPause);
  element.addEventListener("ended", onEnded);
  element.addEventListener("error", onError);
  element.src = input.url;
  element.preload = "metadata";
  element.playsInline = true;
  element.load();
  return {
    play: () => {
      void element.play().catch(() => input.lifecycle.onError("浏览器阻止了视频播放，请再次点击播放。"));
    },
    pause: () => element.pause(),
    seek: (positionMs) => {
      element.currentTime = Math.max(0, positionMs) / 1_000;
    },
    currentTime: () => Math.max(0, Math.round(element.currentTime * 1_000)),
    destroy: () => {
      element.removeEventListener("canplay", onReady);
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("ended", onEnded);
      element.removeEventListener("error", onError);
      element.pause();
      element.removeAttribute("src");
      element.load();
    },
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
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const videoId = videoIdFromEmbed(embedUrl);

  useEffect(() => {
    if (factory || !scriptLoaded) return;
    const ready = () => Boolean((window as YouTubeWindow).YT?.Player);
    const timer = window.setInterval(() => {
      if (!ready()) return;
      window.clearInterval(timer);
      window.clearTimeout(timeout);
      setSdkReady(true);
    }, 50);
    const timeout = window.setTimeout(() => {
      window.clearInterval(timer);
      onError("YouTube 播放器脚本加载超时，请稍后重试。");
    }, 10_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(timeout);
    };
  }, [factory, onError, scriptLoaded]);

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

  return <div className="video-player-adapter">
    <div aria-label={title} id={targetId} ref={targetRef} />
    {!factory ? <Script id="youtube-iframe-api" onError={() => onError("YouTube 播放器脚本加载失败，请稍后重试。")}
      onReady={() => {
        if ((window as YouTubeWindow).YT?.Player) setSdkReady(true);
        else setScriptLoaded(true);
      }} src="https://www.youtube.com/iframe_api" strategy="afterInteractive" /> : null}
    {!videoId ? <p role="alert">播放地址无效。</p> : null}
  </div>;
}

export function NativeVideoPlayerAdapter({ videoUrl, title, factory, onPortChange, onStateChange, onError }: Readonly<{
  videoUrl: string;
  title: string;
  factory?: NativeVideoPlayerFactory;
  onPortChange: (port: VideoPlayerPort | null) => void;
  onStateChange: (state: VideoPlayerState) => void;
  onError: (message: string | null) => void;
}>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!videoRef.current) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const current = () => generationRef.current === generation;
    let port: VideoPlayerPort;
    try {
      port = (factory ?? nativeVideoPlayerFactory)(videoRef.current, {
        url: videoUrl,
        lifecycle: {
          onReady: () => { if (current()) onStateChange("ready"); },
          onStateChange: (state) => { if (current()) onStateChange(state); },
          onError: (message) => { if (current()) onError(message); },
        },
      });
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
  }, [factory, onError, onPortChange, onStateChange, videoUrl]);

  return <div className="video-player-adapter">
    <video aria-label={title} controls playsInline preload="metadata" ref={videoRef}>当前浏览器无法播放视频。</video>
  </div>;
}
