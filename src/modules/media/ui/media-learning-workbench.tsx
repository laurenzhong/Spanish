"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { findSegmentIndexAt, type MediaPlayback } from "../domain";
import { AudioPlayerAdapter, type AudioPlayerFactory, type AudioPlayerPort, type AudioPlayerState } from "./audio-player-adapter";
import { LexicalDrawer } from "./lexical-drawer";
import { SegmentTranscript, type CaptionMode } from "./segment-transcript";
import { HostedVideoPlayerAdapter, type NativeVideoPlayerFactory, VideoPlayerAdapter, type VideoPlayerFactory, type VideoPlayerPort, type VideoPlayerState } from "./video-player-adapter";

type ProgressSnapshot = Readonly<{ lastPositionMs: number; lastSegmentIndex: number | null; status: "in_progress" | "completed" }>;
type ProgressSyncState = "idle" | "saving" | "saved" | "conflict" | "error";

export function MediaLearningWorkbench({ playback, playerFactory, nativeVideoFactory, audioPlayerFactory, initialPositionMs, initialSegmentIndex }: Readonly<{
  playback: MediaPlayback;
  playerFactory?: VideoPlayerFactory;
  nativeVideoFactory?: NativeVideoPlayerFactory;
  audioPlayerFactory?: AudioPlayerFactory;
  initialPositionMs?: number;
  initialSegmentIndex?: number;
}>) {
  return <MediaLearningWorkbenchSession audioPlayerFactory={audioPlayerFactory} initialPositionMs={initialPositionMs} initialSegmentIndex={initialSegmentIndex} key={`${playback.media.id}:${initialPositionMs ?? "progress"}:${initialSegmentIndex ?? "auto"}`} nativeVideoFactory={nativeVideoFactory} playback={playback} playerFactory={playerFactory} />;
}

