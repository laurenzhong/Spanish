"use client";

import { useState } from "react";
import type { PhraseItem } from "../repositories";

export function PhraseLibrary({ items }: Readonly<{ items: readonly PhraseItem[] }>) {
  const [rows, setRows] = useState(items);
  const [busy, setBusy] = useState<string | null>(null);
  async function update(item: PhraseItem, intent: "familiar" | "revisit" | "ignore") {
    setBusy(item.id);
    try {
      const response = await fetch(`/api/v1/lexicon/intents/${encodeURIComponent(item.id)}`, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ entryKind: "phrase", intent, expectedRevision: item.revision }) });
      if (!response.ok) return;
      setRows((current) => current.map((row) => row.id === item.id ? { ...row, intent } : row));
    } finally { setBusy(null); }
  }
  if (!rows.length) return <div className="lexicon-empty"><h2>还没有短语</h2><p>通过文章或媒体中的上下文保存正式短语后，会在这里集中整理。</p></div>;
  return <section className="lexicon-library" aria-label="短语列表"><div className="lexicon-grid">{rows.map((item) => <article className="lexicon-entry lexicon-entry--phrase" key={item.id}><div className="lexicon-entry__heading"><h2>{item.expression}</h2>{item.cefr ? <span>{item.cefr}</span> : null}</div><p>{item.meaningZh ?? "用法说明待补充"}</p>{item.pragmaticPurpose ? <p className="lexicon-entry__purpose">{item.pragmaticPurpose}</p> : null}<div className="lexicon-entry__meta"><span>{item.occurrenceCount} 个出现</span>{item.register ? <span>{item.register}</span> : null}</div><div className="lexicon-intent-actions" aria-label={`${item.expression} 复习意图`}>{(["familiar", "revisit", "ignore"] as const).map((intent) => <button key={intent} type="button" aria-pressed={item.intent === intent} disabled={busy === item.id} onClick={() => void update(item, intent)}>{intent === "familiar" ? "已熟悉" : intent === "revisit" ? "想复现" : "暂不学习"}</button>)}</div></article>)}</div></section>;
}
