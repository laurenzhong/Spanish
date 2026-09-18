"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { findSegmentIndexAt, type MediaPlayback } from "../domain";
import { AudioPlayerAdapter, type AudioPlayerFactory, type AudioPlayerPort, type AudioPlayerState } from "./audio-player-adapter";
import { LexicalDrawer } from "./lexical-drawer";
import { SegmentTranscript, type CaptionMode } from "./segment-transcript";
import { HostedVideoPlayerAdapter, VideoPlayerAdapter, type VideoPlayerFactory, type VideoPlayerPort, type VideoPlayerState } from "./video-player-adapter";

type ProgressSnapshot = Readonly<{ lastPositionMs: number; lastSegmentIndex: number | null; status: "in_progress" | "completed" }>;
type ProgressSyncState = "idle" | "saving" | "saved" | "conflict" | "error";

export function MediaLearningWorkbench({ playback, playerFactory, audioPlayerFactory }: Readonly<{
  playback: MediaPlayback;
  playerFactory?: VideoPlayerFactory;
  audioPlayerFactory?: AudioPlayerFactory;
}>) {
  return <MediaLearningWorkbenchSession audioPlayerFactory={audioPlayerFactory} key={playback.media.id} playback={playback} playerFactory={playerFactory} />;
}

function MediaLearningWorkbenchSession({ playback, playerFactory, audioPlayerFactory }: Readonly<{
  playback: MediaPlayback;
  playerFactory?: VideoPlayerFactory;
  audioPlayerFactory?: AudioPlayerFactory;
}>) {
  const initialPositionMs = playback.media.progress?.lastPositionMs ?? 0;
  const initialActiveIndex = findSegmentIndexAt(playback.segments, initialPositionMs);
  const initialRevision = playback.media.progress?.revision ?? 0;
  const [activeIndex, setActiveIndex] = useState<number | null>(initialActiveIndex);
  const [positionMs, setPositionMs] = useState(initialPositionMs);
  const spokenIndex = findSegmentIndexAt(playback.segments, positionMs);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const [playerHeight, setPlayerHeight] = useState<number | null>(null);
  useEffect(() => {
    const player = workbenchRef.current?.querySelector(".media-detail__player");
    if (!player || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setPlayerHeight(player.getBoundingClientRect().height));
    observer.observe(player);
    return () => observer.disconnect();
  }, []);
  const [captionMode, setCaptionMode] = useState<CaptionMode>("es");
  const [autoPause, setAutoPause] = useState(false);
  const [embeddedAutoPauseControl, setEmbeddedAutoPauseControl] = useState(false);
  const [playerState, setPlayerState] = useState<VideoPlayerState | "loading">("loading");
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playerAttempt, setPlayerAttempt] = useState(0);
  const [progressSyncState, setProgressSyncState] = useState<ProgressSyncState>("idle");
  const [lexicalSelection, setLexicalSelection] = useState<{ word: string; sentence: string } | null>(null);
  const currentSegment = activeIndex === null ? null : playback.segments[activeIndex] ?? null;
  const playerRef = useRef<VideoPlayerPort | AudioPlayerPort | null>(null);
  const lexicalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeIndexRef = useRef<number | null>(initialActiveIndex);
  const progressRevisionRef = useRef(initialRevision);
  const progressGenerationRef = useRef(0);
  const progressBlockedRef = useRef(false);
  const progressAbortRef = useRef<AbortController | null>(null);
  const queuedProgressRef = useRef<ProgressSnapshot | null>(null);
  const lastRequestedPositionRef = useRef(initialPositionMs);
  const autoPauseResumeRef = useRef<{ segmentIndex: number; endMs: number } | null>(null);
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

  const progressSnapshot = useCallback((state: VideoPlayerState | AudioPlayerState | "paused-by-segment"): ProgressSnapshot => {
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
    setPositionMs(segment.startMs);
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
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      const key = event.key.toLowerCase();
      if (event.key === "ArrowLeft" || key === "a") previous();
      else if (event.key === "ArrowRight" || key === "d") next();
      else if (key === "s") replay();
      else if (key === "q") setAutoPause((value) => !value);
      else return;
      event.preventDefault();
      event.stopPropagation();
    }
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [next, playback.media.kind, previous, replay]);

  useEffect(() => {
    if (!playerRef.current || playerState !== "playing") return;
    const timer = window.setInterval(() => {
      const current = playerRef.current?.currentTime() ?? 0;
      setPositionMs(current);
      const previousActiveIndex = activeIndexRef.current;
      const found = findSegmentIndexAt(playback.segments, current);
      if (found !== null) updateActiveIndex(found);
      const previousSegment = playback.segments[previousActiveIndex ?? -1];
      const foundSegment = playback.segments[found ?? -1];
      const currentSegment = previousSegment && current === previousSegment.endMs
        ? previousSegment
        : foundSegment ?? previousSegment;
      const resumeBoundary = autoPauseResumeRef.current;
      if (resumeBoundary && current > resumeBoundary.endMs && found !== null) {
        autoPauseResumeRef.current = null;
      }
      const resumingAcrossBoundary = resumeBoundary !== null && (current <= resumeBoundary.endMs || found === null);
      if (autoPause && currentSegment && current >= currentSegment.endMs && !resumingAcrossBoundary) {
        autoPauseResumeRef.current = { segmentIndex: currentSegment.index, endMs: currentSegment.endMs };
        sendProgress(progressSnapshot("paused-by-segment"));
        playerRef.current?.pause();
        setPlayerState("paused");
      } else if (Math.abs(current - lastRequestedPositionRef.current) >= 10_000) {
        sendProgress(progressSnapshot("playing"));
      }
    }, 80);
    return () => window.clearInterval(timer);
  }, [activeIndex, autoPause, playback.media.kind, playback.segments, playerState, progressSnapshot, sendProgress, updateActiveIndex]);

  useEffect(() => {
    if (!autoPause) autoPauseResumeRef.current = null;
  }, [autoPause]);

  const handlePortChange = useCallback((port: VideoPlayerPort | AudioPlayerPort | null) => {
    playerRef.current = port;
  }, []);
  const handleStateChange = useCallback((state: VideoPlayerState | AudioPlayerState) => {
    setPlayerState(state);
    if (state === "ready" && initialPositionMs) playerRef.current?.seek(initialPositionMs);
    if (state === "paused" || state === "ended") sendProgress(progressSnapshot(state));
  }, [initialPositionMs, progressSnapshot, sendProgress]);
  const handleTimeUpdate = useCallback((positionMs: number) => {
    setPositionMs(positionMs);
    const found = findSegmentIndexAt(playback.segments, positionMs);
    if (found !== null) updateActiveIndex(found);
  }, [playback.segments, updateActiveIndex]);
  const handlePlayerError = useCallback((message: string | null) => setPlayerError(message), []);
  const retryPlayer = useCallback(() => {
    setPlayerError(null);
    setPlayerState("loading");
    setPlayerAttempt((attempt) => attempt + 1);
  }, []);
  const openWord = useCallback((word: string, sentence: string, trigger: HTMLButtonElement) => { lexicalTriggerRef.current = trigger; setLexicalSelection({ word, sentence }); }, []);
  const closeWord = useCallback(() => { setLexicalSelection(null); window.setTimeout(() => lexicalTriggerRef.current?.focus(), 0); }, []);

  return <div ref={workbenchRef} style={playerHeight ? { "--media-player-height": `${playerHeight}px` } as CSSProperties : undefined} className={`media-learning-workbench media-learning-workbench--${playback.media.kind}`}>
    <section aria-label={playback.media.kind === "podcast" ? "播客学习器" : "视频学习器"} className="media-learning-workbench__main">
      <div className={`media-detail__player media-detail__player--${playback.media.kind}`}>
        {playback.media.kind === "podcast" && playback.asset.kind === "audio"
          ? <AudioPlayerAdapter key={`audio-${playerAttempt}`} artwork={playback.media.artwork} audioUrl={playback.asset.url} factory={audioPlayerFactory} onError={handlePlayerError}
              autoPause={autoPause} hasSegments={playback.segments.length > 0} onAutoPauseControlReady={setEmbeddedAutoPauseControl}
              onPortChange={handlePortChange} onStateChange={handleStateChange} onTimeUpdate={handleTimeUpdate}
              onToggleAutoPause={() => setAutoPause((value) => !value)} title={`${playback.media.title} 播放器`} />
          : playback.asset.kind === "video"
            ? <HostedVideoPlayerAdapter key={`hosted-video-${playerAttempt}`} onError={handlePlayerError} onPortChange={handlePortChange}
                autoPause={autoPause} hasSegments={playback.segments.length > 0} onAutoPauseControlReady={setEmbeddedAutoPauseControl}
                onStateChange={handleStateChange} onTimeUpdate={handleTimeUpdate} title={`${playback.media.title} 播放器`} videoUrl={playback.asset.url}
                onToggleAutoPause={() => setAutoPause((value) => !value)} />
          : <VideoPlayerAdapter key={`video-${playerAttempt}`} embedUrl={playback.asset.url} factory={playerFactory} onError={handlePlayerError}
              autoPause={autoPause} hasSegments={playback.segments.length > 0} onAutoPauseControlReady={setEmbeddedAutoPauseControl}
              onPortChange={handlePortChange} onStateChange={handleStateChange} title={`${playback.media.title} 播放器`}
              onToggleAutoPause={() => setAutoPause((value) => !value)} />}
      </div>
      {playback.media.kind === "podcast" && !embeddedAutoPauseControl ? <div aria-label="逐句播放控制" className="media-sentence-controls" role="group">
        <label><input aria-label="自动暂停" checked={autoPause} disabled={playback.segments.length === 0} onChange={(event) => setAutoPause(event.target.checked)} type="checkbox" /><span>自动暂停</span><kbd>Q</kbd></label>
      </div> : null}
      <div aria-label="当前片段" className="media-current-segment" role="group">
        <span className="media-current-segment__label">当前片段</span>
        {captionMode === "hidden" ? <p>字幕已隐藏</p> : currentSegment ? <p lang="es">{currentSegment.sourceText}</p> : <p>暂无当前片段</p>}
      </div>
      <p className="media-player-status" role={playerError ? "alert" : "status"}>{playerError ?? (playerState === "loading" ? "播放器准备中…" : playerState === "playing" ? "正在播放" : playerState === "ended" ? "播放结束" : "播放器已就绪")}</p>
      {playerError ? <button className="media-player-retry" onClick={retryPlayer} type="button">重试播放</button> : null}
      {progressSyncState === "conflict" ? <p className="media-progress-status is-error" role="alert">进度已在其他页面更新，请刷新后继续。</p>
        : progressSyncState === "error" ? <p className="media-progress-status is-error" role="status">本次进度未能同步，暂停或继续播放时会重试。</p>
          : progressSyncState === "saving" ? <p className="media-progress-status" role="status">正在同步进度…</p>
            : progressSyncState === "saved" ? <p className="media-progress-status" role="status">进度已同步</p> : null}
    </section>
    <section aria-labelledby="media-transcript-title" className="media-learning-workbench__transcript">
      <header><div><h2 id="media-transcript-title">字幕与文本</h2><span>{playback.segments.length} 段</span></div>
        {playback.segments.length > 0 ? <div aria-label="字幕模式" className="caption-mode" role="group">{(["es", "bilingual", "hidden"] as const).map((mode) => <button aria-pressed={captionMode === mode} key={mode} onClick={() => setCaptionMode(mode)} type="button">{mode === "es" ? "西语" : mode === "bilingual" ? "双语" : "隐藏"}</button>)}</div>
          : <span className="caption-mode__unavailable">暂无已审核字幕</span>}</header>
      <SegmentTranscript positionMs={positionMs} activeIndex={spokenIndex} captionMode={captionMode} mediaKind={playback.media.kind} onSeek={selectSegment} onWord={openWord} segments={playback.segments} />
    </section>
    {lexicalSelection ? <LexicalDrawer onClose={closeWord} sentence={lexicalSelection.sentence} word={lexicalSelection.word} /> : null}
  </div>;
}
