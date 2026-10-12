"use client";

import { useEffect, useRef, useState } from "react";

import { contentSourceHref } from "../domain";
import type { CorpusItem } from "../repositories";

type LoadState = "idle" | "loading" | "ready" | "error";

function locationLabel(item: CorpusItem): string {
  if (item.location.kind === "text") return `第 ${item.location.segmentIndex + 1} 段`;
  const totalSeconds = Math.floor(item.location.startMs / 1_000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function LexiconOccurrences({ entryId, entryKind, label, occurrenceCount }: Readonly<{
  entryId: string;
  entryKind: "lexeme" | "phrase";
  label: string;
  occurrenceCount: number;
}>) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>("idle");
  const [items, setItems] = useState<readonly CorpusItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const panelId = `lexicon-occurrences-${entryKind}-${entryId}`;

  useEffect(() => () => abortRef.current?.abort(), []);

  async function load() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState("loading");
    try {
      const parameters = new URLSearchParams({ entryKind, entryId, pageSize: "6" });
      const response = await fetch(`/api/v1/corpus/search?${parameters.toString()}`, { credentials: "same-origin", signal: controller.signal });
      if (!response.ok) throw new Error("OCCURRENCES_UNAVAILABLE");
      const payload = await response.json() as { data?: { items?: readonly CorpusItem[] } };
      setItems(payload.data?.items ?? []);
      setState("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState("error");
    }
  }

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (state === "ready") return;
    if (occurrenceCount === 0) {
      setState("ready");
      return;
    }
    void load();
  }

  return <div className="lexicon-occurrences">
    <button type="button" className="lexicon-occurrences__trigger" aria-label={`查看 ${label} 的上下文`} aria-expanded={open} aria-controls={panelId} onClick={toggle}>
      <span>查看更多真实例句（{occurrenceCount}）</span><span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    {open ? <section id={panelId} className="lexicon-occurrences__panel" aria-label={`${label} 的上下文`} aria-live="polite">
      {state === "loading" ? <p role="status">正在加载上下文…</p> : null}
      {state === "error" ? <div className="lexicon-occurrences__state" role="alert"><p>上下文暂时无法加载。</p><button type="button" onClick={() => void load()}>重试</button></div> : null}
      {state === "ready" && items.length === 0 ? <p>目前没有可见的来源上下文。</p> : null}
      {state === "ready" && items.length > 0 ? <ol>{items.map((item, index) => <li key={`${item.document.kind}:${item.document.stableKey}:${item.document.version}:${item.location.segmentIndex}:${index}`}>
        <p className="lexicon-occurrences__context"><span>{item.leftContext} </span><mark>{item.keyword}</mark><span> {item.rightContext}</span></p>
        <div className="lexicon-occurrences__source"><span>{item.sourceTitle}</span><span>{item.document.kind === "article" ? "文章" : "媒体"} · v{item.document.version} · {locationLabel(item)}</span><a href={contentSourceHref(item.document, item.location)}>{item.document.kind === "article" ? "回到原文" : "回到原片段"}</a></div>
      </li>)}</ol> : null}
    </section> : null}
  </div>;
}
