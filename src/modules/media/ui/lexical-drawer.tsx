"use client";

import { useEffect, useRef, useState } from "react";
import { requestWordExplanation, type MediaWordExplanation } from "./request-word-explanation";

export function LexicalDrawer({ word, sentence, onClose }: Readonly<{ word: string; sentence: string; onClose: () => void }>) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [result, setResult] = useState<{ key: string; value?: MediaWordExplanation; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const cache = useRef(new Map<string, MediaWordExplanation>());
  const key = JSON.stringify([word, sentence]);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 35_000);
    const cached = cache.current.get(key);
    void (cached ? Promise.resolve(cached) : requestWordExplanation(word, sentence, controller.signal))
      .then((value) => {
        if (controller.signal.aborted) return;
        cache.current.set(key, value);
        setResult({ key, value });
      }).catch(() => {
        if (!disposed) setResult({ key, error: "解析暂时不可用或连接中断，请重试。" });
      }).finally(() => window.clearTimeout(timeout));
    return () => { disposed = true; controller.abort(); window.clearTimeout(timeout); };
  }, [key, word, sentence, retry]);
  useEffect(() => { closeRef.current?.focus(); }, []);
  const current = result?.key === key ? result : null;
  return <aside aria-labelledby="lexical-drawer-title" className="lexical-drawer" role="dialog" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div className="lexical-drawer__handle" aria-hidden="true" />
    <header><div><p className="eyebrow">当前词语</p><h2 id="lexical-drawer-title">词句上下文</h2></div>
      <button aria-label="关闭词句上下文" onClick={onClose} ref={closeRef} type="button">关闭</button></header>
    <strong lang="es">{word}</strong><p lang="es">{sentence}</p>
    {!current ? <p role="status">正在解析语境…</p> : current.error ? <div role="status"><p>{current.error}</p><button type="button" onClick={() => { setResult(null); setRetry((value) => value + 1); }}>重试解析</button></div> : current.value ? <dl className="media-word-explanation">
      <dt>词性</dt><dd>{current.value.partOfSpeech}</dd>
      <dt>释义</dt><dd>{current.value.meaning}</dd>
      <dt>在这句话中</dt><dd>{current.value.contextualMeaning}</dd>
      <dt>例句</dt><dd>{current.value.example}</dd>
    </dl> : null}
    <p className="lexical-drawer__note">AI 语境解析 · 仅供理解参考</p>
  </aside>;
}
