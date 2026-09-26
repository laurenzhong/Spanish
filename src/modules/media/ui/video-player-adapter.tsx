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
export type VideoPlayerLifecycle = Readonly<{ onReady: () => void; onStateChange: (state: VideoPlayerState) => void; onError: (message: string) => void; onPositionChange?: () => void }>;
export interface VideoPlayerPort { play(): void; pause(): void; seek(positionMs: number): void; currentTime(): number; destroy(): void }
export type VideoPlayerFactory = (target: HTMLElement, input: Readonly<{ videoId: string; lifecycle: VideoPlayerLifecycle }>) => VideoPlayerPort;
export type NativeVideoPlayerFactory = (element: HTMLVideoElement, input: Readonly<{ url: string; lifecycle: VideoPlayerLifecycle }>) => VideoPlayerPort;
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

export function VideoPlayerAdapter({ embedUrl, title, factory, autoPause, hasSegments, onToggleAutoPause, onAutoPauseControlReady, onPortChange, onPositionChange, onStateChange, onError }: Readonly<{
  embedUrl: string;
  title: string;
  factory?: VideoPlayerFactory;
  autoPause: boolean;
  hasSegments: boolean;
  onToggleAutoPause: () => void;
  onAutoPauseControlReady: (ready: boolean) => void;
  onPortChange: (port: VideoPlayerPort | null) => void;
  onPositionChange?: () => void;
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
    let playerDestroyed = false;
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
    const destroyPlayer = () => {
      if (!player || playerDestroyed) return;
      playerDestroyed = true;
      player.destroy();
    };
    const handleReady = () => {
      if (!current()) {
        // Plyr's YouTube SDK callback can arrive after React has already
        // removed the component. Tear down the late instance instead of
        // leaving an iframe and SDK listeners attached to a stale node.
        destroyPlayer();
        return;
      }
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
    const positionChanged = () => { if (current()) onPositionChange?.(); };
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
          onPositionChange: () => { if (current()) onPositionChange?.(); },
          onError: (message) => { if (current()) onError(message); },
        } });
        onPortChange(port);
      } catch (error) {
        if (current()) onError(error instanceof Error ? error.message : "播放器初始化失败。");
      }
    } else {
      void import("plyr").then((module) => {
        if (cancelled) return;
        const candidate = module as unknown as { default?: PlyrConstructor };
        const Plyr = candidate.default ?? module as unknown as PlyrConstructor;
        player = new Plyr(target, {
          ...videoPlyrOptions,
          youtube: { noCookie: true, rel: 0, showinfo: 0, iv_load_policy: 3, modestbranding: 1 },
        });
        const playerContainer = player.elements?.container ?? target;
        playerContainer.setAttribute("aria-label", `${title}`);
        playerContainer.dataset.plyrEmbedId = videoId;
        playerContainer.dataset.videoId = videoId;
        mountAutoPauseControl();
        player.on("ready", handleReady);
        player.on("playing", handlePlaying);
        player.on("play", handlePlaying);
        player.on("pause", handlePaused);
        player.on("ended", handleEnded);
        player.on("timeupdate", positionChanged);
        player.on("seeking", positionChanged);
        player.on("seeked", positionChanged);
        player.on("error", handleError);
        port = {
          play: () => {
            if (!player) return;
            void Promise.resolve(player.play()).catch(() => onError("浏览器阻止了视频播放，请再次点击播放。"));
          },
          pause: () => {
            player?.pause();
          },
          seek: (positionMs) => {
            const seconds = Math.max(0, positionMs) / 1_000;
            playerContainer.dataset.currentTime = String(seconds);
            if (player) player.currentTime = seconds;
          },
          currentTime: () => player ? Math.max(0, Math.round(player.currentTime * 1_000)) : 0,
          destroy: destroyPlayer,
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
        player.off("timeupdate", positionChanged);
        player.off("seeking", positionChanged);
        player.off("seeked", positionChanged);
        player.off("error", handleError);
      }
      onPortChange(null);
      if (port) port.destroy();
      destroyPlayer();
    };
  }, [embedUrl, factory, hasSegments, onAutoPauseControlReady, onError, onPortChange, onPositionChange, onStateChange, title, videoId]);

  useEffect(() => {
    autoPauseControlRef.current?.setAutoPause(autoPause);
  }, [autoPause]);

  const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
  return <div className="video-player-adapter">
    <div aria-label={title} data-plyr-embed-id={videoId ?? undefined} data-plyr-provider={factory ? undefined : "youtube"} data-video-id={videoId ?? undefined} ref={targetRef} />
    {!videoId ? <p role="alert">播放地址无效。</p> : null}
    <div className="video-player-adapter__help">
      {watchUrl ? <a href={watchUrl} rel="noopener noreferrer" target="_blank">在 YouTube 打开</a> : null}
    </div>
  </div>;
}

