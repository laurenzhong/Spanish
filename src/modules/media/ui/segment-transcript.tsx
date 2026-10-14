"use client";

import type { MediaPlayback } from "../domain";
import { activeWordAt, mediaWordMatches, wordTimingsForPlayback } from "../domain";
import { memo, useEffect, useRef, type RefObject } from "react";

export type CaptionMode = "es" | "bilingual" | "hidden";
const timeLabel = (milliseconds: number) => { const seconds = Math.floor(milliseconds / 1_000); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; };

type TranscriptToken = Readonly<{ text: string; startOffset: number; endOffset: number; isWord: boolean }>;
type TranscriptSegment = MediaPlayback["segments"][number];
type ActiveWord = ReturnType<typeof activeWordAt>;

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
  return <li id={`segment-${segment.index}`} className={isActiveSegment ? "is-active" : undefined} ref={isActiveSegment ? activeRef : undefined}>
    <button aria-label={`跳到 ${timeLabel(segment.startMs)}`} className="segment-transcript__time" onClick={() => onSeek(segment.index)} type="button">{timeLabel(segment.startMs)}</button>
    <div>{segment.speaker ? <strong>{segment.speaker}</strong> : null}<p lang="es">{sourceTokens.map((token, index) => {
      const { text, startOffset, endOffset } = token;
      const isCurrentWord = Boolean(activeWord && activeWord.startOffset === startOffset && activeWord.endOffset === endOffset);
      return token.isWord
        ? <button aria-current={isCurrentWord ? "step" : undefined} aria-label={`查看词语 ${text}`} className={`segment-transcript__word${isCurrentWord ? " is-speaking" : ""}`} data-active-word={isCurrentWord ? "true" : undefined} key={`${segment.id}-${index}`} onClick={(event) => onWord(text, segment.sourceText, event.currentTarget)} type="button">{text}</button>
        : <span key={`${segment.id}-${index}`}>{text}</span>;
    })}</p>
      {captionMode === "bilingual" && segment.translation ? <p className="segment-transcript__translation">{segment.translation}</p> : null}</div>
  </li>;
});

export function SegmentTranscript({ segments, activeIndex, captionMode, currentPositionMs, mediaKind, follow, onSeek, onWord }: Readonly<{
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
}>) {
  const activeSegmentRef = useRef<HTMLLIElement | null>(null);
  const transcriptRef = useRef<HTMLOListElement | null>(null);
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
  }, [activeIndex, follow, captionMode, segments]);
  if (segments.length === 0) return <p className="media-transcript__empty">{mediaKind === "podcast" ? "这期播客可以播放，但目前没有已审核的逐句文本。" : "这项视频可以播放，但目前没有已审核的逐句字幕。"}</p>;
  if (captionMode === "hidden") return <p className="media-transcript__empty">字幕已隐藏，仍可使用上/重播/下一句控制。</p>;
  return <ol className="segment-transcript" ref={transcriptRef}>{segments.map((segment) => {
    const isActiveSegment = segment.index === activeIndex;
    // Word timing is only resolved for the line being spoken, so the other lines
    // receive a stable `null` and their memoised render is skipped entirely.
    const activeWord = isActiveSegment ? activeWordAt(wordTimingsForPlayback(segment), currentPositionMs) : null;
    return <TranscriptRow activeRef={activeSegmentRef} activeWord={activeWord} captionMode={captionMode} isActiveSegment={isActiveSegment} key={segment.id} onSeek={onSeek} onWord={onWord} segment={segment} />;
  })}</ol>;
}
