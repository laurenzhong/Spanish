"use client";

import type { MediaPlayback } from "../domain";
import { activeWordAt, mediaWordMatches, projectSpeakerLabel, wordTimingsForPlayback } from "../domain";
import { memo, startTransition, useEffect, useRef, useState, type RefObject } from "react";

export type CaptionMode = "es" | "bilingual" | "hidden";
/**
 * How much of the subtitle experience is available right now. The detail page
 * loads text first and word timings second, so `text_ready` is a real state:
 * readable text, highlighting still pending (or failed and retryable).
 */
export type TranscriptRenderState = "loading" | "text_ready" | "ready" | "error";
export type TranscriptWordsState = "loading" | "ready" | "unavailable";
const timeLabel = (milliseconds: number) => { const seconds = Math.floor(milliseconds / 1_000); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; };

type TranscriptToken = Readonly<{ text: string; startOffset: number; endOffset: number; isWord: boolean }>;
type TranscriptSegment = MediaPlayback["segments"][number];
type ActiveWord = ReturnType<typeof activeWordAt>;
const TRANSCRIPT_MOUNT_BATCH = 32;

/**
 * Render exactly the same lexical boundaries that `validWordTimings` accepts.
 * Keeping these offsets shared prevents numbers, mixed tokens, and clock-like
 * forms from silently losing their automatic speaking highlight.
 */
function transcriptTokens(text: string): readonly TranscriptToken[] {
  const matches = mediaWordMatches(text);
  const tokens: TranscriptToken[] = [];
  let cursor = 0;
  for (const match of matches) {
    const startOffset = match.index ?? 0;
    if (startOffset > cursor) tokens.push({ text: text.slice(cursor, startOffset), startOffset: cursor, endOffset: startOffset, isWord: false });
    const word = match[0];
    const endOffset = startOffset + word.length;
    tokens.push({ text: word, startOffset, endOffset, isWord: true });
    cursor = endOffset;
  }
  if (cursor < text.length) tokens.push({ text: text.slice(cursor), startOffset: cursor, endOffset: text.length, isWord: false });
  return tokens.length > 0 ? tokens : [{ text, startOffset: 0, endOffset: text.length, isWord: false }];
}

/**
 * One transcript line. Memoised because the workbench publishes the playback
 * position about four times per second: without this, every line re-tokenised its
 * sentence on every tick, which cost the main thread tens of milliseconds each
 * time and made video playback stutter. Only the active line re-renders now.
 */
const TranscriptRow = memo(function TranscriptRow({ segment, isActiveSegment, activeWord, captionMode, activeRef, onSeek, onWord }: Readonly<{
  segment: TranscriptSegment;
  isActiveSegment: boolean;
  activeWord: ActiveWord;
  captionMode: CaptionMode;
  activeRef: RefObject<HTMLLIElement | null>;
  onSeek: (index: number) => void;
  onWord: (word: string, sentence: string, trigger: HTMLButtonElement) => void;
}>) {
  const sourceTokens = transcriptTokens(segment.sourceText);
  // Diarization indexes from imported subtitles are not names; see projectSpeakerLabel.
  const speakerLabel = projectSpeakerLabel(segment.speaker);
  return <li id={`segment-${segment.index}`} className={isActiveSegment ? "is-active" : undefined} ref={isActiveSegment ? activeRef : undefined}>
    <button aria-label={`跳到 ${timeLabel(segment.startMs)}`} className="segment-transcript__time" onClick={() => onSeek(segment.index)} type="button">{timeLabel(segment.startMs)}</button>
    <div>{speakerLabel ? <strong>{speakerLabel}</strong> : null}<p lang="es">{sourceTokens.map((token, index) => {
      const { text, startOffset, endOffset } = token;
      const isCurrentWord = Boolean(activeWord && activeWord.startOffset === startOffset && activeWord.endOffset === endOffset);
      return token.isWord
        ? <button aria-current={isCurrentWord ? "step" : undefined} aria-label={`查看词语 ${text}`} className={`segment-transcript__word${isCurrentWord ? " is-speaking" : ""}`} data-active-word={isCurrentWord ? "true" : undefined} key={`${segment.id}-${index}`} onClick={(event) => onWord(text, segment.sourceText, event.currentTarget)} type="button">{text}</button>
        : <span key={`${segment.id}-${index}`}>{text}</span>;
    })}</p>
      {captionMode === "bilingual" && segment.translation ? <p className="segment-transcript__translation">{segment.translation}</p> : null}</div>
  </li>;
});

function TranscriptLoading({ expectedCount }: Readonly<{ expectedCount?: number }>) {
  return <div aria-busy="true" className="media-transcript__pending" role="status">
    <div aria-hidden="true" className="media-loading-transcript-lines"><span /><span /><span /><span /><span /></div>
    <p>字幕正在加载…</p>
    {typeof expectedCount === "number" && expectedCount > 0 ? <p className="media-transcript__pending-count">共 {expectedCount} 段，播放器已可正常使用。</p> : null}
  </div>;
}

function TranscriptError({ message, onRetry }: Readonly<{ message?: string; onRetry?: () => void }>) {
  return <div className="media-transcript__error" role="alert">
    <p>{message ?? "字幕暂时无法加载，可重试。"}</p>
    {onRetry ? <button className="media-player-retry" onClick={onRetry} type="button">重试加载字幕</button> : null}
  </div>;
}

