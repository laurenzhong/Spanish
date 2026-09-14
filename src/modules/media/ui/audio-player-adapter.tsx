"use client";

import { useEffect, useRef, useState } from "react";

import type { MediaArtwork } from "../domain";

export type AudioPlayerState = "ready" | "playing" | "paused" | "ended";
export type AudioPlayerLifecycle = Readonly<{
  onReady: () => void;
  onStateChange: (state: AudioPlayerState) => void;
  onError: (message: string) => void;
}>;
export interface AudioPlayerPort {
  play(): void;
  pause(): void;
  seek(positionMs: number): void;
  currentTime(): number;
  destroy(): void;
}
export type AudioPlayerFactory = (
  element: HTMLAudioElement,
  input: Readonly<{ url: string; lifecycle: AudioPlayerLifecycle }>,
) => AudioPlayerPort;

export const nativeAudioPlayerFactory: AudioPlayerFactory = (element, input) => {
  const onReady = () => input.lifecycle.onReady();
  const onPlay = () => input.lifecycle.onStateChange("playing");
  const onPause = () => {
    if (!element.ended) input.lifecycle.onStateChange("paused");
  };
  const onEnded = () => input.lifecycle.onStateChange("ended");
  const onError = () => input.lifecycle.onError("播客音频暂时无法播放，请检查网络后重试。");
  element.addEventListener("canplay", onReady);
  element.addEventListener("play", onPlay);
  element.addEventListener("pause", onPause);
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
      element.removeEventListener("ended", onEnded);
      element.removeEventListener("error", onError);
      element.pause();
      element.removeAttribute("src");
      element.load();
    },
  };
};

export function AudioPlayerAdapter({
  audioUrl,
  artwork,
  title,
  factory,
  onPortChange,
  onStateChange,
  onError,
}: Readonly<{
  audioUrl: string;
  artwork?: MediaArtwork | null;
  title: string;
  factory?: AudioPlayerFactory;
  onPortChange: (port: AudioPlayerPort | null) => void;
  onStateChange: (state: AudioPlayerState) => void;
  onError: (message: string | null) => void;
}>) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const generationRef = useRef(0);
  const [failedArtworkUrl, setFailedArtworkUrl] = useState<string | null>(null);
  const displayArtwork = artwork && failedArtworkUrl !== artwork.url ? artwork : null;

  useEffect(() => {
    if (!audioRef.current) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const current = () => generationRef.current === generation;
    let port: AudioPlayerPort;
    try {
      port = (factory ?? nativeAudioPlayerFactory)(audioRef.current, {
        url: audioUrl,
        lifecycle: {
          onReady: () => { if (current()) onStateChange("ready"); },
          onStateChange: (state) => { if (current()) onStateChange(state); },
          onError: (message) => { if (current()) onError(message); },
        },
      });
      onPortChange(port);
      onError(null);
    } catch (error) {
      if (current()) onError(error instanceof Error ? error.message : "播客播放器初始化失败。");
      return;
    }
    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
      onPortChange(null);
      port.destroy();
    };
  }, [audioUrl, factory, onError, onPortChange, onStateChange]);

  return (
    <div className="audio-player-adapter">
      <div aria-label={displayArtwork?.alt ?? "播客封面"} className="audio-player-adapter__art" role="img">
        {displayArtwork ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={displayArtwork.alt} height={displayArtwork.height ?? 600} onError={() => setFailedArtworkUrl(displayArtwork.url)} src={displayArtwork.url} width={displayArtwork.width ?? 600} />
        ) : <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 13.5v-3a5 5 0 0 1 10 0v3" /><path d="M7 12H5.5A1.5 1.5 0 0 0 4 13.5v3A1.5 1.5 0 0 0 5.5 18H8v-6H7ZM17 12h1.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5H16v-6h1Z" /></svg>}
      </div>
      <audio aria-label={title} controls ref={audioRef}>当前浏览器无法播放音频。</audio>
    </div>
  );
}
