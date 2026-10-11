import Link from "next/link";

import type { PhraseQuery } from "../schemas";

const intentOptions = [
  ["", "全部状态"],
  ["revisit", "想复现"],
  ["familiar", "已熟悉"],
  ["ignore", "暂不学习"],
  ["unmarked", "未分类"],
] as const;

/**
 * The single vocabulary shelf's search form and count line.
 *
 * There is no view selector: the page has one shelf, so the form submits only
 * the reader's search. The lexicon variant (`intent` / `lemmaStatus` against
 * `user_lexical_intents`) went with the lexicon view — the shelf's marks are
 * browser-local, and the corpus holds no lexeme rows to filter yet.
 */
export function VocabularyShelfControls({ query, total }: Readonly<{ query: Readonly<{ search?: string }>; total: number }>) {
  return <div className="lexicon-shelf-controls">
    <form action="/read/vocabulary" className="lexicon-filter-form" method="get" role="search">
      <label className="lexicon-filter-form__search"><span>搜索词表</span><input defaultValue={query.search ?? ""} maxLength={80} name="search" placeholder="例如：casa" /></label>
      <button type="submit">搜索</button><Link href="/read/vocabulary">重置</Link>
    </form>
    <p className="lexicon-result-count" aria-live="polite">按参考词频排序的 {total} 个内容词（已过滤功能词；出现次数与例句来自已发布文章与已审核媒体字幕）</p>
  </div>;
}

export function PhraseShelfControls({ query, total }: Readonly<{ query: PhraseQuery; total: number }>) {
  return <div className="lexicon-shelf-controls">
    <form action="/read/phrases" className="lexicon-filter-form lexicon-filter-form--phrases" method="get" role="search">
      <label className="lexicon-filter-form__search"><span>搜索短语</span><input defaultValue={query.search ?? ""} maxLength={120} name="search" placeholder="例如：¿Qué tal?" /></label>
      <label><span>学习状态</span><select defaultValue={query.intent ?? ""} name="intent">{intentOptions.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}</select></label>
      <label><span>语用目的</span><input defaultValue={query.pragmaticPurpose ?? ""} maxLength={80} name="pragmaticPurpose" placeholder="例如：saludo" /></label>
      <label><span>语域</span><input defaultValue={query.register ?? ""} maxLength={40} name="register" placeholder="neutral" /></label>
      <label><span>地区</span><input defaultValue={query.region ?? ""} maxLength={40} name="region" placeholder="es-ES" /></label>
      <label><span>CEFR</span><select defaultValue={query.cefr ?? ""} name="cefr"><option value="">全部级别</option>{["A1", "A2", "B1", "B2", "C1", "C2"].map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
      <button type="submit">应用筛选</button><Link href="/read/phrases">重置</Link>
    </form>
    <p className="lexicon-result-count" aria-live="polite">共 {total} 个短语</p>
  </div>;
}

function pageHref(basePath: string, query: Readonly<Record<string, string | number | undefined>>, page: number): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, page })) if (value !== undefined && String(value) !== "") parameters.set(key, String(value));
  return `${basePath}?${parameters.toString()}`;
}

export function LexiconPagination({ basePath, page, pageSize, total, query }: Readonly<{
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
  query: Readonly<Record<string, string | number | undefined>>;
}>) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return <nav className="lexicon-pagination" aria-label="词句分页">
    {page > 1 ? <Link href={pageHref(basePath, query, page - 1)}>上一页</Link> : <span aria-disabled="true">上一页</span>}
    <span>第 {page} / {pages} 页</span>
    {page < pages ? <Link href={pageHref(basePath, query, page + 1)}>下一页</Link> : <span aria-disabled="true">下一页</span>}
  </nav>;
}
