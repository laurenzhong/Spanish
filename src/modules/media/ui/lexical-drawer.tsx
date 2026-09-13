"use client";

import { useEffect, useRef } from "react";

export function LexicalDrawer({ word, sentence, onClose }: Readonly<{ word: string; sentence: string; onClose: () => void }>) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return <aside aria-labelledby="lexical-drawer-title" aria-modal="true" className="lexical-drawer" role="dialog">
    <div className="lexical-drawer__handle" aria-hidden="true" />
    <header><div><p className="eyebrow">当前词语</p><h2 id="lexical-drawer-title">词句上下文</h2></div>
      <button aria-label="关闭词句上下文" onClick={onClose} ref={closeRef} type="button">关闭</button></header>
    <strong lang="es">{word}</strong><p lang="es">{sentence}</p>
    <p className="lexical-drawer__note">词义、短语保存和跨来源语料将在词句语料阶段接入；这里先保留准确的当前句与时间位置。</p>
  </aside>;
}
