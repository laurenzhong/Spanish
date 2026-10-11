"use client";

import { useEffect, useRef, useState } from "react";

import type { MediaArtwork } from "../domain";
import {
  applyPlyrSpeed,
  audioPlyrOptions,
  DEFAULT_MEDIA_PLAYBACK_SPEED,
  disableNativeMediaControls,
  markPlyrContainer,
  mountPlyrAutoPauseControl,
  type MountedAutoPauseControl,
  type PlyrConstructor,
  type PlyrInstance,
} from "./media-plyr";

export type AudioPlayerState = "ready" | "playing" | "paused" | "ended";
export type AudioPlayerLifecycle = Readonly<{
  onReady: () => void;
  onStateChange: (state: AudioPlayerState) => void;
  onError: (message: string) => void;
  onPositionChange?: () => void;
}>;

export interface AudioPlayerPort {
  play(): void;
  pause(): void;
  seek(positionMs: number): void;
  currentTime(): number;
  /** Optional so existing controlled test fakes keep working unchanged. */
  setSpeed?(speed: number): void;
  destroy(): void;
}

/** Test seam for browser-media fakes. Production callers leave this undefined. */
export type AudioPlayerFactory = (
  element: HTMLAudioElement,
  input: Readonly<{ url: string; lifecycle: AudioPlayerLifecycle }>,
) => AudioPlayerPort;

