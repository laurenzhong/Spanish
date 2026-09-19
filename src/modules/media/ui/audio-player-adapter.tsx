"use client";

import { useEffect, useRef, useState } from "react";
import H5AudioPlayer, { RHAP_UI } from "react-h5-audio-player";

import type { MediaArtwork } from "../domain";

export type AudioPlayerState = "ready" | "playing" | "paused" | "ended";
export type AudioPlayerLifecycle = Readonly<{ onReady: () => void; onStateChange: (state: AudioPlayerState) => void; onTimeUpdate: (positionMs: number) => void; onError: (message: string) => void }>;
export interface AudioPlayerPort { play(): void; pause(): void; seek(positionMs: number): void; currentTime(): number; destroy(): void }
export type AudioPlayerFactory = (element: HTMLAudioElement, input: Readonly<{ url: string; lifecycle: AudioPlayerLifecycle }>) => AudioPlayerPort;

export const nativeAudioPlayerFactory: AudioPlayerFactory = (element, input) => {
  const onReady = () => input.lifecycle.onReady();
  const onPlay = () => input.lifecycle.onStateChange("playing");
  const onPause = () => { if (!element.ended) input.lifecycle.onStateChange("paused"); };
  const onEnded = () => input.lifecycle.onStateChange("ended");
  const onTimeUpdate = () => input.lifecycle.onTimeUpdate(Math.max(0, Math.round(element.currentTime * 1_000)));
  const onError = () => input.lifecycle.onError("播客音频暂时无法播放，请检查网络后重试。");
  element.addEventListener("canplay", onReady); element.addEventListener("play", onPlay); element.addEventListener("pause", onPause); element.addEventListener("ended", onEnded); element.addEventListener("timeupdate", onTimeUpdate); element.addEventListener("error", onError);
  element.src = input.url; element.preload = "metadata"; element.load();
  return { play: () => { void element.play().catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) input.lifecycle.onError("浏览器阻止了音频播放，请再次点击播放。"); }); }, pause: () => element.pause(), seek: (positionMs) => { element.currentTime = Math.max(0, positionMs) / 1_000; }, currentTime: () => Math.max(0, Math.round(element.currentTime * 1_000)), destroy: () => { element.removeEventListener("canplay", onReady); element.removeEventListener("play", onPlay); element.removeEventListener("pause", onPause); element.removeEventListener("ended", onEnded); element.removeEventListener("timeupdate", onTimeUpdate); element.removeEventListener("error", onError); element.pause(); element.removeAttribute("src"); element.load(); } };
};

type AudioPlayerProps = Readonly<{ audioUrl: string; artwork?: MediaArtwork | null; title: string; factory?: AudioPlayerFactory; autoPause: boolean; hasSegments: boolean; onToggleAutoPause: () => void; onAutoPauseControlReady: (ready: boolean) => void; onPortChange: (port: AudioPlayerPort | null) => void; onStateChange: (state: AudioPlayerState) => void; onTimeUpdate: (positionMs: number) => void; onError: (message: string | null) => void }>;
const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4] as const;
const playbackError = "播客音频暂时无法播放，请检查网络后重试。";
const blockedPlaybackError = "浏览器阻止了音频播放，请再次点击播放。";

