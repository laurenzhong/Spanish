"use client";

import { useState } from "react";

import type { PhraseItem } from "../repositories";
import { LexiconOccurrences } from "./lexicon-occurrences";

type Intent = "familiar" | "revisit" | "ignore";
const intents = [
  ["familiar", "已熟悉"],
  ["revisit", "想复现"],
  ["ignore", "暂不学习"],
] as const;

export function PhraseLibrary({ items, total = items.length, filtered = false, unavailable = false }: Readonly<{
  items: readonly PhraseItem[];
  total?: number;
  filtered?: boolean;
  unavailable?: boolean;
}>) {
  const [rows, setRows] = useState(items);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function update(item: PhraseItem, intent: Intent) {
    setBusy(item.id);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/lexicon/intents/${encodeURIComponent(item.id)}`, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ entryKind: "phrase", intent, expectedRevision: item.revision }) });
      if (!response.ok) {
        setMessage(`未能更新 ${item.expression} 的学习状态，请刷新后重试。`);
        return;
      }
      const payload = await response.json() as { data?: { revision?: number } };
      const revision = payload.data?.revision;
      setRows((current) => current.map((row) => row.id === item.id ? { ...row, intent, revision: Number.isInteger(revision) ? revision as number : row.revision + 1 } : row));
      setMessage(`已更新 ${item.expression} 的学习状态。`);
    } catch {
      setMessage(`未能更新 ${item.expression} 的学习状态，请检查网络后重试。`);
    } finally {
      setBusy(null);
    }
  }

  if (unavailable) return <div className="lexicon-empty lexicon-empty--error" role="alert"><h2>短语库暂时不可用</h2><p>筛选条件和已有状态没有丢失，请稍后刷新。</p></div>;
  if (!rows.length) return <div className="lexicon-empty"><h2>{filtered ? "没有匹配的短语" : "还没有短语"}</h2><p>{filtered ? "试试减少筛选条件，或重置后查看全部短语。" : "通过文章或媒体中的上下文保存正式短语后，会在这里集中整理。"}</p></div>;
  return <section className="lexicon-library" aria-label="短语列表">
    <p className="sr-only">当前显示 {rows.length} 个，共 {total} 个短语。</p>
    <div className="lexicon-library__message" aria-live="polite">{message}</div>
    <div className="lexicon-grid">{rows.map((item) => <article className="lexicon-entry lexicon-entry--phrase" key={item.id}>
      <div className="lexicon-entry__heading"><div><h2 lang="es">{item.expression}</h2>{item.variants.length ? <p lang="es">变体：{item.variants.join(" · ")}</p> : null}</div>{item.cefr ? <span>{item.cefr}</span> : null}</div>
      <p className="lexicon-entry__meaning">{item.meaningZh ?? "用法说明待补充"}</p>
      {item.pragmaticPurpose ? <p className="lexicon-entry__purpose">{item.pragmaticPurpose}</p> : null}
      <div className="lexicon-entry__meta">{item.register ? <span>{item.register}</span> : null}{item.region ? <span>{item.region}</span> : null}</div>
      <LexiconOccurrences entryId={item.id} entryKind="phrase" label={item.expression} occurrenceCount={item.occurrenceCount} />
      <div className="lexicon-intent-actions" aria-label={`${item.expression} 复习意图`}>{intents.map(([intent, label]) => <button key={intent} type="button" aria-pressed={item.intent === intent} disabled={busy === item.id} onClick={() => void update(item, intent)}>{label}</button>)}</div>
    </article>)}</div>
  </section>;
}
