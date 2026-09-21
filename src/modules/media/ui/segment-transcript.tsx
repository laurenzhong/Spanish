"use client";

import type { MediaPlayback } from "../domain";
import { memo, useEffect, useMemo, useRef } from "react";
import { activeWordAt, wordTimingsForPlayback } from "../domain/word-timeline";

export type CaptionMode = "es" | "bilingual" | "hidden";
const timeLabel = (milliseconds: number) => { const seconds = Math.floor(milliseconds / 1_000); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; };
const tokens = (text: string) => Array.from(text.matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)?|[^\p{L}\p{M}]+/gu));

export const TranscriptWords = memo(function TranscriptWords({ segment, positionMs, onWord }: Readonly<{
  segment: MediaPlayback["segments"][number]; positionMs: number;
  onWord: (word: string, sentence: string, trigger: HTMLButtonElement) => void;
}>) {
  const words = useMemo(() => wordTimingsForPlayback(segment), [segment]);
  const textTokens = useMemo(() => tokens(segment.sourceText), [segment.sourceText]);
  const spoken = activeWordAt(words, positionMs);
  return <>{textTokens.map((match, index) => {
    const token = match[0];
    const start = match.index;
    const speaking = spoken && start < spoken.endOffset && start + token.length > spoken.startOffset;
    return /[\p{L}\p{M}]/u.test(token)
      ? <button aria-current={speaking ? "step" : undefined} aria-label={`查看词语 ${token}`} className={`segment-transcript__word${speaking ? " is-speaking" : ""}`} data-active-word={speaking ? "true" : undefined} key={`${segment.id}-${index}`} onClick={(event) => onWord(token, segment.sourceText, event.currentTarget)} type="button">{token}</button>
      : <span key={`${segment.id}-${index}`}>{token}</span>;
  })}</>;
});

export function SegmentTranscript({ segments, activeIndex, captionMode, mediaKind, onSeek, onWord, positionMs = 0 }: Readonly<{
  positionMs?: number;
  segments: MediaPlayback["segments"]; activeIndex: number | null; captionMode: CaptionMode;
  mediaKind: MediaPlayback["media"]["kind"];
  onSeek: (index: number) => void; onWord: (word: string, sentence: string, trigger: HTMLButtonElement) => void;
}>) {
  const listRef = useRef<HTMLOListElement>(null);
  const lastPositionRef = useRef(positionMs);
  const missingTranslations = segments.filter((segment) => !segment.translation?.trim()).length;
  useEffect(() => {
    const positionChanged = lastPositionRef.current !== positionMs;
    lastPositionRef.current = positionMs;
    if (captionMode === "hidden") return;
    const list = listRef.current;
    const target = list?.querySelector<HTMLElement>(".is-speaking") ?? list?.querySelector<HTMLElement>(".is-active");
    if (!list || !target) return;
    const bounds = list.getBoundingClientRect();
    const item = target.getBoundingClientRect();
    if (list.scrollHeight <= list.clientHeight) {
      // Narrow layouts use the page scroll. Do not jump away from the player
      // on initial render; only follow once playback/seek changes position.
      if (positionChanged && item.height > 0 && (item.top < 24 || item.bottom > window.innerHeight - 100)) {
        window.scrollBy({ top: item.top - window.innerHeight / 3, behavior: "instant" });
      }
      return;
    }
    if (item.top < bounds.top + 24 || item.bottom > bounds.bottom - 24) {
      list.scrollTo?.({ top: list.scrollTop + item.top - bounds.top - list.clientHeight / 3, behavior: "instant" });
    }
  }, [activeIndex, positionMs, captionMode]);
  if (segments.length === 0) return <p className="media-transcript__empty">{mediaKind === "podcast" ? "这期播客可以播放，但目前没有已审核的逐句文本。" : "这项视频可以播放，但目前没有已审核的逐句字幕。"}</p>;
  if (captionMode === "hidden") return <p className="media-transcript__empty">字幕已隐藏，仍可使用左右键按句切换。</p>;
  return <>{captionMode === "bilingual" && missingTranslations > 0 ? <p className="media-transcript__notice" role="status">{missingTranslations === segments.length ? "这期内容尚无已审核中文译文，当前仅显示西语原文。" : `还有 ${missingTranslations} 段待补中文译文。`}</p> : null}<ol ref={listRef} className="segment-transcript">{segments.map((segment) => {
    return <li aria-current={segment.index === activeIndex ? "true" : undefined} className={segment.index === activeIndex ? "is-active" : undefined} key={segment.id} onClick={(event) => { if (!(event.target as HTMLElement).closest("button") && !window.getSelection()?.toString()) onSeek(segment.index); }}>
    <button aria-label={`跳到 ${timeLabel(segment.startMs)}`} className="segment-transcript__time" onClick={() => onSeek(segment.index)} type="button">{timeLabel(segment.startMs)}</button>
    <div><p lang="es"><TranscriptWords segment={segment} positionMs={segment.index === activeIndex ? positionMs : -1} onWord={onWord} /></p>
      {captionMode === "bilingual" && segment.translation ? <p lang="zh-CN" className="segment-transcript__translation">{segment.translation}</p> : null}</div>
  </li>;
  })}</ol></>;
}