export function SegmentTranscript({ segments, activeIndex, captionMode, currentPositionMs, mediaKind, follow, onSeek, onWord, state = "ready", wordsState = "ready", expectedCount, errorMessage, wordsMessage, onRetry }: Readonly<{
  segments: MediaPlayback["segments"]; activeIndex: number | null; captionMode: CaptionMode;
  currentPositionMs: number;
  mediaKind: MediaPlayback["media"]["kind"];
  /**
   * When false, the transcript stops pulling itself to the spoken line so a
   * learner can read ahead. The active-segment highlight keeps updating, so
   * turning follow back on jumps straight to the current line.
   */
  follow: boolean;
  onSeek: (index: number) => void; onWord: (word: string, sentence: string, trigger: HTMLButtonElement) => void;
  /** Defaults to the complete transcript behaviour used by the E2E fixture path. */
  state?: TranscriptRenderState;
  /** Word-level highlight phase; only meaningful while `state` is `text_ready`. */
  wordsState?: TranscriptWordsState;
  expectedCount?: number;
  errorMessage?: string;
  wordsMessage?: string;
  onRetry?: () => void;
}>) {
  const activeSegmentRef = useRef<HTMLLIElement | null>(null);
  const transcriptRef = useRef<HTMLOListElement | null>(null);
  // The full version stays available for playback and seeking. Mounting all
  // its word buttons during SSR blocks the detail page behind its skeleton.
  // The batch is keyed by the transcript's cue identity, not by the array
  // reference, so a later words merge does not reset already mounted rows.
  const transcriptToken = segments.length === 0
    ? "0"
    : `${segments.length}:${segments[0]!.id}:${segments[segments.length - 1]!.id}`;
  const [mounted, setMounted] = useState(() => ({ token: transcriptToken, count: Math.min(TRANSCRIPT_MOUNT_BATCH, segments.length) }));
  // A different transcript (new published version, changed cue list) restarts
  // the incremental mount from the first batch. This is derived during render
  // instead of reset by an effect; the batch timer below adopts the new token.
  const mountedCount = mounted.token === transcriptToken ? mounted.count : Math.min(TRANSCRIPT_MOUNT_BATCH, segments.length);
  useEffect(() => {
    if (captionMode === "hidden" || mountedCount >= segments.length) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      startTransition(() => setMounted({ token: transcriptToken, count: Math.min(segments.length, mountedCount + TRANSCRIPT_MOUNT_BATCH) }));
    }, 32);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [transcriptToken, segments.length, captionMode, mountedCount]);
  useEffect(() => {
    if (!follow || captionMode === "hidden") return;
    const row = activeSegmentRef.current;
    const transcript = transcriptRef.current;
    if (!row || !transcript) return;
    if (transcript.scrollHeight > transcript.clientHeight) {
      // Scroll only the transcript pane so following cannot move the player.
      // Keep upcoming lines visible instead of pinning each new line to the bottom.
      const rowBounds = row.getBoundingClientRect();
      const top = transcript.scrollTop + rowBounds.top - transcript.getBoundingClientRect().top - transcript.clientTop;
      const centeredTop = top - Math.max(0, (transcript.clientHeight - rowBounds.height) / 2);
      transcript.scrollTop = Math.max(0, Math.min(centeredTop, transcript.scrollHeight - transcript.clientHeight));
    } else {
      // Narrow layouts let the full transcript participate in page scrolling.
      row.scrollIntoView?.({ block: "center", inline: "nearest" });
    }
  }, [activeIndex, follow, captionMode, segments, mountedCount]);
  if (state === "loading") return <TranscriptLoading expectedCount={expectedCount} />;
  if (state === "error") return <TranscriptError message={errorMessage} onRetry={onRetry} />;
  if (segments.length === 0) return <p className="media-transcript__empty">{mediaKind === "podcast" ? "这期播客可以播放，但目前没有已审核的逐句文本。" : "这项视频可以播放，但目前没有已审核的逐句字幕。"}</p>;
  if (captionMode === "hidden") return <p className="media-transcript__empty">字幕已隐藏，仍可使用上/重播/下一句控制。</p>;
  // Resume/jump to any cue immediately, even while earlier rows are mounting.
  // Use its array position here: approved cue indexes can have gaps.
  const activePosition = activeIndex === null ? -1 : segments.findIndex((segment) => segment.index === activeIndex);
  const visibleSegments = activePosition < mountedCount ? segments.slice(0, mountedCount) : [
    ...segments.slice(0, mountedCount),
    ...segments.slice(Math.max(mountedCount, activePosition - 2), activePosition + 3),
  ];
  return <>
    <ol aria-busy={mountedCount < segments.length} className="segment-transcript" ref={transcriptRef}>{visibleSegments.map((segment) => {
      const isActiveSegment = segment.index === activeIndex;
      // Word timing is only resolved for the line being spoken, so the other lines
      // receive a stable `null` and their memoised render is skipped entirely.
      const activeWord = isActiveSegment ? activeWordAt(wordTimingsForPlayback(segment), currentPositionMs) : null;
      return <TranscriptRow activeRef={activeSegmentRef} activeWord={activeWord} captionMode={captionMode} isActiveSegment={isActiveSegment} key={segment.id} onSeek={onSeek} onWord={onWord} segment={segment} />;
    })}{mountedCount < segments.length ? <li className="media-transcript__empty" role="status">其余字幕正在加载…</li> : null}</ol>
    {state === "text_ready" && wordsState === "loading"
      ? <p className="media-transcript__words-hint" role="status">字幕已加载，逐词高亮准备中…</p>
      : state === "text_ready" && wordsState === "unavailable"
        ? <div className="media-transcript__words-error" role="status">
          <p>{wordsMessage ?? "逐词高亮暂时不可用，可重试。"}</p>
          {onRetry ? <button className="media-player-retry" onClick={onRetry} type="button">重试逐词高亮</button> : null}
        </div>
        : null}
  </>;
}
