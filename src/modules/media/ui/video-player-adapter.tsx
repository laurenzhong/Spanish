"use client";

import { useEffect, useRef } from "react";

import { mountPlyrAutoPauseControl, videoPlyrOptions, type MountedAutoPauseControl, type PlyrConstructor, type PlyrInstance } from "./media-plyr";
export { mountPlyrAutoPauseControl } from "./media-plyr";

export type VideoPlayerState = "ready" | "playing" | "paused" | "ended";
export type VideoPlayerLifecycle = Readonly<{ onReady: () => void; onStateChange: (state: VideoPlayerState) => void; onError: (message: string) => void }>;
export interface VideoPlayerPort { play(): void; pause(): void; seek(positionMs: number): void; currentTime(): number; destroy(): void }
export type VideoPlayerFactory = (target: HTMLElement, input: Readonly<{ videoId: string; lifecycle: VideoPlayerLifecycle }>) => VideoPlayerPort;
export function HostedVideoPlayerAdapter({ videoUrl, title, factory, onPortChange, onStateChange, onTimeUpdate, onError, autoPause = false, hasSegments = false, onToggleAutoPause, onAutoPauseControlReady }: Readonly<{
  videoUrl: string;
  title: string;
  factory?: VideoPlayerFactory;
  onPortChange: (port: VideoPlayerPort | null) => void;
  onStateChange: (state: VideoPlayerState) => void;
  onTimeUpdate: (positionMs: number) => void;
  onError: (message: string | null) => void;
  autoPause?: boolean;
  hasSegments?: boolean;
  onToggleAutoPause?: () => void;
  onAutoPauseControlReady?: (ready: boolean) => void;
}>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const autoPauseRef = useRef(autoPause);
  const hasSegmentsRef = useRef(hasSegments);
  const onToggleAutoPauseRef = useRef(onToggleAutoPause);
  const autoPauseControlRef = useRef<MountedAutoPauseControl | null>(null);
  useEffect(() => {
    autoPauseRef.current = autoPause;
    hasSegmentsRef.current = hasSegments;
    onToggleAutoPauseRef.current = onToggleAutoPause;
  }, [autoPause, hasSegments, onToggleAutoPause]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let player: PlyrInstance | null = null;
    let port: VideoPlayerPort | null = null;
    autoPauseControlRef.current?.destroy();
    autoPauseControlRef.current = null;
    onAutoPauseControlReady?.(false);
    const loaded = () => { onError(null); onStateChange("ready"); };
    const playing = () => onStateChange("playing");
    const paused = () => onStateChange("paused");
    const ended = () => onStateChange("ended");
    const timeUpdate = () => { if (player) onTimeUpdate(Math.max(0, Math.round(player.currentTime * 1_000))); };
    const error = () => onError("本站视频资源暂时无法播放，请重试或检查媒体托管状态。");
    if (factory) {
      try {
        port = factory(video, { videoId: "hosted-video", lifecycle: {
          onReady: loaded,
          onStateChange: (state) => { if (state === "playing") playing(); else if (state === "paused") paused(); else if (state === "ended") ended(); else loaded(); },
          onError,
        } });
        onPortChange(port);
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : "本站视频播放器加载失败，请重试或检查媒体资源。");
      }
      return () => { onPortChange(null); port?.destroy(); };
    }
    video.addEventListener("loadedmetadata", loaded);
    void import("plyr").then((module) => {
      if (cancelled) return;
      const Plyr = (module as unknown as { default: PlyrConstructor }).default;
      player = new Plyr(video, videoPlyrOptions);
      autoPauseControlRef.current = mountPlyrAutoPauseControl(player, {
        autoPause: autoPauseRef.current,
        disabled: !hasSegmentsRef.current,
        onToggleAutoPause: () => onToggleAutoPauseRef.current?.(),
      });
      onAutoPauseControlReady?.(autoPauseControlRef.current !== null);
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
      if (player) {
        player.off("ready", loaded);
        player.off("playing", playing);
        player.off("play", playing);
        player.off("pause", paused);
        player.off("ended", ended);
        player.off("timeupdate", timeUpdate);
        player.off("error", error);
      }
      autoPauseControlRef.current?.destroy();
      autoPauseControlRef.current = null;
      onAutoPauseControlReady?.(false);
      video.removeEventListener("loadedmetadata", loaded);
      onPortChange(null);
      port?.destroy();
    };
  }, [factory, onAutoPauseControlReady, onError, onPortChange, onStateChange, onTimeUpdate, videoUrl]);

  useEffect(() => {
    autoPauseControlRef.current?.setAutoPause(autoPauseRef.current);
  }, [autoPause]);

  return <video aria-label={title} controls playsInline preload="metadata" ref={videoRef} src={videoUrl} />;
}
