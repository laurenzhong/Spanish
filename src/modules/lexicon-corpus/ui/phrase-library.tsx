"use client";

import { useState } from "react";
import Link from "next/link";

import type { PhraseItem } from "../repositories";
import { contentSourceHref } from "../domain";
import { LexiconOccurrences } from "./lexicon-occurrences";

type Intent = "familiar" | "revisit" | "ignore";
const intents = [
  ["familiar", "已熟悉"],
  ["revisit", "想复现"],
  ["ignore", "暂不学习"],
] as const;

function locationLabel(item: NonNullable<PhraseItem["representativeOccurrence"]>): string {
  if (item.location.kind === "text") return `第 ${item.location.segmentIndex + 1} 段`;
  const totalSeconds = Math.floor(item.location.startMs / 1_000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function PhraseLibrary({ items, total = items.length, filtered = false, unavailable = false, discovery = false }: Readonly<{
  items: readonly PhraseItem[];
  total?: number;
  filtered?: boolean;
  unavailable?: boolean;
  discovery?: boolean;
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

  if (unavailable) return <div className="lexicon-empty lexicon-empty--error" role="alert"><h2>短语库暂时不可用</h2><p>筛选条件和已有状态没有丢失，请稍后重试。</p><button type="button" onClick={() => window.location.reload()}>重试</button></div>;
  if (!rows.length && total > 0) return <div className="lexicon-empty"><h2>这一页没有内容</h2><p>内容仍在，当前页码可能已超出范围。</p><Link href="/read/phrases">返回短语首页</Link></div>;
  if (!rows.length) {
    const contentName = discovery ? "语料片段" : "短语";
    return <div className="lexicon-empty"><h2>{filtered ? `没有匹配的${contentName}` : discovery ? "暂无可浏览的语料片段" : "还没有短语"}</h2><p>{filtered ? `试试减少筛选条件，或重置后查看全部${contentName}。` : discovery ? "已发布内容暂时没有可展示的片段。" : "通过已发布文章或媒体中的上下文保存正式短语后，会在这里集中整理。"}</p>{filtered ? <Link href="/read/phrases">清除筛选</Link> : <Link href="/read">回到文章库</Link>}</div>;
  }
  return <section className="lexicon-library" aria-label="短语列表">
    <p className="sr-only">当前显示 {rows.length} 条，共 {total} 条内容。</p>
    {rows.some((item) => item.isContentDiscovery) ? <p className="page-lede" role="note">语料片段来自已发布内容，但尚未经过短语审核；请打开来源查看完整上下文。</p> : null}
    <div className="lexicon-library__message" aria-live="polite">{message}</div>
    <div className="lexicon-grid">{rows.map((item) => <article className="lexicon-entry lexicon-entry--phrase" key={item.id}>
      <div className="lexicon-entry__heading"><div><h2 lang="es">{item.expression}</h2>{item.variants.length ? <p lang="es">变体：{item.variants.join(" · ")}</p> : null}</div>{item.cefr ? <span>{item.cefr}</span> : null}</div>
      <p className="lexicon-entry__meaning">{item.isContentDiscovery ? "释义与用法尚未审核" : item.meaningZh ?? "用法说明待补充"}</p>
      {item.pragmaticPurpose ? <p className="lexicon-entry__purpose">{item.pragmaticPurpose}</p> : null}
      <div className="lexicon-entry__meta"><span>{item.isContentDiscovery ? "语料片段" : item.scope === "private" ? "私有" : "公开"}</span>{item.register ? <span>{item.register}</span> : null}{item.region ? <span>{item.region}</span> : null}</div>
      {item.representativeOccurrence ? <div className="lexicon-representative" aria-label={`${item.expression} 代表例句`}>
        <p className="lexicon-representative__context"><span>{item.representativeOccurrence.leftContext}</span>{item.representativeOccurrence.leftContext ? " " : null}<mark>{item.representativeOccurrence.keyword}</mark>{item.representativeOccurrence.rightContext ? " " : null}<span>{item.representativeOccurrence.rightContext}</span></p>
        <div className="lexicon-representative__source"><span>{item.representativeOccurrence.sourceTitle}</span><span>{item.representativeOccurrence.document.kind === "article" ? "文章" : "媒体"} · {locationLabel(item.representativeOccurrence)}</span><a href={contentSourceHref(item.representativeOccurrence.document, item.representativeOccurrence.location)}>打开来源</a></div>
      </div> : <div className="lexicon-representative lexicon-representative--empty" aria-label={`${item.expression} 代表例句`}><p>暂无可见代表例句</p></div>}
      <div className="lexicon-entry__links">{item.isContentDiscovery ? <span className="lexicon-entry__discovery-note">来自已发布内容，可直接打开原文</span> : <Link href={`/read/corpus?entryKind=phrase&entryId=${encodeURIComponent(item.id)}`}>在语料中查看全部用例</Link>}</div>
      {!item.isContentDiscovery ? <>
        <LexiconOccurrences entryId={item.id} entryKind="phrase" label={item.expression} occurrenceCount={item.occurrenceCount} />
        <div className="lexicon-intent-actions" aria-label={`${item.expression} 复习意图`}>{intents.map(([intent, label]) => <button key={intent} type="button" aria-pressed={item.intent === intent} disabled={busy === item.id} onClick={() => void update(item, intent)}>{label}</button>)}</div>
      </> : null}
    </article>)}</div>
  </section>;
}
