"use client";

import { useEffect, useEffectEvent, useRef } from "react";

import {
  applyPlyrSpeed,
  DEFAULT_MEDIA_PLAYBACK_SPEED,
  disableNativeMediaControls,
  markPlyrContainer,
  mountPlyrAutoPauseControl,
  videoPlyrOptions,
  type MountedAutoPauseControl,
  type PlyrConstructor,
  type PlyrInstance,
} from "./media-plyr";

export { mountPlyrAutoPauseControl } from "./media-plyr";

export type VideoPlayerState = "ready" | "playing" | "paused" | "ended";
export type VideoPlayerLifecycle = Readonly<{ onReady: () => void; onStateChange: (state: VideoPlayerState) => void; onError: (message: string) => void; onPositionChange?: () => void }>;
export interface VideoPlayerPort { play(): void; pause(): void; seek(positionMs: number): void; currentTime(): number; /** Optional so existing controlled test fakes keep working unchanged. */ setSpeed?(speed: number): void; destroy(): void }
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

export function VideoPlayerAdapter({ embedUrl, title, factory, speed = DEFAULT_MEDIA_PLAYBACK_SPEED, autoPause, hasSegments, onToggleAutoPause, onPortChange: onPortChangeCallback, onPositionChange: onPositionChangeCallback, onStateChange: onStateChangeCallback, onError: onErrorCallback }: Readonly<{
  embedUrl: string;
  title: string;
  factory?: VideoPlayerFactory;
  /** Playback speed chosen through the workbench's visible control. */
  speed?: number;
  autoPause: boolean;
  hasSegments: boolean;
  onToggleAutoPause: () => void;
  onPortChange: (port: VideoPlayerPort | null) => void;
  onPositionChange?: () => void;
  onStateChange: (state: VideoPlayerState) => void;
  onError: (message: string | null) => void;
}>) {
  const onPortChange = useEffectEvent(onPortChangeCallback);
  const onPositionChange = useEffectEvent(onPositionChangeCallback ?? (() => undefined));
  const onStateChange = useEffectEvent(onStateChangeCallback);
  const onError = useEffectEvent(onErrorCallback);
  const targetRef = useRef<HTMLDivElement>(null);
  const generationRef = useRef(0);
  const autoPauseControlRef = useRef<MountedAutoPauseControl | null>(null);
  const portRef = useRef<VideoPlayerPort | null>(null);
  const toggleAutoPauseRef = useRef(onToggleAutoPause);
  const autoPauseRef = useRef(autoPause);
  const speedRef = useRef(speed);
  const videoId = videoIdFromEmbed(embedUrl);

  useEffect(() => {
    toggleAutoPauseRef.current = onToggleAutoPause;
    autoPauseRef.current = autoPause;
    speedRef.current = speed;
  }, [autoPause, onToggleAutoPause, speed]);

  useEffect(() => {
    const host = targetRef.current;
    if (!host || !videoId) return;
    // Plyr replaces its input with a clone on destroy. React owns the host;
    // each resource mount owns a fresh input so it can never reuse a detached node.
    const target = document.createElement("div");
    target.setAttribute("aria-label", title);
    target.dataset.plyrEmbedId = videoId;
    if (!factory) target.dataset.plyrProvider = "youtube";
    target.dataset.videoId = videoId;
    host.replaceChildren(target);
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
    target.dataset.mediaPlayerState = "loading";
    if (factory) {
      try {
        target.dataset.mediaPlayerState = "test-factory";
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
        portRef.current = port;
        onPortChange(port);
      } catch (error) {
        target.dataset.mediaPlayerState = "error";
        if (current()) onError(error instanceof Error ? error.message : "播放器初始化失败。");
      }
    } else {
      void import("plyr").then((module) => {
        if (cancelled) return;
        const candidate = module as unknown as { default?: PlyrConstructor };
        const Plyr = candidate.default ?? module as unknown as PlyrConstructor;
        player = new Plyr(target, {
          ...videoPlyrOptions,
          speed: { options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2], selected: speedRef.current },
          youtube: { noCookie: true, rel: 0, showinfo: 0, iv_load_policy: 3, modestbranding: 1 },
        });
        const playerContainer = markPlyrContainer(player, target, "video");
        playerContainer.dataset.mediaPlayerState = "ready";
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
        const plyrInstance = player;
        applyPlyrSpeed(plyrInstance, speedRef.current);
        port = {
          play: () => {
            if (!plyrInstance) return;
            void Promise.resolve(plyrInstance.play()).catch(() => { if (current()) onError("浏览器阻止了视频播放，请再次点击播放。"); });
          },
          pause: () => {
            plyrInstance?.pause();
          },
          seek: (positionMs) => {
            const seconds = Math.max(0, positionMs) / 1_000;
            playerContainer.dataset.currentTime = String(seconds);
            if (plyrInstance) plyrInstance.currentTime = seconds;
          },
          currentTime: () => plyrInstance ? Math.max(0, Math.round(plyrInstance.currentTime * 1_000)) : 0,
          setSpeed: (nextSpeed) => {
            applyPlyrSpeed(plyrInstance, nextSpeed);
          },
          destroy: destroyPlayer,
        };
        portRef.current = port;
        onPortChange(port);
      }).catch(() => {
        target.dataset.mediaPlayerState = "error";
        if (current()) onError("YouTube 播放器加载失败，请重试或在 YouTube 打开。");
      });
    }
    return () => {
      cancelled = true;
      window.clearTimeout(readyTimeout);
      if (autoPauseMountTimer !== null) window.clearTimeout(autoPauseMountTimer);
      if (generationRef.current === generation) generationRef.current += 1;
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
      portRef.current = null;
      onPortChange(null);
      if (port) port.destroy();
      destroyPlayer();
      host.replaceChildren();
    };
  }, [embedUrl, factory, hasSegments, title, videoId]);

  useEffect(() => {
    autoPauseControlRef.current?.setAutoPause(autoPause);
  }, [autoPause]);

  useEffect(() => {
    // Mounting applies speedRef to the new port. Later speed changes update
    // the existing port without restarting playback.
    speedRef.current = speed;
    portRef.current?.setSpeed?.(speed);
  }, [speed]);

  const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
  return <div className="video-player-adapter">
    <div ref={targetRef} />
    {!videoId ? <p role="alert">播放地址无效。</p> : null}
    <div className="video-player-adapter__help">
      {watchUrl ? <a href={watchUrl} rel="noopener noreferrer" target="_blank">在 YouTube 打开</a> : null}
    </div>
  </div>;
}

