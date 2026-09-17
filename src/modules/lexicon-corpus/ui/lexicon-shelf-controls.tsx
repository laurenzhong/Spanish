import Link from "next/link";

import type { PhraseQuery, VocabularyQuery } from "../schemas";

const intentOptions = [
  ["", "全部状态"],
  ["revisit", "想复现"],
  ["familiar", "已熟悉"],
  ["ignore", "暂不学习"],
  ["unmarked", "未分类"],
] as const;

export function VocabularyShelfControls({ query, total }: Readonly<{ query: VocabularyQuery; total: number }>) {
  return <div className="lexicon-shelf-controls">
    <form action="/read/vocabulary" className="lexicon-filter-form" method="get" role="search">
      <label className="lexicon-filter-form__search"><span>搜索词汇或词形</span><input defaultValue={query.search ?? ""} maxLength={80} name="search" placeholder="例如：comer / comiendo" /></label>
      <label><span>学习状态</span><select defaultValue={query.intent ?? ""} name="intent">{intentOptions.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}</select></label>
      <label><span>词元状态</span><select defaultValue={query.lemmaStatus ?? ""} name="lemmaStatus"><option value="">全部词元</option><option value="verified">已确认词元</option><option value="pending">待确认词形</option></select></label>
      <button type="submit">应用筛选</button><Link href="/read/vocabulary">重置</Link>
    </form>
    <p className="lexicon-result-count" aria-live="polite">共 {total} 个词汇</p>
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
