"use client";

import { useRef, useState } from "react";

import { contentSourceHref, type SourcePosition } from "../domain";

type CorpusItem = Readonly<{
  leftContext: string;
  keyword: string;
  rightContext: string;
  sourceTitle: string;
  sourceKind: string;
  document: Readonly<{ kind: "article" | "media"; stableKey: string; version: number }>;
  location: SourcePosition;
}>;

type CorpusResponse = Readonly<{ items: readonly CorpusItem[]; page: number; pageSize: number; total: number }>;

/** The search that produced the visible page; paging must never lose it. */
type SubmittedSearch = Readonly<{ query: string; documentKind: "" | "article" | "media" }>;

const FALLBACK_PAGE_SIZE = 20;
/** Mirrors the `page` ceiling in `corpusQuerySchema`. */
const MAX_PAGE = 1000;

export function CorpusSearch() {
  const [query, setQuery] = useState("");
  const [documentKind, setDocumentKind] = useState<"" | "article" | "media">("");
  const [submitted, setSubmitted] = useState<SubmittedSearch | null>(null);
  const [result, setResult] = useState<CorpusResponse | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const abortRef = useRef<AbortController | null>(null);

  async function requestPage(search: SubmittedSearch, page: number) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState("loading");
    try {
      const params = new URLSearchParams({ query: search.query, page: String(page) });
      if (search.documentKind) params.set("documentKind", search.documentKind);
      const response = await fetch(`/api/v1/corpus/search?${params.toString()}`, { credentials: "same-origin", signal: controller.signal });
      if (!response.ok) throw new Error("CORPUS_UNAVAILABLE");
      const payload = await response.json() as { data?: CorpusResponse };
      setResult(payload.data ?? { items: [], page, pageSize: FALLBACK_PAGE_SIZE, total: 0 });
      setState("idle");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState("error");
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    const search: SubmittedSearch = { query: trimmed, documentKind };
    setSubmitted(search);
    void requestPage(search, 1);
  }

  const pageSize = result?.pageSize && result.pageSize > 0 ? result.pageSize : FALLBACK_PAGE_SIZE;
  const totalPages = result ? Math.min(MAX_PAGE, Math.max(1, Math.ceil(result.total / pageSize))) : 1;
  const currentPage = result ? Math.min(Math.max(1, Math.trunc(result.page)), totalPages) : 1;
  const loading = state === "loading";
  const showPagination = Boolean(submitted && result && result.items.length > 0 && totalPages > 1);

  return <section className="corpus-search" aria-label="语料查询">
    <form className="corpus-search__form" onSubmit={submit}>
      <label className="corpus-search__input"><span>搜索词或短语</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如: dar cuenta" maxLength={120} /></label>
      <label className="corpus-search__filter"><span>来源</span><select value={documentKind} onChange={(event) => setDocumentKind(event.target.value as "" | "article" | "media")}><option value="">全部</option><option value="article">文章</option><option value="media">视频 / 播客</option></select></label>
      <button type="submit" disabled={loading || !query.trim()}>{loading ? "查询中…" : "查询"}</button>
    </form>
    <div className="corpus-search__status" aria-live="polite">
      {state === "error" ? <p role="alert">语料库暂时不可用，请稍后再试。</p> : null}
      {state === "idle" && result === null ? <p>从已发布的文章、视频和播客中查找真实用法。</p> : null}
      {state === "idle" && result && result.items.length === 0 ? <p>没有找到同时包含这些词的内容。</p> : null}
      {state === "idle" && result && result.items.length > 0 ? <p>找到 {result.total} 条出现记录</p> : null}
    </div>
    {result && result.items.length > 0 ? <div className="corpus-results">{result.items.map((item, index) => <article className="corpus-result" key={`${item.document.kind}:${item.document.stableKey}:${item.document.version}:${index}`}>
      <p className="corpus-result__context"><span>{item.leftContext} </span><mark>{item.keyword}</mark><span> {item.rightContext}</span></p>
      <div className="corpus-result__meta"><span>{item.sourceTitle}</span><span>{item.document.kind === "article" ? "文章" : "媒体"}</span><a href={contentSourceHref(item.document, item.location)}>打开来源</a></div>
    </article>)}</div> : null}
    {showPagination && submitted && result ? <nav className="lexicon-pagination" aria-label="语料分页">
      <button type="button" disabled={loading || currentPage <= 1} onClick={() => void requestPage(submitted, currentPage - 1)}>上一页</button>
      <span>第 {currentPage} / {totalPages} 页</span>
      <button type="button" disabled={loading || currentPage >= totalPages} onClick={() => void requestPage(submitted, currentPage + 1)}>下一页</button>
    </nav> : null}
  </section>;
}