export function HostedVideoPlayerAdapter({ videoUrl, title, factory, autoPause, hasSegments, onToggleAutoPause, onAutoPauseControlReady, onPortChange, onPositionChange, onStateChange, onError }: Readonly<{
  videoUrl: string;
  title: string;
  factory?: NativeVideoPlayerFactory;
  autoPause: boolean;
  hasSegments: boolean;
  onToggleAutoPause: () => void;
  onAutoPauseControlReady: (ready: boolean) => void;
  onPortChange: (port: VideoPlayerPort | null) => void;
  onPositionChange?: () => void;
  onStateChange: (state: VideoPlayerState) => void;
  onError: (message: string | null) => void;
}>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const generationRef = useRef(0);
  const toggleAutoPauseRef = useRef(onToggleAutoPause);
  const autoPauseRef = useRef(autoPause);
  useEffect(() => {
    toggleAutoPauseRef.current = onToggleAutoPause;
    autoPauseRef.current = autoPause;
  }, [autoPause, onToggleAutoPause]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const current = () => generationRef.current === generation;
    let cancelled = false;
    let player: PlyrInstance | null = null;
    let playerDestroyed = false;
    let port: VideoPlayerPort | null = null;
    let autoPauseControl: MountedAutoPauseControl | null = null;
    let autoPauseMountTimer: number | null = null;
    let autoPauseMountAttempts = 0;

    const ready = () => { if (current()) { onError(null); onStateChange("ready"); } };
    const playing = () => { if (current()) onStateChange("playing"); };
    const paused = () => { if (current()) onStateChange("paused"); };
    const ended = () => { if (current()) onStateChange("ended"); };
    const positionChanged = () => { if (current()) onPositionChange?.(); };
    const error = () => { if (current()) onError("本站视频资源暂时无法播放，请重试或检查媒体托管状态。"); };
    const destroyPlayer = () => {
      if (!player || playerDestroyed) return;
      playerDestroyed = true;
      player.destroy();
    };
    const mountAutoPause = () => {
      if (cancelled || !player || autoPauseControl) return;
      autoPauseControl = mountPlyrAutoPauseControl(player, {
        autoPause: autoPauseRef.current,
        disabled: !hasSegments,
        onToggleAutoPause: () => toggleAutoPauseRef.current(),
      });
      if (autoPauseControl) onAutoPauseControlReady(true);
      else if (autoPauseMountAttempts < 20) {
        autoPauseMountAttempts += 1;
        autoPauseMountTimer = window.setTimeout(mountAutoPause, 25);
      }
    };

    video.src = videoUrl;
    video.dataset.source = videoUrl;
    video.preload = "metadata";
    onAutoPauseControlReady(false);
    if (factory) {
      try {
        port = factory(video, {
          url: videoUrl,
          lifecycle: {
            onReady: ready,
            onStateChange: (state) => {
              if (state === "playing") playing();
              else if (state === "paused") paused();
              else if (state === "ended") ended();
              else ready();
            },
            onPositionChange: positionChanged,
            onError: (message) => { if (current()) onError(message); },
          },
        });
        if (current()) onPortChange(port);
      } catch (caught) {
        if (current()) onError(caught instanceof Error ? caught.message : "播放器初始化失败。");
      }
    } else {
      void import("plyr").then((module) => {
        if (cancelled || !current()) return;
        video.addEventListener("canplay", ready);
        video.addEventListener("loadedmetadata", ready);
        video.addEventListener("play", playing);
        video.addEventListener("playing", playing);
        video.addEventListener("pause", paused);
        video.addEventListener("ended", ended);
        video.addEventListener("timeupdate", positionChanged);
        video.addEventListener("seeking", positionChanged);
        video.addEventListener("seeked", positionChanged);
        video.addEventListener("error", error);
        const candidate = module as unknown as { default?: PlyrConstructor };
        const Plyr = candidate.default ?? module as unknown as PlyrConstructor;
        player = new Plyr(video, videoPlyrOptions);
        const playerContainer = player.elements?.container;
        playerContainer?.setAttribute("aria-label", title);
        video.removeAttribute("aria-label");
        player.on("ready", ready);
        mountAutoPause();
        port = {
          play: () => {
            if (!player) return;
            void Promise.resolve(player.play()).catch(() => onError("浏览器阻止了视频播放，请再次点击播放。"));
          },
          pause: () => {
            player?.pause();
            video.pause();
          },
          seek: (positionMs) => {
            const seconds = Math.max(0, positionMs) / 1_000;
            // Keep the native element in sync while Plyr is still loading.
            video.currentTime = seconds;
            if (player) player.currentTime = seconds;
          },
          currentTime: () => Math.max(0, Math.round(video.currentTime * 1_000)),
          destroy: destroyPlayer,
        };
        onPortChange(port);
        if (video.readyState >= 1) ready();
      }).catch(() => { if (current()) onError("统一视频播放器加载失败，请重试或检查媒体资源。"); });
    }
    return () => {
      cancelled = true;
      if (generationRef.current === generation) generationRef.current += 1;
      if (autoPauseMountTimer !== null) window.clearTimeout(autoPauseMountTimer);
      onAutoPauseControlReady(false);
      autoPauseControl?.destroy();
      if (player) {
        player.off("ready", ready);
      }
      video.removeEventListener("canplay", ready);
      video.removeEventListener("loadedmetadata", ready);
      video.removeEventListener("play", playing);
      video.removeEventListener("playing", playing);
      video.removeEventListener("pause", paused);
      video.removeEventListener("ended", ended);
      video.removeEventListener("timeupdate", positionChanged);
      video.removeEventListener("seeking", positionChanged);
      video.removeEventListener("seeked", positionChanged);
      video.removeEventListener("error", error);
      onPortChange(null);
      if (port) port.destroy();
      destroyPlayer();
    };
  }, [factory, hasSegments, onAutoPauseControlReady, onError, onPortChange, onPositionChange, onStateChange, title, videoUrl]);

  useEffect(() => {
    const controls = videoRef.current?.closest(".plyr")?.querySelector<HTMLButtonElement>("[data-media-auto-pause-control]");
    if (controls) {
      controls.setAttribute("aria-pressed", String(autoPause));
      const label = !hasSegments ? "暂无已审核分句，无法自动暂停" : autoPause ? "关闭自动暂停" : "开启自动暂停";
      controls.title = label;
      controls.setAttribute("aria-label", label);
    }
  }, [autoPause, hasSegments]);

  return <div className="video-player-adapter"><video aria-label={title} playsInline preload="metadata" ref={videoRef} src={videoUrl}>当前浏览器无法播放视频。</video></div>;
}