export function HostedVideoPlayerAdapter({ videoUrl, title, factory, speed = DEFAULT_MEDIA_PLAYBACK_SPEED, autoPause, hasSegments, onToggleAutoPause, onPortChange: onPortChangeCallback, onPositionChange: onPositionChangeCallback, onStateChange: onStateChangeCallback, onError: onErrorCallback }: Readonly<{
  videoUrl: string;
  title: string;
  factory?: NativeVideoPlayerFactory;
  /** Playback speed chosen through the workbench's visible control. */
  speed?: number;
  autoPause: boolean;
  hasSegments: boolean;
  onToggleAutoPause: () => void;
  onPortChange: (port: VideoPlayerPort | null) => void;
  onPositionChange?: () => void;
  onStateChange: (state: VideoPlayerState) => void;
  onError: (message: string | null) => void;
}>) {
  const onPortChange = useEffectEvent(onPortChangeCallback);
  const onPositionChange = useEffectEvent(onPositionChangeCallback ?? (() => undefined));
  const onStateChange = useEffectEvent(onStateChangeCallback);
  const onError = useEffectEvent(onErrorCallback);
  const hostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const generationRef = useRef(0);
  const portRef = useRef<VideoPlayerPort | null>(null);
  const toggleAutoPauseRef = useRef(onToggleAutoPause);
  const autoPauseRef = useRef(autoPause);
  const speedRef = useRef(speed);
  useEffect(() => {
    toggleAutoPauseRef.current = onToggleAutoPause;
    autoPauseRef.current = autoPause;
    speedRef.current = speed;
  }, [autoPause, onToggleAutoPause, speed]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const video = document.createElement("video");
    video.setAttribute("aria-label", title);
    video.playsInline = true;
    videoRef.current = video;
    host.replaceChildren(video);
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
      if (!autoPauseControl && autoPauseMountAttempts < 20) {
        autoPauseMountAttempts += 1;
        autoPauseMountTimer = window.setTimeout(mountAutoPause, 25);
      }
    };

    disableNativeMediaControls(video);
    video.dataset.mediaPlayerState = "loading";
    video.src = videoUrl;
    video.dataset.source = videoUrl;
    video.preload = "metadata";
    if (factory) {
      try {
        video.dataset.mediaPlayerState = "test-factory";
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
        if (current()) {
          portRef.current = port;
          onPortChange(port);
        }
      } catch (caught) {
        video.dataset.mediaPlayerState = "error";
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
        player = new Plyr(video, { ...videoPlyrOptions, speed: { options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2], selected: speedRef.current } });
        const playerContainer = markPlyrContainer(player, video, "video");
        playerContainer.dataset.mediaPlayerState = "ready";
        playerContainer.setAttribute("aria-label", title);
        video.removeAttribute("aria-label");
        player.on("ready", ready);
        mountAutoPause();
        const plyrInstance = player;
        port = {
          play: () => {
            if (!plyrInstance) return;
            void Promise.resolve(plyrInstance.play()).catch(() => { if (current()) onError("浏览器阻止了视频播放，请再次点击播放。"); });
          },
          pause: () => {
            plyrInstance?.pause();
            video.pause();
          },
          seek: (positionMs) => {
            const seconds = Math.max(0, positionMs) / 1_000;
            // Keep the native element in sync while Plyr is still loading.
            video.currentTime = seconds;
            if (plyrInstance) plyrInstance.currentTime = seconds;
          },
          currentTime: () => Math.max(0, Math.round(video.currentTime * 1_000)),
          setSpeed: (nextSpeed) => {
            applyPlyrSpeed(plyrInstance, nextSpeed);
          },
          destroy: destroyPlayer,
        };
        applyPlyrSpeed(plyrInstance, speedRef.current);
        portRef.current = port;
        onPortChange(port);
        if (video.readyState >= 1) ready();
      }).catch(() => {
        video.dataset.mediaPlayerState = "error";
        if (current()) onError("统一视频播放器加载失败，请重试或检查媒体资源。");
      });
    }
    return () => {
      cancelled = true;
      if (generationRef.current === generation) generationRef.current += 1;
      if (autoPauseMountTimer !== null) window.clearTimeout(autoPauseMountTimer);
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
      portRef.current = null;
      onPortChange(null);
      if (port) port.destroy();
      destroyPlayer();
      if (videoRef.current === video) videoRef.current = null;
      host.replaceChildren();
    };
  }, [factory, hasSegments, title, videoUrl]);

  useEffect(() => {
    // Mounting applies speedRef to the new port. Later speed changes update
    // the existing port without restarting playback.
    speedRef.current = speed;
    portRef.current?.setSpeed?.(speed);
  }, [speed]);

  useEffect(() => {
    const controls = videoRef.current?.closest(".plyr")?.querySelector<HTMLButtonElement>("[data-media-auto-pause-control]");
    if (controls) {
      controls.setAttribute("aria-pressed", String(autoPause));
      const label = !hasSegments ? "暂无已审核分句，无法自动暂停" : autoPause ? "关闭自动暂停" : "开启自动暂停";
      controls.title = label;
      controls.setAttribute("aria-label", label);
    }
  }, [autoPause, hasSegments]);

  return <div className="video-player-adapter" ref={hostRef} />;
}

/** @deprecated This is retained as an explicit test seam. The default path is HostedVideoPlayerAdapter + Plyr. */
export const nativeVideoPlayerFactory: NativeVideoPlayerFactory = (element, input) => {
  // This factory is retained only as a deterministic test seam. Keep the
  // same native-control invariant if a test installs it on a reused node.
  disableNativeMediaControls(element);
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
  return <HostedVideoPlayerAdapter autoPause={false} factory={factory} hasSegments={false} onError={onError} onPortChange={onPortChange} onPositionChange={onPositionChange ?? (() => undefined)} onStateChange={onStateChange} onToggleAutoPause={() => undefined} title={title} videoUrl={videoUrl} />;
}