function MediaLearningWorkbenchSession({ playback, playerFactory, nativeVideoFactory, audioPlayerFactory, initialPositionMs: requestedPositionMs, initialSegmentIndex: requestedSegmentIndex }: Readonly<{
  playback: MediaPlayback;
  playerFactory?: VideoPlayerFactory;
  nativeVideoFactory?: NativeVideoPlayerFactory;
  audioPlayerFactory?: AudioPlayerFactory;
  initialPositionMs?: number;
  initialSegmentIndex?: number;
}>) {
  const deepLinkedSegment = requestedSegmentIndex !== undefined && playback.segments[requestedSegmentIndex] ? requestedSegmentIndex : null;
  const initialPositionMs = requestedPositionMs !== undefined
    ? Math.min(requestedPositionMs, playback.media.durationMs)
    : deepLinkedSegment !== null ? playback.segments[deepLinkedSegment]!.startMs : playback.media.progress?.lastPositionMs ?? 0;
  const initialActiveIndex = deepLinkedSegment ?? findSegmentIndexAt(playback.segments, initialPositionMs) ?? playback.media.progress?.lastSegmentIndex ?? (playback.segments.length > 0 ? 0 : null);
  const initialRevision = playback.media.progress?.revision ?? 0;
  const [activeIndex, setActiveIndex] = useState<number | null>(initialActiveIndex);
  const [captionMode, setCaptionMode] = useState<CaptionMode>("es");
  const [autoPause, setAutoPause] = useState(false);
  const [embeddedAutoPauseControl, setEmbeddedAutoPauseControl] = useState(false);
  const [followTranscript, setFollowTranscript] = useState(true);
  const [currentPositionMs, setCurrentPositionMs] = useState(initialPositionMs);
  const [playerState, setPlayerState] = useState<VideoPlayerState | "loading">("loading");
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [progressSyncState, setProgressSyncState] = useState<ProgressSyncState>("idle");
  const [progressRecoveryBusy, setProgressRecoveryBusy] = useState(false);
  /** Bumped by the retry control to force a fresh player mount. */
  const [playerMountKey, setPlayerMountKey] = useState(0);
  const [lexicalSelection, setLexicalSelection] = useState<{ word: string; sentence: string } | null>(null);
  const playerRef = useRef<VideoPlayerPort | AudioPlayerPort | null>(null);
  /** Media key whose saved position has already been applied after a mount. */
  const restoredPositionKeyRef = useRef<string | null>(null);
  const lexicalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeIndexRef = useRef<number | null>(initialActiveIndex);
  const playerStateRef = useRef<VideoPlayerState | "loading">("loading");
  const autoPauseRef = useRef(false);
  const segmentPausedRef = useRef(false);
  const progressRevisionRef = useRef(initialRevision);
  const progressGenerationRef = useRef(0);
  const progressBlockedRef = useRef(false);
  const progressAbortRef = useRef<AbortController | null>(null);
  const progressRecoveryAbortRef = useRef<AbortController | null>(null);
  const queuedProgressRef = useRef<ProgressSnapshot | null>(null);
  const lastRequestedPositionRef = useRef(initialPositionMs);
  const sendProgressRef = useRef<(snapshot: ProgressSnapshot) => void>(() => undefined);

  const updateActiveIndex = useCallback((index: number | null) => {
    if (index !== activeIndexRef.current) segmentPausedRef.current = false;
    activeIndexRef.current = index;
    setActiveIndex(index);
  }, []);
  const toggleAutoPause = useCallback((enabled: boolean) => {
    autoPauseRef.current = enabled;
    setAutoPause(enabled);
  }, []);
  const toggleAutoPauseFromPlayer = useCallback(() => {
    toggleAutoPause(!autoPauseRef.current);
  }, [toggleAutoPause]);

  const readCurrentPosition = useCallback(() => {
    const rawPosition = playerRef.current?.currentTime();
    if (rawPosition === undefined || !Number.isFinite(rawPosition)) return null;
    return Math.min(playback.media.durationMs, Math.max(0, Math.round(rawPosition)));
  }, [playback.media.durationMs]);

  const syncPosition = useCallback((updateIndex = true) => {
    const current = readCurrentPosition();
    if (current === null) return null;
    setCurrentPositionMs(current);
    if (updateIndex) updateActiveIndex(findSegmentIndexAt(playback.segments, current));
    return current;
  }, [playback.segments, readCurrentPosition, updateActiveIndex]);

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
    const rawPosition = state === "ended" ? playback.media.durationMs : (readCurrentPosition() ?? 0);
    const lastPositionMs = Math.min(playback.media.durationMs, Math.max(0, Math.round(rawPosition)));
    const lastSegmentIndex = findSegmentIndexAt(playback.segments, lastPositionMs) ?? activeIndexRef.current;
    return { lastPositionMs, lastSegmentIndex, status: state === "ended" ? "completed" : "in_progress" };
  }, [playback.media.durationMs, playback.segments, readCurrentPosition]);

  useEffect(() => {
    return () => {
      progressGenerationRef.current += 1;
      progressAbortRef.current?.abort();
      progressAbortRef.current = null;
      progressRecoveryAbortRef.current?.abort();
      progressRecoveryAbortRef.current = null;
      queuedProgressRef.current = null;
    };
  }, []);

  /**
   * Re-read the server revision after a 409 instead of asking for a full page
   * reload. The server stays authoritative: the stored revision is only
   * adopted when the server is at least as new as the client, and a server
   * revision behind the client leaves the conflict in place rather than
   * letting a stale write win. Nothing is written from here.
   */
  const recoverProgress = useCallback(async () => {
    if (progressRecoveryAbortRef.current) return;
    const controller = new AbortController();
    progressRecoveryAbortRef.current = controller;
    setProgressRecoveryBusy(true);
    try {
      const response = await fetch(`/api/v1/media/${encodeURIComponent(playback.media.stableKey)}/playback`, {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setProgressRecoveryBusy(false);
        return;
      }
      const body = await response.json() as { data?: { media?: { progress?: { revision?: unknown } } } };
      const revision = body.data?.media?.progress?.revision;
      if (controller.signal.aborted) return;
      const revisionIsUsable = Number.isInteger(revision) && Number(revision) >= progressRevisionRef.current;
      if (!revisionIsUsable) {
        // The server still reports an older revision than the one this tab
        // already observed. Keep the conflict visible instead of pretending
        // the read repaired it.
        setProgressRecoveryBusy(false);
        return;
      }
      progressRevisionRef.current = Number(revision);
      progressBlockedRef.current = false;
      setProgressRecoveryBusy(false);
      setProgressSyncState("idle");
    } catch {
      if (controller.signal.aborted) return;
      setProgressRecoveryBusy(false);
    } finally {
      if (progressRecoveryAbortRef.current === controller) progressRecoveryAbortRef.current = null;
    }
  }, [playback.media.stableKey]);

  const retryPlayer = useCallback(() => {
    setPlayerError(null);
    setPlayerState("loading");
    playerStateRef.current = "loading";
    playerRef.current = null;
    setProgressSyncState("idle");
    // A retry mounts a fresh player, so the saved position may be applied again.
    restoredPositionKeyRef.current = null;
    setPlayerMountKey((key) => key + 1);
  }, []);

  const selectSegment = useCallback((index: number) => {
    const segment = playback.segments[index];
    if (!segment || !playerRef.current) return;
    updateActiveIndex(index);
    setCurrentPositionMs(segment.startMs);
    playerRef.current.seek(segment.startMs);
    playerRef.current.play();
  }, [playback.segments, updateActiveIndex]);
  const previous = useCallback(() => { if (playback.segments.length > 0) selectSegment(Math.max(0, (activeIndex ?? 0) - 1)); }, [activeIndex, playback.segments.length, selectSegment]);
  const replay = useCallback(() => { if (playback.segments.length > 0) selectSegment(activeIndex ?? 0); }, [activeIndex, playback.segments.length, selectSegment]);
  const next = useCallback(() => { if (playback.segments.length > 0) selectSegment(Math.min(playback.segments.length - 1, (activeIndex ?? -1) + 1)); }, [activeIndex, playback.segments.length, selectSegment]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // A held key fires keydown over and over. Toggling play/pause on every
      // repeat made the player thrash (and looked like playback freezing), so
      // only the first press counts.
      if (event.repeat) return;
      const target = event.target;
      if (target instanceof Element && target.matches("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      // Sentence navigation lives on the arrow keys, which the owner already uses
      // for it, and Space plays/pauses without focusing the player first. The
      // listener runs in the capture phase and swallows the keys it handles, so
      // Plyr's own bindings never act a second time on the same press.
      const isPlayPause = event.key === " " || event.code === "Space";
      if (event.key === "ArrowLeft") previous();
      else if (event.key === "ArrowRight") next();
      else if (isPlayPause) {
        // Space plays/pauses without having to focus the player first, but only
        // once the player reports it is mounted: calling play() on a player that
        // is still booting is what leaves a black, unresponsive frame. Inputs are
        // excluded above, so typing a space in the lexical drawer still works.
        if (playerStateRef.current !== "loading") {
          if (playerStateRef.current === "playing") playerRef.current?.pause();
          else playerRef.current?.play();
        }
      } else if (key === "a") previous();
      else if (key === "s") replay();
      else if (key === "d") next();
      else if (key === "q") toggleAutoPause(!autoPauseRef.current);
      else return;
      event.preventDefault();
      // Handled keys are swallowed so Plyr's own bindings cannot act twice.
      event.stopPropagation();
    }
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [next, previous, replay, toggleAutoPause]);

  useEffect(() => {
    if (!playerRef.current || playerState === "loading" || playerState === "ended") return;
    const timer = window.setInterval(() => {
      const current = readCurrentPosition();
      if (current === null) return;
      const trackedSegment = playback.segments.find((segment) => segment.index === activeIndexRef.current);
      if (playerState === "playing" && autoPause && trackedSegment && current >= trackedSegment.endMs) {
        setCurrentPositionMs(current);
        updateActiveIndex(findSegmentIndexAt(playback.segments, current));
        sendProgress(progressSnapshot("paused-by-segment"));
        playerRef.current?.pause();
        segmentPausedRef.current = true;
        playerStateRef.current = "paused";
        setPlayerState("paused");
        return;
      }
      segmentPausedRef.current = false;
      setCurrentPositionMs(current);
      updateActiveIndex(findSegmentIndexAt(playback.segments, current));
      if (playerState === "playing" && Math.abs(current - lastRequestedPositionRef.current) >= 10_000) {
        sendProgress(progressSnapshot("playing"));
      }
    }, playerState === "playing" ? 250 : 500);
    return () => window.clearInterval(timer);
  }, [autoPause, playback.segments, playerState, progressSnapshot, readCurrentPosition, sendProgress, updateActiveIndex]);

  const handlePortChange = useCallback((port: VideoPlayerPort | AudioPlayerPort | null) => {
    playerRef.current = port;
    if (port) syncPosition();
  }, [syncPosition]);
  const handlePositionChange = useCallback(() => { syncPosition(!(playerStateRef.current === "playing" && autoPauseRef.current)); }, [syncPosition]);
  const handleStateChange = useCallback((state: VideoPlayerState | AudioPlayerState) => {
    syncPosition(!(state === "playing" && autoPauseRef.current));
    playerStateRef.current = state;
    setPlayerState(state);
    // Apply the saved position exactly once per media mount. Plyr announces
    // `ready` again after a source reload (a seek into an unbuffered range, for
    // example), and re-seeking on every announcement yanked the video backwards
    // over and over — the picture tore while the player still claimed to play.
    if (state === "ready" && initialPositionMs && restoredPositionKeyRef.current !== playback.media.stableKey) {
      restoredPositionKeyRef.current = playback.media.stableKey;
      playerRef.current?.seek(initialPositionMs);
    }
    if (state === "paused" || state === "ended") sendProgress(progressSnapshot(state));
  }, [initialPositionMs, playback.media.stableKey, progressSnapshot, sendProgress, syncPosition]);
  const handlePlayerError = useCallback((message: string | null) => setPlayerError(message), []);
  const openWord = useCallback((word: string, sentence: string, trigger: HTMLButtonElement) => { lexicalTriggerRef.current = trigger; setLexicalSelection({ word, sentence }); }, []);
  const closeWord = useCallback(() => { setLexicalSelection(null); window.setTimeout(() => lexicalTriggerRef.current?.focus(), 0); }, []);

  const activeSegment = activeIndex === null ? null : playback.segments.find((segment) => segment.index === activeIndex) ?? null;

  return <div className="media-learning-workbench" data-media-player-contract="plyr" data-media-player-version="3.8.4">
    <section aria-label={playback.media.kind === "podcast" ? "播客学习器" : "视频学习器"} className="media-learning-workbench__main">
      <div className={`media-detail__player media-detail__player--${playback.media.kind}`}>
        {playback.media.kind === "podcast" && playback.asset.kind === "audio"
          ? <AudioPlayerAdapter key={`audio:${playback.asset.url}:${playerMountKey}`} artwork={playback.media.artwork} audioUrl={playback.asset.url} factory={audioPlayerFactory} onError={handlePlayerError}
              autoPause={autoPause} hasSegments={playback.segments.length > 0} onAutoPauseControlReady={setEmbeddedAutoPauseControl}
              onPortChange={handlePortChange} onPositionChange={handlePositionChange} onStateChange={handleStateChange}
              onToggleAutoPause={toggleAutoPauseFromPlayer} title={`${playback.media.title} 播放器`} />
          : playback.media.kind === "video" && playback.asset.kind === "video"
            ? <HostedVideoPlayerAdapter key={`hosted-video:${playback.asset.url}:${playerMountKey}`} factory={nativeVideoFactory} onError={handlePlayerError} onPortChange={handlePortChange}
                autoPause={autoPause} hasSegments={playback.segments.length > 0} onAutoPauseControlReady={setEmbeddedAutoPauseControl}
                onPositionChange={handlePositionChange} onStateChange={handleStateChange}
                onToggleAutoPause={toggleAutoPauseFromPlayer} title={`${playback.media.title} 播放器`} videoUrl={playback.asset.url} />
          : <VideoPlayerAdapter key={`youtube:${playback.asset.url}:${playerMountKey}`} autoPause={autoPause} embedUrl={playback.asset.url} factory={playerFactory} hasSegments={playback.segments.length > 0} onAutoPauseControlReady={setEmbeddedAutoPauseControl} onError={handlePlayerError}
              onPortChange={handlePortChange} onPositionChange={handlePositionChange} onStateChange={handleStateChange}
              onToggleAutoPause={toggleAutoPauseFromPlayer} title={`${playback.media.title} 播放器`} />}
      </div>
      {/* Sentence navigation lives on the arrow keys and playback speed on Plyr's
          own settings menu, so the only control left here is the boundary
          auto-pause — and only when Plyr has not injected its own. */}
      {!embeddedAutoPauseControl ? <div aria-label="播放设置" className="media-sentence-controls">
        <label><input aria-label="自动暂停" checked={autoPause} disabled={playback.segments.length === 0} onChange={(event) => toggleAutoPause(event.target.checked)} type="checkbox" /><span>自动暂停</span><kbd>Q</kbd></label>
      </div> : null}
      {activeSegment ? <div aria-label="当前片段" className="media-current-segment" role="group">
        <span className="media-current-segment__label">当前片段</span>
        <p lang="es">{activeSegment.sourceText}</p>
        {activeSegment.translation ? <p className="media-current-segment__translation">{activeSegment.translation}</p> : null}
      </div> : null}
      <p className="media-player-status" role={playerError ? "alert" : "status"}>{playerError ?? (playerState === "loading" ? "播放器准备中…" : playerState === "playing" ? "正在播放" : playerState === "ended" ? "播放结束" : "播放器已就绪")}</p>
      {playerError ? <button aria-label="重试播放" className="media-player-retry" onClick={retryPlayer} type="button">重试播放</button> : null}
      {progressSyncState === "conflict" ? <div className="media-progress-status is-error" role="alert">
        <p>进度已在其他页面更新。重新读取服务器进度后即可继续同步，不需要刷新整个页面。</p>
        <button aria-label="重新读取服务器进度" className="media-player-retry" disabled={progressRecoveryBusy} onClick={() => void recoverProgress()} type="button">{progressRecoveryBusy ? "正在读取…" : "重新读取服务器进度"}</button>
      </div>
        : progressSyncState === "error" ? <p className="media-progress-status is-error" role="status">本次进度未能同步，暂停或继续播放时会重试。</p>
          : progressSyncState === "saving" ? <p className="media-progress-status" role="status">正在同步进度…</p>
            : progressSyncState === "saved" ? <p className="media-progress-status" role="status">进度已同步</p> : null}
    </section>
    <section aria-labelledby="media-transcript-title" className="media-learning-workbench__transcript">
      <header><div><h2 id="media-transcript-title">字幕与文本</h2><span>{playback.segments.length} 段</span></div>
        <div aria-label="字幕与跟随" className="caption-mode" role="group">
          <button aria-label="自动滚动到当前句" aria-pressed={followTranscript} onClick={() => setFollowTranscript((follow) => !follow)} type="button">跟随</button>
          {(["es", "bilingual", "hidden"] as const).map((mode) => <button aria-pressed={captionMode === mode} key={mode} onClick={() => setCaptionMode(mode)} type="button">{mode === "es" ? "西语" : mode === "bilingual" ? "双语" : "隐藏"}</button>)}</div></header>
      <SegmentTranscript activeIndex={activeIndex} captionMode={captionMode} currentPositionMs={currentPositionMs} follow={followTranscript} mediaKind={playback.media.kind} onSeek={selectSegment} onWord={openWord} segments={playback.segments} />
    </section>
    {lexicalSelection ? <LexicalDrawer onClose={closeWord} sentence={lexicalSelection.sentence} word={lexicalSelection.word} /> : null}
  </div>;
}
