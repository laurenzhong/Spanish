"use client";

import type { MediaPlayback } from "../domain";
import { useEffect, useRef } from "react";

export type CaptionMode = "es" | "bilingual" | "hidden";
const timeLabel = (milliseconds: number) => { const seconds = Math.floor(milliseconds / 1_000); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; };
const tokens = (text: string) => text.match(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)?|[^\p{L}\p{M}]+/gu) ?? [text];
const isWordToken = (token: string) => /[\p{L}\p{M}]/u.test(token);

function activeWordTokenIndex(text: string, startMs: number, endMs: number, positionMs: number): number | null {
  if (positionMs < startMs || positionMs >= endMs) return null;
  const wordIndexes = tokens(text).flatMap((token, index) => isWordToken(token) ? [index] : []);
  if (wordIndexes.length === 0) return null;
  const progress = Math.min(0.999, Math.max(0, (positionMs - startMs) / Math.max(1, endMs - startMs)));
  return wordIndexes[Math.floor(progress * wordIndexes.length)] ?? null;
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
    const activeTokenIndex = isActiveSegment ? activeWordTokenIndex(segment.sourceText, segment.startMs, segment.endMs, currentPositionMs) : null;
    return <li id={`segment-${segment.index}`} className={isActiveSegment ? "is-active" : undefined} key={segment.id} ref={isActiveSegment ? activeSegmentRef : undefined}>
    <button aria-label={`跳到 ${timeLabel(segment.startMs)}`} className="segment-transcript__time" onClick={() => onSeek(segment.index)} type="button">{timeLabel(segment.startMs)}</button>
    <div>{segment.speaker ? <strong>{segment.speaker}</strong> : null}<p lang="es">{tokens(segment.sourceText).map((token, index) => isWordToken(token)
      ? <button aria-current={activeTokenIndex === index ? "step" : undefined} aria-label={`查看词语 ${token}`} className={`segment-transcript__word${activeTokenIndex === index ? " is-current" : ""}`} data-active-word={activeTokenIndex === index ? "true" : undefined} key={`${segment.id}-${index}`} onClick={(event) => onWord(token, segment.sourceText, event.currentTarget)} type="button">{token}</button>
      : <span key={`${segment.id}-${index}`}>{token}</span>)}</p>
      {captionMode === "bilingual" && segment.translation ? <p className="segment-transcript__translation">{segment.translation}</p> : null}</div>
  </li>;
  })}</ol>;
}
