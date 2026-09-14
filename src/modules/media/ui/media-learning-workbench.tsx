"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { findSegmentIndexAt, type MediaPlayback } from "../domain";
import { LexicalDrawer } from "./lexical-drawer";
import { SegmentTranscript, type CaptionMode } from "./segment-transcript";
import { VideoPlayerAdapter, type VideoPlayerFactory, type VideoPlayerPort, type VideoPlayerState } from "./video-player-adapter";

type ProgressSnapshot = Readonly<{ lastPositionMs: number; lastSegmentIndex: number | null; status: "in_progress" | "completed" }>;
type ProgressSyncState = "idle" | "saving" | "saved" | "conflict" | "error";

export function MediaLearningWorkbench({ playback, playerFactory }: Readonly<{ playback: MediaPlayback; playerFactory?: VideoPlayerFactory }>) {
  return <MediaLearningWorkbenchSession key={playback.media.id} playback={playback} playerFactory={playerFactory} />;
}

function MediaLearningWorkbenchSession({ playback, playerFactory }: Readonly<{ playback: MediaPlayback; playerFactory?: VideoPlayerFactory }>) {
  const initialActiveIndex = playback.media.progress?.lastSegmentIndex ?? (playback.segments.length > 0 ? 0 : null);
  const initialPositionMs = playback.media.progress?.lastPositionMs ?? 0;
  const initialRevision = playback.media.progress?.revision ?? 0;
  const [activeIndex, setActiveIndex] = useState<number | null>(initialActiveIndex);
  const [captionMode, setCaptionMode] = useState<CaptionMode>("es");
  const [autoPause, setAutoPause] = useState(false);
  const [playerState, setPlayerState] = useState<VideoPlayerState | "loading">("loading");
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [progressSyncState, setProgressSyncState] = useState<ProgressSyncState>("idle");
  const [lexicalSelection, setLexicalSelection] = useState<{ word: string; sentence: string } | null>(null);
  const playerRef = useRef<VideoPlayerPort | null>(null);
  const lexicalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeIndexRef = useRef<number | null>(initialActiveIndex);
  const progressRevisionRef = useRef(initialRevision);
  const progressGenerationRef = useRef(0);
  const progressBlockedRef = useRef(false);
  const progressAbortRef = useRef<AbortController | null>(null);
  const queuedProgressRef = useRef<ProgressSnapshot | null>(null);
  const lastRequestedPositionRef = useRef(initialPositionMs);
  const sendProgressRef = useRef<(snapshot: ProgressSnapshot) => void>(() => undefined);

  const updateActiveIndex = useCallback((index: number | null) => {
    activeIndexRef.current = index;
    setActiveIndex(index);
  }, []);

  const sendProgress = useCallback((snapshot: ProgressSnapshot) => {
    if (progressBlockedRef.current) return;
    if (progressAbortRef.current) {
      queuedProgressRef.current = snapshot;
      return;
    }
    const generation = progressGenerationRef.current;
    const controller = new AbortController();
    progressAbortRef.current = controller;
    lastRequestedPositionRef.current = snapshot.lastPositionMs;
    setProgressSyncState("saving");
    void fetch(`/api/v1/media/${encodeURIComponent(playback.media.stableKey)}/progress`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: playback.media.version,
        expectedRevision: progressRevisionRef.current,
        ...snapshot,
      }),
      signal: controller.signal,
    }).then(async (response) => {
      if (controller.signal.aborted || progressGenerationRef.current !== generation) return;
      if (response.status === 409) {
        progressBlockedRef.current = true;
        queuedProgressRef.current = null;
        setProgressSyncState("conflict");
        return;
      }
      if (!response.ok) {
        setProgressSyncState("error");
        return;
      }
      const body = await response.json() as { data?: { progress?: { revision?: unknown } } };
      const revision = body.data?.progress?.revision;
      if (!Number.isInteger(revision) || (revision as number) < 0) {
        setProgressSyncState("error");
        return;
      }
      progressRevisionRef.current = revision as number;
      setProgressSyncState("saved");
    }).catch((error: unknown) => {
      if (controller.signal.aborted || progressGenerationRef.current !== generation) return;
      if (!(error instanceof DOMException && error.name === "AbortError")) setProgressSyncState("error");
    }).finally(() => {
      if (progressAbortRef.current !== controller) return;
      progressAbortRef.current = null;
      if (progressGenerationRef.current !== generation) return;
      const queued = queuedProgressRef.current;
      queuedProgressRef.current = null;
      if (queued) sendProgressRef.current(queued);
    });
  }, [playback.media.stableKey, playback.media.version]);

  useEffect(() => {
    sendProgressRef.current = sendProgress;
  }, [sendProgress]);

  const progressSnapshot = useCallback((state: VideoPlayerState | "paused-by-segment"): ProgressSnapshot => {
    const rawPosition = state === "ended" ? playback.media.durationMs : (playerRef.current?.currentTime() ?? 0);
    const lastPositionMs = Math.min(playback.media.durationMs, Math.max(0, Math.round(rawPosition)));
    const lastSegmentIndex = findSegmentIndexAt(playback.segments, lastPositionMs) ?? activeIndexRef.current;
    return { lastPositionMs, lastSegmentIndex, status: state === "ended" ? "completed" : "in_progress" };
  }, [playback.media.durationMs, playback.segments]);

  useEffect(() => {
    return () => {
      progressGenerationRef.current += 1;
      progressAbortRef.current?.abort();
      progressAbortRef.current = null;
      queuedProgressRef.current = null;
    };
  }, []);

  const selectSegment = useCallback((index: number) => {
    const segment = playback.segments[index];
    if (!segment || !playerRef.current) return;
    updateActiveIndex(index);
    playerRef.current.seek(segment.startMs);
    playerRef.current.play();
  }, [playback.segments, updateActiveIndex]);
  const previous = useCallback(() => { if (playback.segments.length > 0) selectSegment(Math.max(0, (activeIndex ?? 0) - 1)); }, [activeIndex, playback.segments.length, selectSegment]);
  const replay = useCallback(() => { if (playback.segments.length > 0) selectSegment(activeIndex ?? 0); }, [activeIndex, playback.segments.length, selectSegment]);
  const next = useCallback(() => { if (playback.segments.length > 0) selectSegment(Math.min(playback.segments.length - 1, (activeIndex ?? -1) + 1)); }, [activeIndex, playback.segments.length, selectSegment]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof Element && target.matches("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (key === "a") previous(); else if (key === "s") replay(); else if (key === "d") next(); else if (key === "q") setAutoPause((value) => !value); else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [next, previous, replay]);

  useEffect(() => {
    if (!playerRef.current || playerState !== "playing") return;
    const timer = window.setInterval(() => {
      const current = playerRef.current?.currentTime() ?? 0;
      const found = findSegmentIndexAt(playback.segments, current);
      if (found !== null) updateActiveIndex(found);
      const currentSegment = playback.segments[activeIndex ?? found ?? -1];
      if (autoPause && currentSegment && current >= currentSegment.endMs) {
        sendProgress(progressSnapshot("paused-by-segment"));
        playerRef.current?.pause();
        setPlayerState("paused");
      } else if (Math.abs(current - lastRequestedPositionRef.current) >= 10_000) {
        sendProgress(progressSnapshot("playing"));
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [activeIndex, autoPause, playback.segments, playerState, progressSnapshot, sendProgress, updateActiveIndex]);

  const handlePortChange = useCallback((port: VideoPlayerPort | null) => {
    playerRef.current = port;
  }, []);
  const handleStateChange = useCallback((state: VideoPlayerState) => {
    setPlayerState(state);
    if (state === "ready" && initialPositionMs) playerRef.current?.seek(initialPositionMs);
    if (state === "paused" || state === "ended") sendProgress(progressSnapshot(state));
  }, [initialPositionMs, progressSnapshot, sendProgress]);
  const handlePlayerError = useCallback((message: string | null) => setPlayerError(message), []);
  const openWord = useCallback((word: string, sentence: string, trigger: HTMLButtonElement) => { lexicalTriggerRef.current = trigger; setLexicalSelection({ word, sentence }); }, []);
  const closeWord = useCallback(() => { setLexicalSelection(null); window.setTimeout(() => lexicalTriggerRef.current?.focus(), 0); }, []);

  return <div className="media-learning-workbench">
    <section aria-label="视频学习器" className="media-learning-workbench__main">
      <div className="media-detail__player"><VideoPlayerAdapter embedUrl={playback.asset.url} factory={playerFactory} onError={handlePlayerError}
        onPortChange={handlePortChange} onStateChange={handleStateChange} title={`${playback.media.title} 播放器`} /></div>
      <div aria-label="逐句播放控制" className="media-sentence-controls">
        <button aria-label="上一句" disabled={playback.segments.length === 0} onClick={previous} type="button"><kbd>A</kbd><span>上一句</span></button>
        <button aria-label="重播当前句" disabled={playback.segments.length === 0} onClick={replay} type="button"><kbd>S</kbd><span>重播当前句</span></button>
        <button aria-label="下一句" disabled={playback.segments.length === 0} onClick={next} type="button"><kbd>D</kbd><span>下一句</span></button>
        <label><input aria-label="自动暂停" checked={autoPause} onChange={(event) => setAutoPause(event.target.checked)} type="checkbox" /><span>自动暂停</span><kbd>Q</kbd></label>
      </div>
      <p className="media-player-status" role={playerError ? "alert" : "status"}>{playerError ?? (playerState === "loading" ? "播放器准备中…" : playerState === "playing" ? "正在播放" : playerState === "ended" ? "播放结束" : "播放器已就绪")}</p>
      {progressSyncState === "conflict" ? <p className="media-progress-status is-error" role="alert">进度已在其他页面更新，请刷新后继续。</p>
        : progressSyncState === "error" ? <p className="media-progress-status is-error" role="status">本次进度未能同步，暂停或继续播放时会重试。</p>
          : progressSyncState === "saving" ? <p className="media-progress-status" role="status">正在同步进度…</p>
            : progressSyncState === "saved" ? <p className="media-progress-status" role="status">进度已同步</p> : null}
    </section>
    <section aria-labelledby="media-transcript-title" className="media-learning-workbench__transcript">
      <header><div><h2 id="media-transcript-title">字幕与文本</h2><span>{playback.segments.length} 段</span></div>
        <div aria-label="字幕模式" className="caption-mode">{(["es", "bilingual", "hidden"] as const).map((mode) => <button aria-pressed={captionMode === mode} key={mode} onClick={() => setCaptionMode(mode)} type="button">{mode === "es" ? "西语" : mode === "bilingual" ? "双语" : "隐藏"}</button>)}</div></header>
      <SegmentTranscript activeIndex={activeIndex} captionMode={captionMode} onSeek={selectSegment} onWord={openWord} segments={playback.segments} />
    </section>
    {lexicalSelection ? <LexicalDrawer onClose={closeWord} sentence={lexicalSelection.sentence} word={lexicalSelection.word} /> : null}
  </div>;
}