/** @deprecated This is retained as an explicit test seam. The default path is HostedVideoPlayerAdapter + Plyr. */
export const nativeVideoPlayerFactory: NativeVideoPlayerFactory = (element, input) => {
  const onReady = () => input.lifecycle.onReady();
  const onPlay = () => input.lifecycle.onStateChange("playing");
  const onPause = () => { if (!element.ended) input.lifecycle.onStateChange("paused"); };
  const onPositionChange = () => input.lifecycle.onPositionChange?.();
  const onEnded = () => input.lifecycle.onStateChange("ended");
  const onError = () => input.lifecycle.onError("视频暂时无法播放，请检查网络后重试。");
  element.addEventListener("canplay", onReady);
  element.addEventListener("play", onPlay);
  element.addEventListener("pause", onPause);
  element.addEventListener("timeupdate", onPositionChange);
  element.addEventListener("seeking", onPositionChange);
  element.addEventListener("seeked", onPositionChange);
  element.addEventListener("ended", onEnded);
  element.addEventListener("error", onError);
  element.src = input.url;
  element.preload = "metadata";
  element.playsInline = true;
  element.load();
  return {
    play: () => { void element.play().catch(() => input.lifecycle.onError("浏览器阻止了视频播放，请再次点击播放。")); },
    pause: () => element.pause(),
    seek: (positionMs) => { element.currentTime = Math.max(0, positionMs) / 1_000; },
    currentTime: () => Math.max(0, Math.round(element.currentTime * 1_000)),
    destroy: () => {
      element.removeEventListener("canplay", onReady);
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("timeupdate", onPositionChange);
      element.removeEventListener("seeking", onPositionChange);
      element.removeEventListener("seeked", onPositionChange);
      element.removeEventListener("ended", onEnded);
      element.removeEventListener("error", onError);
      element.pause();
      element.removeAttribute("src");
      element.load();
    },
  };
};

/**
 * Compatibility wrapper for older test fixtures. It never selects a native
 * production default; without an explicit factory it still mounts Plyr.
 */
export function NativeVideoPlayerAdapter({ videoUrl, title, factory, onPortChange, onPositionChange, onStateChange, onError }: Readonly<{
  videoUrl: string;
  title: string;
  factory?: NativeVideoPlayerFactory;
  onPortChange: (port: VideoPlayerPort | null) => void;
  onPositionChange?: () => void;
  onStateChange: (state: VideoPlayerState) => void;
  onError: (message: string | null) => void;
}>) {
  return <HostedVideoPlayerAdapter autoPause={false} factory={factory} hasSegments={false} onAutoPauseControlReady={() => undefined} onError={onError} onPortChange={onPortChange} onPositionChange={onPositionChange ?? (() => undefined)} onStateChange={onStateChange} onToggleAutoPause={() => undefined} title={title} videoUrl={videoUrl} />;
}
