"use client";

import { useEffect, useRef } from "react";

import {
  mountPlyrAutoPauseControl,
  videoPlyrOptions,
  type MountedAutoPauseControl,
  type PlyrConstructor,
  type PlyrInstance,
} from "./media-plyr";

export { mountPlyrAutoPauseControl } from "./media-plyr";

export type VideoPlayerState = "ready" | "playing" | "paused" | "ended";
export type VideoPlayerLifecycle = Readonly<{ onReady: () => void; onStateChange: (state: VideoPlayerState) => void; onError: (message: string) => void }>;
export interface VideoPlayerPort { play(): void; pause(): void; seek(positionMs: number): void; currentTime(): number; destroy(): void }
export type VideoPlayerFactory = (target: HTMLElement, input: Readonly<{ videoId: string; lifecycle: VideoPlayerLifecycle }>) => VideoPlayerPort;
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

export function VideoPlayerAdapter({ embedUrl, title, factory, autoPause, hasSegments, onToggleAutoPause, onAutoPauseControlReady, onPortChange, onStateChange, onError }: Readonly<{
  embedUrl: string;
  title: string;
  factory?: VideoPlayerFactory;
  autoPause: boolean;
  hasSegments: boolean;
  onToggleAutoPause: () => void;
  onAutoPauseControlReady: (ready: boolean) => void;
  onPortChange: (port: VideoPlayerPort | null) => void;
  onStateChange: (state: VideoPlayerState) => void;
  onError: (message: string | null) => void;
}>) {
  const targetRef = useRef<HTMLDivElement>(null);
  const generationRef = useRef(0);
  const autoPauseControlRef = useRef<MountedAutoPauseControl | null>(null);
  const toggleAutoPauseRef = useRef(onToggleAutoPause);
  const autoPauseRef = useRef(autoPause);
  const videoId = videoIdFromEmbed(embedUrl);

  useEffect(() => {
    toggleAutoPauseRef.current = onToggleAutoPause;
    autoPauseRef.current = autoPause;
  }, [autoPause, onToggleAutoPause]);

  useEffect(() => {
    const target = targetRef.current;
    if (!target || !videoId) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const current = () => generationRef.current === generation;
    let cancelled = false;
    let player: PlyrInstance | null = null;
    let port: VideoPlayerPort | null = null;
    let autoPauseControl: MountedAutoPauseControl | null = null;
    let autoPauseMountTimer: number | null = null;
    let autoPauseMountAttempts = 0;
    let ready = false;
    let failed = false;
    const mountAutoPauseControl = () => {
      if (cancelled || !player || autoPauseControl) return;
      autoPauseControl = mountPlyrAutoPauseControl(player, {
        autoPause: autoPauseRef.current,
        disabled: !hasSegments,
        onToggleAutoPause: () => toggleAutoPauseRef.current(),
      });
      if (autoPauseControl) {
        autoPauseControlRef.current = autoPauseControl;
        onAutoPauseControlReady(true);
      } else if (autoPauseMountAttempts < 20) {
        autoPauseMountAttempts += 1;
        autoPauseMountTimer = window.setTimeout(mountAutoPauseControl, 25);
      }
    };
    const readyTimeout = window.setTimeout(() => {
      if (current() && !ready && !factory) onError("YouTube 播放器连接超时，请重试或在 YouTube 打开。");
    }, 8_000);
    const handleReady = () => {
      if (!current()) return;
      ready = true;
      window.clearTimeout(readyTimeout);
      mountAutoPauseControl();
      if (failed) return;
      onError(null);
      onStateChange("ready");
    };
    const handlePlaying = () => {
      if (!current()) return;
      failed = false;
      onError(null);
      onStateChange("playing");
    };
    const handlePaused = () => { if (current()) onStateChange("paused"); };
    const handleEnded = () => { if (current()) onStateChange("ended"); };
    const handleError = () => {
      if (!current()) return;
      failed = true;
      const code = player?.media?.error?.code ?? 0;
      onError(youtubeErrorMessage(code));
    };
    onError(null);
    onAutoPauseControlReady(false);
    if (factory) {
      try {
        port = factory(target, { videoId, lifecycle: {
          onReady: handleReady,
          onStateChange: (state) => {
            if (state === "playing") handlePlaying();
            else if (state === "paused") handlePaused();
            else if (state === "ended") handleEnded();
            else handleReady();
          },
          onError: (message) => { if (current()) onError(message); },
        } });
        onPortChange(port);
      } catch (error) {
        if (current()) onError(error instanceof Error ? error.message : "播放器初始化失败。");
      }
    } else {
      void import("plyr").then((module) => {
        if (cancelled) return;
        const Plyr = (module as unknown as { default: PlyrConstructor }).default;
        player = new Plyr(target, {
          ...videoPlyrOptions,
          youtube: { noCookie: true, rel: 0, showinfo: 0, iv_load_policy: 3, modestbranding: 1 },
        });
        mountAutoPauseControl();
        player.on("ready", handleReady);
        player.on("playing", handlePlaying);
        player.on("play", handlePlaying);
        player.on("pause", handlePaused);
        player.on("ended", handleEnded);
        player.on("error", handleError);
        port = {
          play: () => { if (player) void player.play(); },
          pause: () => player?.pause(),
          seek: (positionMs) => { if (player) player.currentTime = Math.max(0, positionMs) / 1_000; },
          currentTime: () => player ? Math.max(0, Math.round(player.currentTime * 1_000)) : 0,
          destroy: () => player?.destroy(),
        };
        onPortChange(port);
      }).catch(() => {
        if (current()) onError("YouTube 播放器加载失败，请重试或在 YouTube 打开。");
      });
    }
    return () => {
      cancelled = true;
      window.clearTimeout(readyTimeout);
      if (autoPauseMountTimer !== null) window.clearTimeout(autoPauseMountTimer);
      if (generationRef.current === generation) generationRef.current += 1;
      onAutoPauseControlReady(false);
      autoPauseControl?.destroy();
      if (autoPauseControlRef.current === autoPauseControl) autoPauseControlRef.current = null;
      if (player) {
        player.off("ready", handleReady);
        player.off("playing", handlePlaying);
        player.off("play", handlePlaying);
        player.off("pause", handlePaused);
        player.off("ended", handleEnded);
        player.off("error", handleError);
      }
      onPortChange(null);
      port?.destroy();
    };
  }, [embedUrl, factory, hasSegments, onAutoPauseControlReady, onError, onPortChange, onStateChange, videoId]);

  useEffect(() => {
    autoPauseControlRef.current?.setAutoPause(autoPause);
  }, [autoPause]);

  const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
  return <div className="video-player-adapter">
    <div aria-label={title} data-plyr-embed-id={videoId ?? undefined} data-plyr-provider={factory ? undefined : "youtube"} ref={targetRef} />
    {!videoId ? <p role="alert">播放地址无效。</p> : null}
    <div className="video-player-adapter__help">
      {watchUrl ? <a href={watchUrl} rel="noopener noreferrer" target="_blank">在 YouTube 打开</a> : null}
    </div>
  </div>;
}

