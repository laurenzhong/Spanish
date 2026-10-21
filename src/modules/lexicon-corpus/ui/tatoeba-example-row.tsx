"use client";

import { useEffect, useRef, useState } from "react";
import type { TatoebaExample } from "../application/tatoeba-examples";

export function TatoebaExampleRow({ example, phase, notice, onToggle }: Readonly<{
  example: TatoebaExample;
  phase: "loading" | "playing" | null;
  notice: string;
  onToggle: () => void;
}>): React.ReactElement {
  const [copyNotice, setCopyNotice] = useState("");
  const copyGeneration = useRef(0);
  useEffect(() => () => { copyGeneration.current += 1; }, []);
  const copy = async () => {
    const generation = ++copyGeneration.current;
    try {
      await navigator.clipboard.writeText(example.text);
      if (copyGeneration.current === generation) setCopyNotice("已复制西语例句");
    } catch {
      if (copyGeneration.current === generation) setCopyNotice("复制失败，请选择例句后手动复制。");
    }
  };
  const audio = example.audio;
  const label = audio ? phase ? "停止例句原声" : "播放例句原声" : phase ? "停止合成朗读" : "合成朗读例句";
  // 所有者要求：点击例句播放按钮不显示准备/加载/播放这类状态提示。播放状态只由
  // 按钮图标、停止标签、aria-busy 和 aria-pressed 表达；错误重试与复制反馈仍可见。
  const status = notice || copyNotice;
  return <>
    <div className="vocabulary-study__tatoeba-row">
      <p className="vocabulary-study__tatoeba-text" lang="es">{example.text}</p>
      <div className="vocabulary-study__tatoeba-actions">
        <button type="button" aria-label="复制例句" title="复制西语例句" onClick={() => void copy()}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="7" y="3" width="13" height="15" rx="1.5" /><path d="M16 18v3H3V7h4M10 7h7M10 10h7M10 13h5" /></svg>
        </button>
        <button type="button" aria-label={label} title={label} aria-pressed={Boolean(phase)} aria-busy={phase === "loading" || undefined} onClick={onToggle}>
          {phase ? <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
            : <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M11 4 6 8H3v8h3l5 4V4Z" fill="currentColor" /><path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" strokeLinecap="round" /></svg>}
        </button>
      </div>
    </div>
    <p className="vocabulary-study__tatoeba-translation" lang="zh-Hans">{example.translation}</p>
    {audio ? <p className="vocabulary-study__tatoeba-audio-credit">录音 · <a href={audio.attributionUrl} target="_blank" rel="noreferrer noopener">{audio.author}</a> · {audio.license}</p> : null}
    {status ? <p className="vocabulary-study__tatoeba-feedback" role="status">{status}</p> : null}
  </>;
}
