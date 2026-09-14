"use client";

import { useState } from "react";
import type { VocabularyItem } from "../repositories";

export function VocabularyLibrary({ items }: Readonly<{ items: readonly VocabularyItem[] }>) {
  const [rows, setRows] = useState(items);
  const [busy, setBusy] = useState<string | null>(null);
  async function update(item: VocabularyItem, intent: "familiar" | "revisit" | "ignore") {
    setBusy(item.id);
    try {
      const response = await fetch(`/api/v1/lexicon/intents/${encodeURIComponent(item.id)}`, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ entryKind: "lexeme", intent, expectedRevision: item.revision }) });
      if (!response.ok) return;
      setRows((current) => current.map((row) => row.id === item.id ? { ...row, intent } : row));
    } finally { setBusy(null); }
  }
  if (!rows.length) return <div className="lexicon-empty"><h2>还没有词汇</h2><p>从已发布文章、视频或播客中确认词句后，会在这里留下上下文。</p></div>;
  return <section className="lexicon-library" aria-label="词汇列表"><div className="lexicon-grid">{rows.map((item) => <article className="lexicon-entry" key={item.id}><div className="lexicon-entry__heading"><h2>{item.lemma}</h2>{item.partOfSpeech ? <span>{item.partOfSpeech}</span> : null}</div><p>{item.meaningZh ?? "释义待补充"}</p><div className="lexicon-entry__meta"><span>{item.occurrenceCount} 个出现</span><span>{item.lemmaStatus === "verified" ? "已确认词元" : "待确认词形"}</span></div><div className="lexicon-intent-actions" aria-label={`${item.lemma} 复习意图`}>{(["familiar", "revisit", "ignore"] as const).map((intent) => <button key={intent} type="button" aria-pressed={item.intent === intent} disabled={busy === item.id} onClick={() => void update(item, intent)}>{intent === "familiar" ? "已熟悉" : intent === "revisit" ? "想复现" : "暂不学习"}</button>)}</div></article>)}</div></section>;
}