function PodcastAudioPlayer({ audioUrl, title, autoPause, hasSegments, onToggleAutoPause, onAutoPauseControlReady, onPortChange, onStateChange, onTimeUpdate, onError }: Omit<AudioPlayerProps, "artwork" | "factory">) {
  const playerRef = useRef<H5AudioPlayer>(null);
  const callbacksRef = useRef({ onAutoPauseControlReady, onPortChange, onStateChange, onTimeUpdate, onError });
  const [playbackRate, setPlaybackRate] = useState(1);
  useEffect(() => { callbacksRef.current = { onAutoPauseControlReady, onPortChange, onStateChange, onTimeUpdate, onError }; }, [onAutoPauseControlReady, onError, onPortChange, onStateChange, onTimeUpdate]);
  useEffect(() => {
    const audio = playerRef.current?.audio.current;
    if (!audio) return;
    let active = true;
    audio.setAttribute("aria-label", title);
    const port: AudioPlayerPort = { play: () => { void audio.play().catch((error: unknown) => { if (!active || (error instanceof DOMException && error.name === "AbortError")) return; callbacksRef.current.onError(error instanceof DOMException && error.name === "NotAllowedError" ? blockedPlaybackError : playbackError); }); }, pause: () => audio.pause(), seek: (positionMs) => { audio.currentTime = Math.max(0, positionMs) / 1_000; }, currentTime: () => Math.max(0, Math.round(audio.currentTime * 1_000)), destroy: () => { if (!audio.paused) audio.pause(); } };
    callbacksRef.current.onPortChange(port); callbacksRef.current.onAutoPauseControlReady(true); callbacksRef.current.onError(null);
    return () => { active = false; callbacksRef.current.onAutoPauseControlReady(false); callbacksRef.current.onPortChange(null); port.destroy(); };
  }, [audioUrl, title]);
  const audio = () => playerRef.current?.audio.current;
  const autoPauseLabel = !hasSegments ? "暂无已审核分句，无法自动暂停" : autoPause ? "关闭自动暂停" : "开启自动暂停";
  return <H5AudioPlayer autoPlayAfterSrcChange={false} className="podcast-audio-player" customAdditionalControls={[]} customControlsSection={[RHAP_UI.CURRENT_TIME, RHAP_UI.MAIN_CONTROLS, RHAP_UI.DURATION, <label className="podcast-audio-player__speed" key="speed"><select aria-label="播放速度" onChange={(event) => { const rate = Number(event.target.value); const element = audio(); if (element) element.playbackRate = rate; setPlaybackRate(rate); }} value={playbackRate}>{playbackRates.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</select></label>, <button aria-label={autoPauseLabel} aria-pressed={autoPause} className="podcast-audio-player__auto-pause" data-media-auto-pause-control="" disabled={!hasSegments} key="auto-pause" onClick={(event) => { event.stopPropagation(); onToggleAutoPause(); }} title={autoPauseLabel} type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5h3v14H5zm5 0h3v14h-3z" /><circle cx="17.5" cy="16.5" fill="none" r="4" stroke="currentColor" strokeWidth="1.7" /><path d="M17.5 14.2v2.5l1.7 1" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" /></svg></button>, RHAP_UI.VOLUME_CONTROLS]} customProgressBarSection={[RHAP_UI.PROGRESS_BAR]} hasDefaultKeyBindings={false} i18nAriaLabels={{ player: `${title} 控制`, progressControl: "播放进度", volumeControl: "音量", play: "播放", pause: "暂停", rewind: "后退", forward: "前进", previous: "上一段", next: "下一段", loop: "开启循环", loopOff: "关闭循环", volume: "静音", volumeMute: "取消静音" }} layout="stacked" listenInterval={80} onEnded={() => callbacksRef.current.onStateChange("ended")} onError={() => callbacksRef.current.onError(playbackError)} onListen={() => { const element = audio(); if (element) callbacksRef.current.onTimeUpdate(Math.max(0, Math.round(element.currentTime * 1_000))); }} onPause={() => { const element = audio(); if (element && !element.ended) callbacksRef.current.onStateChange("paused"); }} onLoadedMetaData={() => callbacksRef.current.onStateChange("ready")} onPlay={() => callbacksRef.current.onStateChange("playing")} onPlayError={() => callbacksRef.current.onError(blockedPlaybackError)} onPlaying={() => callbacksRef.current.onStateChange("playing")} preload="metadata" ref={playerRef} showJumpControls={false} src={audioUrl}>当前浏览器无法播放音频。</H5AudioPlayer>;
}

export function AudioPlayerAdapter({ audioUrl, artwork, title, factory, autoPause, hasSegments, onToggleAutoPause, onAutoPauseControlReady, onPortChange, onStateChange, onTimeUpdate, onError }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null); const generationRef = useRef(0); const [failedArtworkUrl, setFailedArtworkUrl] = useState<string | null>(null); const displayArtwork = artwork && failedArtworkUrl !== artwork.url ? artwork : null;
  useEffect(() => { if (!factory) return; const audio = audioRef.current; if (!audio) return; const generation = ++generationRef.current; const current = () => generationRef.current === generation; let port: AudioPlayerPort | null = null; const lifecycle: AudioPlayerLifecycle = { onReady: () => { if (current()) onStateChange("ready"); }, onStateChange: (state) => { if (current()) onStateChange(state); }, onTimeUpdate: (positionMs) => { if (current()) onTimeUpdate(positionMs); }, onError: (message) => { if (current()) onError(message); } }; try { port = factory(audio, { url: audioUrl, lifecycle }); onPortChange(port); onAutoPauseControlReady(false); onError(null); } catch (error) { onError(error instanceof Error ? error.message : "播客播放器初始化失败。"); } return () => { if (generationRef.current === generation) generationRef.current += 1; onPortChange(null); port?.destroy(); }; }, [audioUrl, factory, onAutoPauseControlReady, onError, onPortChange, onStateChange, onTimeUpdate]);
  return <div className="audio-player-adapter"><div aria-label={displayArtwork?.alt ?? "播客封面"} className="audio-player-adapter__art" role="img">{displayArtwork ? <img alt={displayArtwork.alt} height={displayArtwork.height ?? 600} onError={() => setFailedArtworkUrl(displayArtwork.url)} src={displayArtwork.url} width={displayArtwork.width ?? 600} /> : <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 13.5v-3a5 5 0 0 1 10 0v3" /><path d="M7 12H5.5A1.5 1.5 0 0 0 4 13.5v3A1.5 1.5 0 0 0 5.5 18H8v-6H7ZM17 12h1.5a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 17 18H16v-6h1Z" /></svg>}</div>{factory ? <audio aria-label={title} controls ref={audioRef} src={audioUrl}>当前浏览器无法播放音频。</audio> : <PodcastAudioPlayer audioUrl={audioUrl} autoPause={autoPause} hasSegments={hasSegments} onAutoPauseControlReady={onAutoPauseControlReady} onError={onError} onPortChange={onPortChange} onStateChange={onStateChange} onTimeUpdate={onTimeUpdate} onToggleAutoPause={onToggleAutoPause} title={title} />}</div>;
}
