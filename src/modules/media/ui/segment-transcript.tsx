"use client";

import type { MediaPlayback } from "../domain";
import { activeWordAt, mediaWordMatches, wordTimingsForPlayback } from "../domain";
import { useEffect, useRef } from "react";

export type CaptionMode = "es" | "bilingual" | "hidden";
const timeLabel = (milliseconds: number) => { const seconds = Math.floor(milliseconds / 1_000); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; };

type TranscriptToken = Readonly<{ text: string; startOffset: number; endOffset: number; isWord: boolean }>;

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

export function SegmentTranscript({ segments, activeIndex, captionMode, currentPositionMs, mediaKind, onSeek, onWord }: Readonly<{
  segments: MediaPlayback["segments"]; activeIndex: number | null; captionMode: CaptionMode;
  currentPositionMs: number;
  mediaKind: MediaPlayback["media"]["kind"];
  onSeek: (index: number) => void; onWord: (word: string, sentence: string, trigger: HTMLButtonElement) => void;
}>) {
  const activeSegmentRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    activeSegmentRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);
  if (segments.length === 0) return <p className="media-transcript__empty">{mediaKind === "podcast" ? "这期播客可以播放，但目前没有已审核的逐句文本。" : "这项视频可以播放，但目前没有已审核的逐句字幕。"}</p>;
  if (captionMode === "hidden") return <p className="media-transcript__empty">字幕已隐藏，仍可使用上/重播/下一句控制。</p>;
  return <ol className="segment-transcript">{segments.map((segment) => {
    const isActiveSegment = segment.index === activeIndex;
    const exactWords = wordTimingsForPlayback(segment);
    const activeWord = isActiveSegment ? activeWordAt(exactWords, currentPositionMs) : null;
    const sourceTokens = transcriptTokens(segment.sourceText);
    return <li id={`segment-${segment.index}`} className={isActiveSegment ? "is-active" : undefined} key={segment.id} ref={isActiveSegment ? activeSegmentRef : undefined}>
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
  })}</ol>;
}
