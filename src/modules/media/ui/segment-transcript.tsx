"use client";

import type { MediaPlayback } from "../domain";

export type CaptionMode = "es" | "bilingual" | "hidden";
const timeLabel = (milliseconds: number) => { const seconds = Math.floor(milliseconds / 1_000); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; };
const tokens = (text: string) => text.match(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)?|[^\p{L}\p{M}]+/gu) ?? [text];

export function SegmentTranscript({ segments, activeIndex, captionMode, mediaKind, onSeek, onWord }: Readonly<{
  segments: MediaPlayback["segments"]; activeIndex: number | null; captionMode: CaptionMode;
  mediaKind: MediaPlayback["media"]["kind"];
  onSeek: (index: number) => void; onWord: (word: string, sentence: string, trigger: HTMLButtonElement) => void;
}>) {
  if (segments.length === 0) return <p className="media-transcript__empty">{mediaKind === "podcast" ? "这期播客可以播放，但目前没有已审核的逐句文本。" : "这项视频可以播放，但目前没有已审核的逐句字幕。"}</p>;
  if (captionMode === "hidden") return <p className="media-transcript__empty">字幕已隐藏，仍可使用上/重播/下一句控制。</p>;
  return <ol className="segment-transcript">{segments.map((segment) => <li className={segment.index === activeIndex ? "is-active" : undefined} key={segment.id}>
    <button aria-label={`跳到 ${timeLabel(segment.startMs)}`} className="segment-transcript__time" onClick={() => onSeek(segment.index)} type="button">{timeLabel(segment.startMs)}</button>
    <div>{segment.speaker ? <strong>{segment.speaker}</strong> : null}<p lang="es">{tokens(segment.sourceText).map((token, index) => /[\p{L}\p{M}]/u.test(token)
      ? <button aria-label={`查看词语 ${token}`} className="segment-transcript__word" key={`${segment.id}-${index}`} onClick={(event) => onWord(token, segment.sourceText, event.currentTarget)} type="button">{token}</button>
      : <span key={`${segment.id}-${index}`}>{token}</span>)}</p>
      {captionMode === "bilingual" && segment.translation ? <p className="segment-transcript__translation">{segment.translation}</p> : null}</div>
  </li>)}</ol>;
}
