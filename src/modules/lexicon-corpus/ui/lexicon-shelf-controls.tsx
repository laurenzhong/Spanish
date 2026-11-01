import Link from "next/link";

import type { PhraseQuery } from "../schemas";
import { Button, Input, Select } from "@/src/shared/ui/primitives";

const intentOptions = [
  ["", "全部状态"],
  ["revisit", "想复现"],
  ["familiar", "已熟悉"],
  ["ignore", "暂不学习"],
  ["unmarked", "未分类"],
] as const;

/**
 * The single vocabulary shelf's search field and compact count.
 *
 * There is no view selector: the page has one shelf, so the form submits only the
 * reader's search. The lexicon variant (`intent` / `lemmaStatus` against
 * `user_lexical_intents`) went with the lexicon view — the shelf's marks are
 * keyed by account and word independently of the corpus lexeme index.
 *
 * The field is the control: no card around it, no submit button, no reset link.
 * The magnifier stays on the left; an active search gets a clear control on the
 * right. The label is real but visually hidden, so
 * the input keeps its accessible name without adding a visible caption, and Enter
 * still submits the form. `PhraseShelfControls` keeps the framed layout it shares
 * with the other library pages.
 */
export function VocabularyShelfControls({ query, total }: Readonly<{ query: Readonly<{ search?: string }>; total: number }>) {
  const search = query.search ?? "";
  return <div className="lexicon-shelf-controls vocabulary-controls">
    <form action="/read/vocabulary" className="vocabulary-search" method="get" role="search">
      <label className="sr-only" htmlFor="vocabulary-search">搜索词表</label>
      <svg className="vocabulary-search__icon" aria-hidden="true" focusable="false" viewBox="0 0 20 20"><circle cx="9" cy="9" r="5.5" /><path d="M13.2 13.2L17 17" /></svg>
      {search ? <Link className="vocabulary-search__clear" href="/read/vocabulary" aria-label={`清除搜索：${search}`}>
          <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20"><path d="M6 6l8 8M14 6l-8 8" /></svg>
        </Link>
        : null}
      <Input id="vocabulary-search" defaultValue={search} maxLength={80} name="search" placeholder="搜索单词" />
    </form>
    <p className="lexicon-result-count" aria-live="polite" title="按参考词频排序">{total.toLocaleString("zh-CN")} 词</p>
  </div>;
}

export function PhraseShelfControls({ query, total, discovery = false }: Readonly<{ query: PhraseQuery; total: number; discovery?: boolean }>) {
  return <div className="lexicon-shelf-controls">
    <form action="/read/phrases" className="lexicon-filter-form lexicon-filter-form--phrases" method="get" role="search">
      <label className="lexicon-filter-form__search"><span>{discovery ? "可选：筛选片段" : "可选：筛选短语"}</span><Input defaultValue={query.search ?? ""} maxLength={120} name="search" placeholder={discovery ? "可选：输入片段筛选" : "可选：输入短语筛选"} /></label>
      {!discovery ? <>
        <label><span>学习状态</span><Select defaultValue={query.intent ?? ""} name="intent">{intentOptions.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}</Select></label>
        <label><span>语用目的</span><Input defaultValue={query.pragmaticPurpose ?? ""} maxLength={80} name="pragmaticPurpose" placeholder="例如：saludo" /></label>
        <label><span>语域</span><Input defaultValue={query.register ?? ""} maxLength={40} name="register" placeholder="neutral" /></label>
        <label><span>地区</span><Input defaultValue={query.region ?? ""} maxLength={40} name="region" placeholder="es-ES" /></label>
        <label><span>CEFR</span><Select defaultValue={query.cefr ?? ""} name="cefr"><option value="">全部级别</option>{["A1", "A2", "B1", "B2", "C1", "C2"].map((level) => <option key={level} value={level}>{level}</option>)}</Select></label>
      </> : null}
      <Button type="submit">应用筛选</Button><Link href="/read/phrases">重置</Link>
    </form>
    <p className="lexicon-result-count" aria-live="polite">正在浏览来自文章、视频和播客的 {total} 条{discovery ? "语料片段" : "短语"}</p>
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
