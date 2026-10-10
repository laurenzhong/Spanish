"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type VocabularyWordGridItem = Readonly<{
  id: string;
  text: string;
  count: number;
  meaning: string | null;
  context: string | null;
  source: string | null;
  saved: boolean;
}>;

type VocabularyWordGridProps = Readonly<{
  items: readonly VocabularyWordGridItem[];
  search: string;
  total: number;
}>;

const statusLinks = [
  ["", "全部"],
  ["familiar", "已掌握"],
  ["revisit", "学习中"],
  ["ignore", "不学习"],
] as const;

function hrefFor(path: string, query: Readonly<Record<string, string | undefined>>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => { if (value) params.set(key, value); });
  const serialized = params.toString();
  return serialized ? `${path}?${serialized}` : path;
}

export function VocabularyWordGrid({ items, search, total }: VocabularyWordGridProps) {
  const [selected, setSelected] = useState<VocabularyWordGridItem | null>(null);
  const words = useMemo(() => [...items].sort((left, right) => right.count - left.count || left.text.localeCompare(right.text, "es")), [items]);
  if (!words.length) return null;
  const shownTotal = Math.max(total, words.length);

  return <section className="vocabulary-word-workbench" aria-label="词汇表">
    <header className="vocabulary-word-workbench__topline">
      <nav className="vocabulary-word-workbench__tabs" aria-label="词汇表视图">
        <Link href={hrefFor("/read/vocabulary", { search })} aria-current="page">☷ 词汇</Link>
        <Link href={hrefFor("/read/saved-items", { search, itemType: "phrase" })}>▮ 保存的单词</Link>
        <Link href={hrefFor("/read/phrases", { search })}>★ 保存的短语</Link>
      </nav>
      <span className="vocabulary-word-workbench__total">排名 1 - {shownTotal}</span>
    </header>
    <div className="vocabulary-word-workbench__filters">
      {statusLinks.map(([value, label]) => <Link key={value || "all"} href={hrefFor("/read/vocabulary", { search: search || undefined, intent: value || undefined })} className={!value ? "is-active" : undefined}>{value === "familiar" ? "✓ " : value === "revisit" ? "▣ " : value === "ignore" ? "⊘ " : ""}{label}</Link>)}
      <span className="vocabulary-word-workbench__tag">/</span><span className="vocabulary-word-workbench__tag vocabulary-word-workbench__tag--green">#</span><span className="vocabulary-word-workbench__tag vocabulary-word-workbench__tag--yellow">#</span><span className="vocabulary-word-workbench__tag vocabulary-word-workbench__tag--red">#</span>
    </div>
    <div className="vocabulary-word-grid" role="list" aria-label="词汇列表">
      {words.map((item) => <div role="listitem" key={item.id}><button className={`vocabulary-word${selected?.id === item.id ? " is-selected" : ""}`} type="button" onClick={() => setSelected(item)} lang="es"><span>{item.text}</span>{item.count > 1 ? <small>{item.count}</small> : null}</button></div>)}
    </div>
    {selected ? <aside className="vocabulary-word-detail" aria-live="polite"><div><p className="vocabulary-word-detail__eyebrow">词汇详情</p><h3 lang="es">{selected.text}</h3><p>{selected.meaning ?? "释义待补充"}</p>{selected.context ? <blockquote lang="es">{selected.context}</blockquote> : null}{selected.source ? <small>{selected.source}</small> : null}</div><div className="vocabulary-word-detail__actions"><button type="button" onClick={() => setSelected(null)}>关闭</button>{selected.saved ? <Link href={hrefFor("/read/saved-items", { search: selected.text, itemType: "phrase" })}>查看保存记录</Link> : null}</div></aside> : null}
  </section>;
}