/** @deprecated Use an injected factory only in tests; production uses Plyr. */
export const nativeAudioPlayerFactory: AudioPlayerFactory = (element, input) => {
  // This factory is retained only as a deterministic test seam. Keep the
  // same native-control invariant if a test installs it on a reused node.
  disableNativeMediaControls(element);
  const onReady = () => input.lifecycle.onReady();
  const onPlay = () => input.lifecycle.onStateChange("playing");
  const onPause = () => {
    if (!element.ended) input.lifecycle.onStateChange("paused");
  };
  const onPositionChange = () => input.lifecycle.onPositionChange?.();
  const onEnded = () => input.lifecycle.onStateChange("ended");
  const onError = () => input.lifecycle.onError("播客音频暂时无法播放，请检查网络后重试。");

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
  element.load();

  return {
    play: () => {
      void element.play().catch(() => input.lifecycle.onError("浏览器阻止了音频播放，请再次点击播放。"));
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

function resolvePlyrConstructor(module: unknown): PlyrConstructor {
  const candidate = module as { default?: unknown };
  return (candidate.default ?? module) as PlyrConstructor;
}

export function AudioPlayerAdapter({
  audioUrl,
  artwork,
  title,
  factory,
  speed = DEFAULT_MEDIA_PLAYBACK_SPEED,
  autoPause,
  hasSegments,
  onToggleAutoPause,
  onAutoPauseControlReady,
  onPortChange,
  onPositionChange,
  onStateChange,
  onError,
}: Readonly<{
  audioUrl: string;
  artwork?: MediaArtwork | null;
  title: string;
  factory?: AudioPlayerFactory;
  /** Playback speed chosen through the workbench's visible control. */
  speed?: number;
  autoPause: boolean;
  hasSegments: boolean;
  onToggleAutoPause: () => void;
  onAutoPauseControlReady: (ready: boolean) => void;
  onPortChange: (port: AudioPlayerPort | null) => void;
  onPositionChange: () => void;
  onStateChange: (state: AudioPlayerState) => void;
  onError: (message: string | null) => void;
}>) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const generationRef = useRef(0);
  const autoPauseControlRef = useRef<MountedAutoPauseControl | null>(null);
  const portRef = useRef<AudioPlayerPort | null>(null);
  const toggleAutoPauseRef = useRef(onToggleAutoPause);
  const autoPauseRef = useRef(autoPause);
  const speedRef = useRef(speed);
  const [failedArtworkUrl, setFailedArtworkUrl] = useState<string | null>(null);
  const displayArtwork = artwork && failedArtworkUrl !== artwork.url ? artwork : null;

  useEffect(() => {
    toggleAutoPauseRef.current = onToggleAutoPause;
    autoPauseRef.current = autoPause;
    speedRef.current = speed;
  }, [autoPause, onToggleAutoPause, speed]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const current = () => generationRef.current === generation;
    let cancelled = false;
    let player: PlyrInstance | null = null;
    let playerDestroyed = false;
    let port: AudioPlayerPort | null = null;
    let autoPauseControl: MountedAutoPauseControl | null = null;
    let autoPauseMountTimer: number | null = null;
    let autoPauseMountAttempts = 0;

    const lifecycle: AudioPlayerLifecycle = {
      onReady: () => { if (current()) onStateChange("ready"); },
      onStateChange: (state) => { if (current()) onStateChange(state); },
      onPositionChange: () => { if (current()) onPositionChange(); },
      onError: (message) => { if (current()) onError(message); },
    };
    const attachPort = (nextPort: AudioPlayerPort) => {
      if (!current()) {
        nextPort.destroy();
        return;
      }
      port = nextPort;
      portRef.current = nextPort;
      onPortChange(nextPort);
      onError(null);
    };
    const ready = () => lifecycle.onReady();
    const playing = () => lifecycle.onStateChange("playing");
    const paused = () => { if (!audio.ended) lifecycle.onStateChange("paused"); };
    const ended = () => lifecycle.onStateChange("ended");
    const timeUpdate = () => lifecycle.onPositionChange?.();
    const seeking = () => lifecycle.onPositionChange?.();
    const seeked = () => lifecycle.onPositionChange?.();
    const failed = () => lifecycle.onError("播客音频暂时无法播放，请检查网络后重试。");
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
      if (autoPauseControl) {
        autoPauseControlRef.current = autoPauseControl;
        onAutoPauseControlReady(true);
      } else if (autoPauseMountAttempts < 20) {
        autoPauseMountAttempts += 1;
        autoPauseMountTimer = window.setTimeout(mountAutoPause, 25);
      }
    };

    onAutoPauseControlReady(false);
    disableNativeMediaControls(audio);
    audio.dataset.mediaPlayerState = "loading";
    audio.src = audioUrl;
    audio.dataset.source = audioUrl;
    audio.preload = "metadata";

    if (factory) {
      try {
        audio.dataset.mediaPlayerState = "test-factory";
        const nextPort = factory(audio, { url: audioUrl, lifecycle });
        portRef.current = nextPort;
        attachPort(nextPort);
      } catch (error) {
        audio.dataset.mediaPlayerState = "error";
        if (current()) onError(error instanceof Error ? error.message : "播客播放器初始化失败。");
      }
    } else {
      // HTMLMediaElement events are the source of truth for the HTML5
      // provider. Plyr proxies these events through its container in normal
      // browsers, but listening to the media node as well keeps lifecycle
      // updates reliable for controlled media seams that do not bubble media
      // events through Plyr.
      audio.addEventListener("canplay", ready);
      audio.addEventListener("loadedmetadata", ready);
      audio.addEventListener("play", playing);
      audio.addEventListener("playing", playing);
      audio.addEventListener("pause", paused);
      audio.addEventListener("ended", ended);
      audio.addEventListener("timeupdate", timeUpdate);
      audio.addEventListener("seeking", seeking);
      audio.addEventListener("seeked", seeked);
      audio.addEventListener("error", failed);
      void import("plyr").then((module) => {
        if (cancelled || !current()) return;
        const Plyr = resolvePlyrConstructor(module);
        player = new Plyr(audio, { ...audioPlyrOptions, speed: { ...audioPlyrOptions.speed, selected: speedRef.current } });
        const playerContainer = markPlyrContainer(player, audio, "audio");
        playerContainer.dataset.mediaPlayerState = "ready";
        playerContainer.setAttribute("aria-label", title);
        audio.removeAttribute("aria-label");
        player.on("ready", ready);
        mountAutoPause();
        const plyrInstance = player;
        attachPort({
          play: () => {
            if (!plyrInstance) return;
            void Promise.resolve(plyrInstance.play()).catch(() => lifecycle.onError("浏览器阻止了音频播放，请再次点击播放。"));
          },
          pause: () => {
            // Plyr delegates to the media node, but calling the node as well
            // keeps a controlled HTMLMediaElement implementation in sync when
            // its paused flag has not been updated yet.
            plyrInstance?.pause();
            audio.pause();
          },
          seek: (positionMs) => {
            const seconds = Math.max(0, positionMs) / 1_000;
            // Plyr ignores seeks until metadata exposes a duration. Keep the
            // underlying element in sync so an early sentence click is not lost.
            audio.currentTime = seconds;
            if (plyrInstance) plyrInstance.currentTime = seconds;
          },
          currentTime: () => Math.max(0, Math.round(audio.currentTime * 1_000)),
          setSpeed: (nextSpeed) => {
            applyPlyrSpeed(plyrInstance, nextSpeed);
            // Keep the media node in sync so a speed change is observable
            // before Plyr flushes its deferred playbackRate update.
            audio.playbackRate = nextSpeed;
          },
          destroy: destroyPlayer,
        });
        applyPlyrSpeed(plyrInstance, speedRef.current);
        if (audio.readyState >= 1) ready();
      }).catch(() => {
        audio.dataset.mediaPlayerState = "error";
        if (current()) onError("统一音频播放器加载失败，请重试。");
      });
    }

    return () => {
      cancelled = true;
      if (generationRef.current === generation) generationRef.current += 1;
      if (autoPauseMountTimer !== null) window.clearTimeout(autoPauseMountTimer);
      onAutoPauseControlReady(false);
      autoPauseControl?.destroy();
      if (autoPauseControlRef.current === autoPauseControl) autoPauseControlRef.current = null;
      if (player) {
        player.off("ready", ready);
      }
      audio.removeEventListener("canplay", ready);
      audio.removeEventListener("loadedmetadata", ready);
      audio.removeEventListener("play", playing);
      audio.removeEventListener("playing", playing);
      audio.removeEventListener("pause", paused);
      audio.removeEventListener("ended", ended);
      audio.removeEventListener("timeupdate", timeUpdate);
      audio.removeEventListener("seeking", seeking);
      audio.removeEventListener("seeked", seeked);
      audio.removeEventListener("error", failed);
      portRef.current = null;
      onPortChange(null);
      if (port) port.destroy();
      destroyPlayer();
    };
  }, [audioUrl, factory, hasSegments, onAutoPauseControlReady, onError, onPortChange, onPositionChange, onStateChange, title]);

  useEffect(() => {
    autoPauseControlRef.current?.setAutoPause(autoPause);
  }, [autoPause]);

  useEffect(() => {
    // The workbench owns the selected speed, so re-apply it whenever the
    // adapter remounts, the port is replaced, or the choice changes. Plyr's
    // own settings menu writes to the same value instead of fighting it.
    speedRef.current = speed;
    portRef.current?.setSpeed?.(speed);
  }, [speed, onPortChange]);

  return (
    <div className="audio-player-adapter">
      <div aria-label={displayArtwork?.alt ?? "播客封面"} className="audio-player-adapter__art" role="img">
        {displayArtwork ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={displayArtwork.alt} height={displayArtwork.height ?? 600} onError={() => setFailedArtworkUrl(displayArtwork.url)} src={displayArtwork.url} width={displayArtwork.width ?? 600} />
        ) : <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 13.5v-3a5 5 0 0 1 10 0v3" /><path d="M7 12H5.5A1.5 1.5 0 0 0 4 13.5v3A1.5 1.5 0 0 0 5.5 18H8v-6H7ZM17 12h1.5a1.5 1.5 0 0 1 1.5 1.5V16.5A1.5 1.5 0 0 1 17 18H16v-6h1Z" /></svg>}
      </div>
      <audio aria-label={title} ref={audioRef} src={audioUrl}>当前浏览器无法播放音频。</audio>
    </div>
  );
}