export function HostedVideoPlayerAdapter({ videoUrl, title, autoPause, hasSegments, onToggleAutoPause, onAutoPauseControlReady, onPortChange, onStateChange, onTimeUpdate, onError }: Readonly<{
  videoUrl: string;
  title: string;
  autoPause: boolean;
  hasSegments: boolean;
  onToggleAutoPause: () => void;
  onAutoPauseControlReady: (ready: boolean) => void;
  onPortChange: (port: VideoPlayerPort | null) => void;
  onStateChange: (state: VideoPlayerState) => void;
  onTimeUpdate: (positionMs: number) => void;
  onError: (message: string | null) => void;
}>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const toggleAutoPauseRef = useRef(onToggleAutoPause);
  const autoPauseRef = useRef(autoPause);
  useEffect(() => {
    toggleAutoPauseRef.current = onToggleAutoPause;
    autoPauseRef.current = autoPause;
  }, [autoPause, onToggleAutoPause]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let player: PlyrInstance | null = null;
    let port: VideoPlayerPort | null = null;
    let autoPauseControl: MountedAutoPauseControl | null = null;
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
      player = new Plyr(video, videoPlyrOptions);
      autoPauseControl = mountPlyrAutoPauseControl(player, {
        autoPause: autoPauseRef.current,
        disabled: !hasSegments,
        onToggleAutoPause: () => toggleAutoPauseRef.current(),
      });
      onAutoPauseControlReady(autoPauseControl !== null);
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
        seek: (positionMs) => {
          const seconds = Math.max(0, positionMs) / 1_000;
          video.currentTime = seconds;
          if (player) player.currentTime = seconds;
        },
        currentTime: () => player ? Math.max(0, Math.round(player.currentTime * 1_000)) : Math.max(0, Math.round(video.currentTime * 1_000)),
        destroy: () => player?.destroy(),
      };
      onPortChange(port);
      if (video.readyState >= 1) loaded();
    }).catch(() => { if (!cancelled) onError("本站视频播放器加载失败，请重试或检查媒体资源。"); });
    return () => {
      cancelled = true;
      onAutoPauseControlReady(false);
      autoPauseControl?.destroy();
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
  }, [hasSegments, onAutoPauseControlReady, onError, onPortChange, onStateChange, onTimeUpdate, videoUrl]);

  useEffect(() => {
    const controls = videoRef.current?.closest(".plyr")?.querySelector<HTMLButtonElement>("[data-media-auto-pause-control]");
    if (controls) {
      controls.setAttribute("aria-pressed", String(autoPause));
      const label = !hasSegments ? "暂无已审核分句，无法自动暂停" : autoPause ? "关闭自动暂停" : "开启自动暂停";
      controls.title = label;
      controls.setAttribute("aria-label", label);
    }
  }, [autoPause, hasSegments]);

  return <video aria-label={title} controls playsInline preload="metadata" ref={videoRef} src={videoUrl} />;
}
