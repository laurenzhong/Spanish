"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

/**
 * A corpus frequency row.
 *
 * There is deliberately no `saved` flag: the frequency query knows nothing
 * about the viewer's saved shelf (`user_article_highlights`), so the previous
 * boolean could only ever be hard-coded `false` and made its "查看保存记录"
 * entry unreachable. See READ-SHELF-001 B6.
 */
export type VocabularyWordGridItem = Readonly<{
  id: string;
  text: string;
  count: number;
  meaning: string | null;
  context: string | null;
  source: string | null;
}>;

type VocabularyWordGridProps = Readonly<{
  items: readonly VocabularyWordGridItem[];
  search: string;
  total: number;
}>;

const statusLinks = [
  ["", "全部"],
  ["familiar", "已熟悉"],
  ["revisit", "想复现"],
  ["ignore", "暂不学习"],
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
        <Link href={hrefFor("/read/saved-items", { search, itemType: "phrase" })}>★ 保存的短语</Link>
      </nav>
      <span className="vocabulary-word-workbench__total">排名 1 - {shownTotal}</span>
    </header>
    <div className="vocabulary-word-workbench__filters">
      {/* 学习状态来自服务端 `user_lexical_intents`，只有 `view=lexicon` 会把 intent
          传给 `listVocabulary`（`view=study` 的列表从不读取 intent），所以状态筛选
          链接必须带上视图参数，否则点击后停在默认的 study 视图、视觉无变化。
          文案与 `lexicon-shelf-controls.tsx` / `vocabulary-library.tsx` 保持字面一致。 */}
      {statusLinks.map(([value, label]) => <Link key={value || "all"} href={hrefFor("/read/vocabulary", { view: "lexicon", search: search || undefined, intent: value || undefined })} className={!value ? "is-active" : undefined}>{label}</Link>)}
      <span className="vocabulary-word-workbench__tag">/</span><span className="vocabulary-word-workbench__tag vocabulary-word-workbench__tag--green">#</span><span className="vocabulary-word-workbench__tag vocabulary-word-workbench__tag--yellow">#</span><span className="vocabulary-word-workbench__tag vocabulary-word-workbench__tag--red">#</span>
    </div>
    <div className="vocabulary-word-grid" role="list" aria-label="词汇列表">
      {words.map((item) => <div role="listitem" key={item.id}><button className={`vocabulary-word${selected?.id === item.id ? " is-selected" : ""}`} type="button" onClick={() => setSelected(item)} lang="es"><span>{item.text}</span>{item.count > 1 ? <small>{item.count}</small> : null}</button></div>)}
    </div>
    {selected ? <aside className="vocabulary-word-detail" aria-live="polite"><div><p className="vocabulary-word-detail__eyebrow">词汇详情</p><h3 lang="es">{selected.text}</h3><p>{selected.meaning ?? "释义待补充"}</p>{selected.context ? <blockquote lang="es">{selected.context}</blockquote> : null}{selected.source ? <small>{selected.source}</small> : null}</div><div className="vocabulary-word-detail__actions"><button type="button" onClick={() => setSelected(null)}>关闭</button></div></aside> : null}
  </section>;
}
