"use client";

import { useState } from "react";

import type { VocabularyItem } from "../repositories";
import { LexiconOccurrences } from "./lexicon-occurrences";

type Intent = "familiar" | "revisit" | "ignore";
const intents = [
  ["familiar", "已熟悉"],
  ["revisit", "想复现"],
  ["ignore", "暂不学习"],
] as const;

export function VocabularyLibrary({ items, total = items.length, filtered = false, unavailable = false }: Readonly<{
  items: readonly VocabularyItem[];
  total?: number;
  filtered?: boolean;
  unavailable?: boolean;
}>) {
  const [rows, setRows] = useState(items);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function update(item: VocabularyItem, intent: Intent) {
    setBusy(item.id);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/lexicon/intents/${encodeURIComponent(item.id)}`, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ entryKind: "lexeme", intent, expectedRevision: item.revision }) });
      if (!response.ok) {
        setMessage(`未能更新 ${item.lemma} 的学习状态，请刷新后重试。`);
        return;
      }
      const payload = await response.json() as { data?: { revision?: number } };
      const revision = payload.data?.revision;
      setRows((current) => current.map((row) => row.id === item.id ? { ...row, intent, revision: Number.isInteger(revision) ? revision as number : row.revision + 1 } : row));
      setMessage(`已将 ${item.lemma} 标记为“${intents.find(([value]) => value === intent)?.[1]}”。`);
    } catch {
      setMessage(`未能更新 ${item.lemma} 的学习状态，请检查网络后重试。`);
    } finally {
      setBusy(null);
    }
  }

  if (unavailable) return <div className="lexicon-empty lexicon-empty--error" role="alert"><h2>词汇库暂时不可用</h2><p>筛选条件和已有状态没有丢失，请稍后刷新。</p></div>;
  if (!rows.length) return <div className="lexicon-empty"><h2>{filtered ? "没有匹配的词汇" : "还没有词汇"}</h2><p>{filtered ? "试试减少筛选条件，或重置后查看全部词汇。" : "从已发布文章、视频或播客中确认词句后，会在这里留下上下文。"}</p></div>;
  return <section className="lexicon-library" aria-label="词汇列表">
    <p className="sr-only">当前显示 {rows.length} 个，共 {total} 个词汇。</p>
    <div className="lexicon-library__message" aria-live="polite">{message}</div>
    <div className="lexicon-grid">{rows.map((item) => <article className="lexicon-entry" key={item.id}>
      <div className="lexicon-entry__heading"><div><h2 lang="es">{item.lemma}</h2>{item.forms.length ? <p lang="es">{item.forms.join(" · ")}</p> : null}</div>{item.partOfSpeech ? <span>{item.partOfSpeech}</span> : null}</div>
      <p className="lexicon-entry__meaning">{item.meaningZh ?? "释义待补充"}</p>
      <div className="lexicon-entry__meta"><span>{item.lemmaStatus === "verified" ? "已确认词元" : "待确认词形"}</span></div>
      <LexiconOccurrences entryId={item.id} entryKind="lexeme" label={item.lemma} occurrenceCount={item.occurrenceCount} />
      <div className="lexicon-intent-actions" aria-label={`${item.lemma} 复习意图`}>{intents.map(([intent, label]) => <button key={intent} type="button" aria-pressed={item.intent === intent} disabled={busy === item.id} onClick={() => void update(item, intent)}>{label}</button>)}</div>
    </article>)}</div>
  </section>;
}
